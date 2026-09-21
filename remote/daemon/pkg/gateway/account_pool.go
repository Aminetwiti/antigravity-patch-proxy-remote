package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	googleTokenEndpoint = "https://oauth2.googleapis.com/token"
)

// ModelQuotaInfo contient les informations de quota d'un modèle pour un compte donné.
type ModelQuotaInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	Percentage  int    `json:"percentage"`
	ResetTime   string `json:"resetTime,omitempty"`
}

// AccountEntry représente un compte Google du pool avec son statut.
type AccountEntry struct {
	Email        string           `json:"email"`
	RefreshToken string           `json:"refreshToken,omitempty"`
	AccessToken  string           `json:"accessToken,omitempty"`
	TokenExpiry  int64            `json:"tokenExpiry,omitempty"`
	Status       string           `json:"status"` // "active" | "standby" | "exhausted"
	LastUsed     int64            `json:"lastUsed,omitempty"`
	Quotas       []ModelQuotaInfo `json:"quotas,omitempty"`
}

// AccountSummary est la vue publique exposée aux clients WebSocket / Mobile.
type AccountSummary struct {
	Email    string           `json:"email"`
	IsActive bool             `json:"isActive"`
	Status   string           `json:"status"`
	Quotas   []ModelQuotaInfo `json:"quotas,omitempty"`
}

// AccountPool gère le cycle de vie, la rotation et la sélection des comptes.
type AccountPool struct {
	mu                 sync.RWMutex
	accounts           []*AccountEntry
	activeIndex        int
	autoRotate         bool
	defaultPlan        string
	oauthClient        *http.Client
	clientID           string
	clientSecret       string
	onAccountRecovered func(AccountEntry)
}

var (
	globalPool *AccountPool
	poolOnce   sync.Once
)

// GetGlobalAccountPool retourne l'instance unique du pool de comptes.
func GetGlobalAccountPool() *AccountPool {
	poolOnce.Do(func() {
		globalPool = NewAccountPool()
	})
	return globalPool
}

// NewAccountPool instancie un pool et charge les comptes disponibles.
func NewAccountPool() *AccountPool {
	cid := os.Getenv("AG_GOOGLE_CLIENT_ID")
	if cid == "" {
		cid = os.Getenv("GOOGLE_CLIENT_ID")
	}
	csec := os.Getenv("AG_GOOGLE_CLIENT_SECRET")
	if csec == "" {
		csec = os.Getenv("GOOGLE_CLIENT_SECRET")
	}

	p := &AccountPool{
		accounts:     make([]*AccountEntry, 0),
		activeIndex:  0,
		autoRotate:   true,
		defaultPlan:  "Google AI Pro",
		clientID:     cid,
		clientSecret: csec,
		oauthClient:  &http.Client{Timeout: 15 * time.Second},
	}

	if envAR := os.Getenv("AG_AUTO_ROTATE"); envAR != "" {
		p.autoRotate = envAR != "0" && strings.ToLower(envAR) != "false"
	}

	p.loadAccounts()
	return p
}

// loadAccounts charge les comptes dans l'ordre de priorité :
// 1. AG_ACCOUNTS_JSON (chaîne JSON brute dans l'environnement)
// 2. AG_ACCOUNTS_FILE (chemin vers fichier JSON)
// 3. Découverte locale (sur machine desktop : .antigravity_tools / .gemini)
func (p *AccountPool) loadAccounts() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.accounts = make([]*AccountEntry, 0)

	// 1. Variable d'environnement directe (AG_ACCOUNTS_JSON)
	if rawJSON := strings.TrimSpace(os.Getenv("AG_ACCOUNTS_JSON")); rawJSON != "" {
		if p.parseAccountsJSON([]byte(rawJSON)) {
			p.enrichWithLocalQuotas()
			p.finalizeSelection()
			return
		}
	}

	// 2. Chemin de fichier d'environnement (AG_ACCOUNTS_FILE)
	if filePath := strings.TrimSpace(os.Getenv("AG_ACCOUNTS_FILE")); filePath != "" {
		if data, err := os.ReadFile(filePath); err == nil {
			if p.parseAccountsJSON(data) {
				p.enrichWithLocalQuotas()
				p.finalizeSelection()
				return
			}
		}
	}

	// 3. Découverte automatique locale (fichiers desktop)
	p.discoverLocalAccounts()
	p.enrichWithLocalQuotas()
	p.finalizeSelection()
}

func (p *AccountPool) parseAccountsJSON(data []byte) bool {
	// Support format array : [{"email":"...","refresh_token":"...", "quotas": [...]}, ...]
	var rawList []struct {
		Email        string `json:"email"`
		RefreshToken string `json:"refresh_token"`
		Token        *struct {
			RefreshToken string `json:"refresh_token"`
		} `json:"token,omitempty"`
		Quotas []ModelQuotaInfo `json:"quotas,omitempty"`
		Quota  *struct {
			Models []struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
				Percentage  int    `json:"percentage"`
				ResetTime   string `json:"reset_time"`
			} `json:"models"`
		} `json:"quota,omitempty"`
	}

	if err := json.Unmarshal(data, &rawList); err == nil && len(rawList) > 0 {
		for _, item := range rawList {
			email := strings.TrimSpace(item.Email)
			if email == "" {
				continue
			}
			rt := item.RefreshToken
			if rt == "" && item.Token != nil {
				rt = item.Token.RefreshToken
			}
			var qList []ModelQuotaInfo
			if len(item.Quotas) > 0 {
				qList = item.Quotas
			} else if item.Quota != nil && len(item.Quota.Models) > 0 {
				for _, m := range item.Quota.Models {
					qList = append(qList, ModelQuotaInfo{
						Name:        m.Name,
						DisplayName: m.DisplayName,
						Percentage:  m.Percentage,
						ResetTime:   m.ResetTime,
					})
				}
			}
			p.accounts = append(p.accounts, &AccountEntry{
				Email:        email,
				RefreshToken: rt,
				Status:       "standby",
				Quotas:       qList,
			})
		}
		return len(p.accounts) > 0
	}

	// Support format Antigravity Tools : {"accounts": [{"email":"...", ...}]}
	var agToolsFormat struct {
		Accounts []struct {
			Email string `json:"email"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(data, &agToolsFormat); err == nil && len(agToolsFormat.Accounts) > 0 {
		for _, acc := range agToolsFormat.Accounts {
			if email := strings.TrimSpace(acc.Email); email != "" {
				p.accounts = append(p.accounts, &AccountEntry{
					Email:  email,
					Status: "standby",
				})
			}
		}
		return len(p.accounts) > 0
	}

	return false
}

func (p *AccountPool) discoverLocalAccounts() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	// 3a. Scanner .antigravity_tools/accounts/*.json
	pattern := filepath.Join(home, ".antigravity_tools", "accounts", "*.json")
	if matches, err := filepath.Glob(pattern); err == nil && len(matches) > 0 {
		for _, match := range matches {
			if data, err := os.ReadFile(match); err == nil {
				var item struct {
					Email string `json:"email"`
					Token struct {
						RefreshToken string `json:"refresh_token"`
						AccessToken  string `json:"access_token"`
						Expiry       int64  `json:"expiry_timestamp"`
					} `json:"token"`
					Quota struct {
						Models []struct {
							Name        string `json:"name"`
							DisplayName string `json:"display_name"`
							Percentage  int    `json:"percentage"`
							ResetTime   string `json:"reset_time"`
						} `json:"models"`
					} `json:"quota"`
				}
				if err := json.Unmarshal(data, &item); err == nil && item.Email != "" {
					var qList []ModelQuotaInfo
					for _, m := range item.Quota.Models {
						qList = append(qList, ModelQuotaInfo{
							Name:        m.Name,
							DisplayName: m.DisplayName,
							Percentage:  m.Percentage,
							ResetTime:   m.ResetTime,
						})
					}
					p.accounts = append(p.accounts, &AccountEntry{
						Email:        item.Email,
						RefreshToken: item.Token.RefreshToken,
						AccessToken:  item.Token.AccessToken,
						TokenExpiry:  item.Token.Expiry,
						Status:       "standby",
						Quotas:       qList,
					})
				}
			}
		}
		if len(p.accounts) > 0 {
			return
		}
	}

	// 3b. Scanner .antigravity_tools/accounts.json
	agToolsFile := filepath.Join(home, ".antigravity_tools", "accounts.json")
	if data, err := os.ReadFile(agToolsFile); err == nil {
		if p.parseAccountsJSON(data) {
			return
		}
	}

	// 3c. Fichier local antigravity_accounts_*.json dans le CWD
	if cwdMatches, err := filepath.Glob("antigravity_accounts_*.json"); err == nil && len(cwdMatches) > 0 {
		if data, err := os.ReadFile(cwdMatches[len(cwdMatches)-1]); err == nil {
			if p.parseAccountsJSON(data) {
				return
			}
		}
	}
}

// enrichWithLocalQuotas enrichit les comptes dépourvus de quotas avec les données
// locales de ~/.antigravity_tools/accounts/*.json si présentes.
func (p *AccountPool) enrichWithLocalQuotas() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	pattern := filepath.Join(home, ".antigravity_tools", "accounts", "*.json")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return
	}

	quotaByEmail := make(map[string][]ModelQuotaInfo)
	for _, match := range matches {
		if data, err := os.ReadFile(match); err == nil {
			var item struct {
				Email string `json:"email"`
				Quota struct {
					Models []struct {
						Name        string `json:"name"`
						DisplayName string `json:"display_name"`
						Percentage  int    `json:"percentage"`
						ResetTime   string `json:"reset_time"`
					} `json:"models"`
				} `json:"quota"`
			}
			if err := json.Unmarshal(data, &item); err == nil && item.Email != "" && len(item.Quota.Models) > 0 {
				var qList []ModelQuotaInfo
				for _, m := range item.Quota.Models {
					qList = append(qList, ModelQuotaInfo{
						Name:        m.Name,
						DisplayName: m.DisplayName,
						Percentage:  m.Percentage,
						ResetTime:   m.ResetTime,
					})
				}
				quotaByEmail[strings.ToLower(item.Email)] = qList
			}
		}
	}

	for _, acc := range p.accounts {
		if len(acc.Quotas) == 0 {
			if qList, ok := quotaByEmail[strings.ToLower(acc.Email)]; ok {
				acc.Quotas = qList
			}
		}
	}
}

func (p *AccountPool) finalizeSelection() {
	if len(p.accounts) == 0 {
		// Compte par défaut sans données d'identification en dur
		defaultEmail := os.Getenv("AG_ACTIVE_ACCOUNT")
		if defaultEmail == "" {
			defaultEmail = "account@antigravity.local"
		}
		p.accounts = append(p.accounts, &AccountEntry{
			Email:  defaultEmail,
			Status: "active",
		})
		p.activeIndex = 0
		return
	}

	// Déterminer le compte actif
	targetEmail := os.Getenv("AG_ACTIVE_ACCOUNT")
	if targetEmail == "" {
		// Consulter les préférences persistées si existantes
		targetEmail = loadPersistedActiveAccount()
	}

	p.activeIndex = 0
	for i, acc := range p.accounts {
		if targetEmail != "" && strings.EqualFold(acc.Email, targetEmail) {
			p.activeIndex = i
			break
		}
	}

	for i, acc := range p.accounts {
		if i == p.activeIndex {
			acc.Status = "active"
			acc.LastUsed = time.Now().Unix()
		} else if acc.Status != "exhausted" {
			acc.Status = "standby"
		}
	}
}

// GetActiveAccount retourne les informations du compte actuellement sélectionné.
func (p *AccountPool) GetActiveAccount() AccountEntry {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if len(p.accounts) == 0 {
		return AccountEntry{
			Email:  "account@antigravity.local",
			Status: "active",
		}
	}
	if p.activeIndex >= len(p.accounts) {
		p.activeIndex = 0
	}
	return *p.accounts[p.activeIndex]
}

// SetOnAccountRecovered enregistre un callback invoqué quand un compte épuisé redevient standby/actif.
func (p *AccountPool) SetOnAccountRecovered(cb func(AccountEntry)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onAccountRecovered = cb
}

// ListAccounts retourne la liste publique des comptes avec leur statut, quotas et le flag actif.
func (p *AccountPool) ListAccounts() []AccountSummary {
	p.mu.RLock()
	defer p.mu.RUnlock()

	summaries := make([]AccountSummary, len(p.accounts))
	for i, acc := range p.accounts {
		qCopy := make([]ModelQuotaInfo, len(acc.Quotas))
		copy(qCopy, acc.Quotas)
		summaries[i] = AccountSummary{
			Email:    acc.Email,
			IsActive: i == p.activeIndex,
			Status:   acc.Status,
			Quotas:   qCopy,
		}
	}
	return summaries
}

// SwitchAccount sélectionne un compte spécifique par son adresse email.
func (p *AccountPool) SwitchAccount(email string) (*AccountEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cleanEmail := strings.TrimSpace(email)
	for i, acc := range p.accounts {
		if strings.EqualFold(acc.Email, cleanEmail) {
			p.activeIndex = i
			for j, a := range p.accounts {
				if j == i {
					a.Status = "active"
					a.LastUsed = time.Now().Unix()
				} else if a.Status != "exhausted" {
					a.Status = "standby"
				}
			}
			selected := *p.accounts[i]
			// Sauvegarder la sélection dans les préférences
			go savePersistedActiveAccount(selected.Email)
			return &selected, nil
		}
	}

	return nil, fmt.Errorf("account with email %q not found in pool", email)
}

// RotateNext bascule vers le prochain compte disponible ayant du quota (round-robin).
func (p *AccountPool) RotateNext(reason string) (*AccountEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.rotateNextLocked(reason)
}

func (p *AccountPool) rotateNextLocked(reason string) (*AccountEntry, error) {
	if len(p.accounts) <= 1 {
		if len(p.accounts) == 1 {
			return p.accounts[0], nil
		}
		return nil, errors.New("no accounts available in pool")
	}

	// Marquer l'ancien compte comme épuisé si spécifié
	if p.activeIndex < len(p.accounts) && reason == "quota_exhausted" {
		p.accounts[p.activeIndex].Status = "exhausted"
	}

	// Chercher le prochain compte non épuisé
	total := len(p.accounts)
	for step := 1; step <= total; step++ {
		nextIdx := (p.activeIndex + step) % total
		candidate := p.accounts[nextIdx]
		if candidate.Status != "exhausted" {
			p.activeIndex = nextIdx
			candidate.Status = "active"
			candidate.LastUsed = time.Now().Unix()
			selected := *candidate
			go savePersistedActiveAccount(selected.Email)
			return &selected, nil
		}
	}

	// Si tous les comptes sont marqués épuisés, réinitialiser le cycle
	nextIdx := (p.activeIndex + 1) % total
	p.activeIndex = nextIdx
	p.accounts[nextIdx].Status = "active"
	p.accounts[nextIdx].LastUsed = time.Now().Unix()
	selected := *p.accounts[nextIdx]
	go savePersistedActiveAccount(selected.Email)
	return &selected, nil
}

// SelectBestAccountForModel sélectionne automatiquement le meilleur compte
// pour un modèle donné selon les pourcentages de quota disponibles.
func (p *AccountPool) SelectBestAccountForModel(modelName string) (*AccountEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if len(p.accounts) == 0 {
		return nil, errors.New("no accounts available in pool")
	}

	cleanModel := strings.ToLower(strings.TrimSpace(modelName))

	// 1. Si le compte actif actuel a encore du quota (> 20%) pour ce modèle,
	// on le conserve pour éviter de changer inutilement de session.
	if p.activeIndex < len(p.accounts) {
		current := p.accounts[p.activeIndex]
		if current.Status != "exhausted" {
			pct := p.findModelPercentage(current, cleanModel)
			if pct > 20 {
				return current, nil
			}
		}
	}

	// 2. Recherche du compte non épuisé avec le pourcentage de quota le plus élevé
	bestIdx := -1
	highestPct := -1
	oldestUsed := int64(1<<63 - 1)

	for i, acc := range p.accounts {
		if acc.Status == "exhausted" {
			continue
		}
		pct := p.findModelPercentage(acc, cleanModel)
		if pct > highestPct {
			highestPct = pct
			bestIdx = i
			oldestUsed = acc.LastUsed
		} else if pct == highestPct && acc.LastUsed < oldestUsed {
			bestIdx = i
			oldestUsed = acc.LastUsed
		}
	}

	if bestIdx >= 0 {
		p.activeIndex = bestIdx
		p.accounts[bestIdx].Status = "active"
		p.accounts[bestIdx].LastUsed = time.Now().Unix()
		selected := *p.accounts[bestIdx]
		go savePersistedActiveAccount(selected.Email)
		return &selected, nil
	}

	// 3. Fallback : si aucun compte spécifique n'est trouvé, round-robin
	return p.rotateNextLocked("model_quota_fallback")
}

func (p *AccountPool) findModelPercentage(acc *AccountEntry, modelQuery string) int {
	if len(acc.Quotas) == 0 {
		if acc.Status == "exhausted" {
			return 0
		}
		return 100
	}
	if modelQuery == "" {
		total := 0
		for _, q := range acc.Quotas {
			total += q.Percentage
		}
		return total / len(acc.Quotas)
	}

	for _, q := range acc.Quotas {
		name := strings.ToLower(q.Name)
		disp := strings.ToLower(q.DisplayName)
		if strings.Contains(name, modelQuery) || strings.Contains(disp, modelQuery) {
			return q.Percentage
		}
	}
	if acc.Status == "exhausted" {
		return 0
	}
	return 100
}

// UpdateAccountQuotas met à jour les quotas d'un compte (par email).
func (p *AccountPool) UpdateAccountQuotas(email string, quotas []ModelQuotaInfo) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if strings.EqualFold(acc.Email, email) {
			acc.Quotas = quotas
			return true
		}
	}
	return false
}

// StartWatchdog lance une goroutine de surveillance périodique qui réinitialise
// le statut des comptes épuisés dont la date de reset (reset_time) est dépassée.
func (p *AccountPool) StartWatchdog(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				p.CheckAndResetExhaustedAccounts()
			}
		}
	}()
}

// CheckAndResetExhaustedAccounts vérifie tous les comptes marqués "exhausted".
// Si leur reset_time est dépassé, leur statut repasse à "standby" et leurs quotas sont restaurés.
func (p *AccountPool) CheckAndResetExhaustedAccounts() []AccountEntry {
	p.mu.Lock()
	now := time.Now()
	var recovered []AccountEntry

	for i, acc := range p.accounts {
		if acc.Status != "exhausted" {
			continue
		}

		shouldReset := false
		if len(acc.Quotas) == 0 {
			if acc.LastUsed > 0 && now.Unix()-acc.LastUsed > 3600 {
				shouldReset = true
			}
		} else {
			anyExceeded := false
			allPassed := true
			for _, q := range acc.Quotas {
				if q.Percentage < 100 && q.ResetTime != "" {
					anyExceeded = true
					t, err := time.Parse(time.RFC3339, q.ResetTime)
					if err == nil && now.Before(t) {
						allPassed = false
						break
					}
				}
			}
			if anyExceeded && allPassed {
				shouldReset = true
			}
		}

		if shouldReset {
			if i == p.activeIndex {
				acc.Status = "active"
			} else {
				acc.Status = "standby"
			}
			for j := range acc.Quotas {
				acc.Quotas[j].Percentage = 100
			}
			recCopy := *acc
			recovered = append(recovered, recCopy)
		}
	}
	cb := p.onAccountRecovered
	p.mu.Unlock()

	if cb != nil {
		for _, rec := range recovered {
			cb(rec)
		}
	}
	return recovered
}

// SetAutoRotate active ou désactive la rotation automatique sur épuisement de quota.
func (p *AccountPool) SetAutoRotate(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.autoRotate = enabled
	go savePersistedAutoRotate(enabled)
}

// IsAutoRotate retourne l'état de la rotation automatique.
func (p *AccountPool) IsAutoRotate() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.autoRotate
}

// RefreshTokenFor rafraîchit l'Access Token Google via son Refresh Token OAuth.
func (p *AccountPool) RefreshTokenFor(email string) (string, error) {
	p.mu.Lock()
	var entry *AccountEntry
	for _, acc := range p.accounts {
		if strings.EqualFold(acc.Email, email) {
			entry = acc
			break
		}
	}
	p.mu.Unlock()

	if entry == nil {
		return "", fmt.Errorf("account %q not found", email)
	}
	if entry.RefreshToken == "" {
		return "", fmt.Errorf("no refresh_token available for %q", email)
	}

	// Vérifier si le token actuel est encore valide (> 5 min)
	if entry.AccessToken != "" && entry.TokenExpiry > time.Now().Unix()+300 {
		return entry.AccessToken, nil
	}

	form := url.Values{}
	form.Set("client_id", p.clientID)
	form.Set("client_secret", p.clientSecret)
	form.Set("refresh_token", entry.RefreshToken)
	form.Set("grant_type", "refresh_token")

	resp, err := p.oauthClient.PostForm(googleTokenEndpoint, form)
	if err != nil {
		return "", fmt.Errorf("token exchange network error: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token refresh failed HTTP %d: %s", resp.StatusCode, string(body))
	}

	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	p.mu.Lock()
	entry.AccessToken = tr.AccessToken
	entry.TokenExpiry = time.Now().Unix() + tr.ExpiresIn
	p.mu.Unlock()

	return tr.AccessToken, nil
}

// Persistance utilitaire dans .gemini/config/prefs.json

func loadPersistedActiveAccount() string {
	path := accountPrefsPath()
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var prefs struct {
		ActiveAccount string `json:"activeAccountEmail"`
	}
	_ = json.Unmarshal(data, &prefs)
	return prefs.ActiveAccount
}

func savePersistedActiveAccount(email string) {
	path := accountPrefsPath()
	if path == "" {
		return
	}
	var prefs map[string]interface{}
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &prefs)
	}
	if prefs == nil {
		prefs = make(map[string]interface{})
	}
	prefs["activeAccountEmail"] = email
	if b, err := json.MarshalIndent(prefs, "", "  "); err == nil {
		_ = os.WriteFile(path, b, 0644)
	}
}

func savePersistedAutoRotate(enabled bool) {
	path := accountPrefsPath()
	if path == "" {
		return
	}
	var prefs map[string]interface{}
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &prefs)
	}
	if prefs == nil {
		prefs = make(map[string]interface{})
	}
	prefs["autoRotateEnabled"] = enabled
	if b, err := json.MarshalIndent(prefs, "", "  "); err == nil {
		_ = os.WriteFile(path, b, 0644)
	}
}
