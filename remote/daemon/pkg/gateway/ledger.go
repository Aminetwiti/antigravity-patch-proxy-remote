package gateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const (
	LedgerVersion       = 1
	DefaultMaxLedgerOps = 1024

	LedgerStatePending   = "pending"
	LedgerStateAccepted  = "accepted"
	LedgerStateUncertain = "uncertain"
)

// LedgerEntry représente l'état d'une mutation utilisateur tracée par le ledger.
type LedgerEntry struct {
	CascadeID string                 `json:"cascadeId"`
	RequestID string                 `json:"requestId"`
	Signature string                 `json:"signature"`
	State     string                 `json:"state"` // pending, accepted, uncertain
	CreatedAt string                 `json:"createdAt"`
	UpdatedAt string                 `json:"updatedAt"`
	Result    map[string]interface{} `json:"result,omitempty"`
}

// SessionOperationLedger implémente un registre d'idempotence transactionnel
// et durable pour toutes les mutations de session (prompts, suppressions,
// approbations, rollbacks).
type SessionOperationLedger struct {
	mu          sync.Mutex
	stateDir    string
	filePath    string
	maxCapacity int
	loaded      bool
	operations  map[string]*LedgerEntry // key: cascadeId + "\x00" + requestId
	now         func() time.Time
}

type ledgerStorageFormat struct {
	Version    int            `json:"version"`
	Operations []*LedgerEntry `json:"operations"`
}

// NewSessionOperationLedger initialise le registre dans le dossier stateDir donné.
func NewSessionOperationLedger(stateDir string, maxCapacity ...int) *SessionOperationLedger {
	cap := DefaultMaxLedgerOps
	if len(maxCapacity) > 0 && maxCapacity[0] > 0 {
		cap = maxCapacity[0]
	}
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			stateDir = filepath.Join(home, ".gemini", "antigravity-remote")
		} else {
			stateDir = "."
		}
	}
	return &SessionOperationLedger{
		stateDir:    stateDir,
		filePath:    filepath.Join(stateDir, "session-operations.json"),
		maxCapacity: cap,
		operations:  make(map[string]*LedgerEntry),
		now:         time.Now,
	}
}

func operationKey(cascadeID, requestID string) string {
	return cascadeID + "\x00" + requestID
}

// CalculateSignature calcule l'empreinte SHA-256 déterministe d'une opération et de son payload.
func CalculateSignature(operation string, payload interface{}) string {
	raw, err := json.Marshal(map[string]interface{}{
		"operation": operation,
		"payload":   payload,
	})
	if err != nil {
		h := sha256.Sum256([]byte(fmt.Sprintf("%s:%v", operation, payload)))
		return hex.EncodeToString(h[:])
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func (l *SessionOperationLedger) loadLocked() {
	if l.loaded {
		return
	}
	l.loaded = true

	data, err := os.ReadFile(l.filePath)
	if err != nil {
		return
	}

	var storage ledgerStorageFormat
	if err := json.Unmarshal(data, &storage); err != nil {
		return
	}
	if storage.Version != LedgerVersion {
		return
	}

	for _, entry := range storage.Operations {
		if entry == nil || entry.CascadeID == "" || entry.RequestID == "" {
			continue
		}
		if entry.State != LedgerStatePending && entry.State != LedgerStateAccepted && entry.State != LedgerStateUncertain {
			continue
		}
		l.operations[operationKey(entry.CascadeID, entry.RequestID)] = entry
	}
}

func (l *SessionOperationLedger) trimLocked() {
	if len(l.operations) <= l.maxCapacity {
		return
	}

	var acceptedEntries []*LedgerEntry
	for _, entry := range l.operations {
		if entry.State == LedgerStateAccepted {
			acceptedEntries = append(acceptedEntries, entry)
		}
	}

	sort.Slice(acceptedEntries, func(i, j int) bool {
		return acceptedEntries[i].UpdatedAt < acceptedEntries[j].UpdatedAt
	})

	for len(l.operations) > l.maxCapacity && len(acceptedEntries) > 0 {
		oldest := acceptedEntries[0]
		acceptedEntries = acceptedEntries[1:]
		delete(l.operations, operationKey(oldest.CascadeID, oldest.RequestID))
	}
}

func (l *SessionOperationLedger) persistLocked() error {
	l.trimLocked()

	if err := os.MkdirAll(l.stateDir, 0755); err != nil {
		return err
	}

	var list []*LedgerEntry
	for _, entry := range l.operations {
		list = append(list, entry)
	}

	data, err := json.MarshalIndent(ledgerStorageFormat{
		Version:    LedgerVersion,
		Operations: list,
	}, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := fmt.Sprintf("%s.%d.%d.tmp", l.filePath, os.Getpid(), time.Now().UnixNano())
	if err := os.WriteFile(tmpFile, data, 0600); err != nil {
		return err
	}

	return os.Rename(tmpFile, l.filePath)
}

// Begin enregistre le démarrage d'une mutation utilisateur.
func (l *SessionOperationLedger) Begin(cascadeID, requestID, signature string) (bool, string, *LedgerEntry, error) {
	if cascadeID == "" || requestID == "" {
		return false, "", nil, fmt.Errorf("cascadeID et requestID sont obligatoires")
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.loadLocked()

	key := operationKey(cascadeID, requestID)
	if existing, exists := l.operations[key]; exists {
		if existing.Signature != signature {
			return true, existing.State, existing, fmt.Errorf("conflit d'idempotence: requestId '%s' déjà utilisé avec une signature différente", requestID)
		}
		return true, existing.State, cloneEntry(existing), nil
	}

	nowISO := l.now().UTC().Format(time.RFC3339Nano)
	entry := &LedgerEntry{
		CascadeID: cascadeID,
		RequestID: requestID,
		Signature: signature,
		State:     LedgerStatePending,
		CreatedAt: nowISO,
		UpdatedAt: nowISO,
	}

	l.operations[key] = entry
	_ = l.persistLocked()

	return false, entry.State, cloneEntry(entry), nil
}

// Accept valide avec succès l'opération et enregistre optionnellement son résultat.
func (l *SessionOperationLedger) Accept(cascadeID, requestID string, result map[string]interface{}) (*LedgerEntry, error) {
	if cascadeID == "" || requestID == "" {
		return nil, fmt.Errorf("cascadeID et requestID sont obligatoires")
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.loadLocked()

	key := operationKey(cascadeID, requestID)
	entry, exists := l.operations[key]
	if !exists {
		return nil, fmt.Errorf("opération inexistante dans le ledger")
	}

	entry.State = LedgerStateAccepted
	entry.UpdatedAt = l.now().UTC().Format(time.RFC3339Nano)
	if result != nil {
		entry.Result = result
	}

	_ = l.persistLocked()
	return cloneEntry(entry), nil
}

// Fail marque l'opération comme échouée.
func (l *SessionOperationLedger) Fail(cascadeID, requestID string, ambiguous bool, result map[string]interface{}) error {
	if cascadeID == "" || requestID == "" {
		return fmt.Errorf("cascadeID et requestID sont obligatoires")
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.loadLocked()

	key := operationKey(cascadeID, requestID)
	entry, exists := l.operations[key]
	if !exists {
		return nil
	}

	if ambiguous {
		entry.State = LedgerStateUncertain
		entry.UpdatedAt = l.now().UTC().Format(time.RFC3339Nano)
		if result != nil {
			entry.Result = result
		}
	} else {
		delete(l.operations, key)
	}

	return l.persistLocked()
}

// Get récupère une entrée du ledger par cascadeID et requestID.
func (l *SessionOperationLedger) Get(cascadeID, requestID string) (*LedgerEntry, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.loadLocked()
	entry, exists := l.operations[operationKey(cascadeID, requestID)]
	if !exists {
		return nil, false
	}
	return cloneEntry(entry), true
}

// Diagnostics renvoie un résumé statistique du ledger.
func (l *SessionOperationLedger) Diagnostics() map[string]interface{} {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.loadLocked()

	counts := map[string]int{
		LedgerStatePending:   0,
		LedgerStateAccepted:  0,
		LedgerStateUncertain: 0,
	}
	for _, entry := range l.operations {
		counts[entry.State]++
	}

	return map[string]interface{}{
		"loaded":      l.loaded,
		"total":       len(l.operations),
		"maxCapacity": l.maxCapacity,
		"counts":      counts,
		"filePath":    l.filePath,
	}
}

func cloneEntry(e *LedgerEntry) *LedgerEntry {
	if e == nil {
		return nil
	}
	copy := *e
	if e.Result != nil {
		resCopy := make(map[string]interface{}, len(e.Result))
		for k, v := range e.Result {
			resCopy[k] = v
		}
		copy.Result = resCopy
	}
	return &copy
}
