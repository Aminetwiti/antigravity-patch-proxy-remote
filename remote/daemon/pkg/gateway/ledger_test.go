package gateway

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSessionOperationLedger_Lifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	ledger := NewSessionOperationLedger(tmpDir, 5)

	cascadeID := "cas_test_1"
	requestID := "req_test_1"
	sig := CalculateSignature("prompt", map[string]string{"text": "hello world"})

	// 1. Begin
	dup, state, entry, err := ledger.Begin(cascadeID, requestID, sig)
	if err != nil {
		t.Fatalf("Begin error: %v", err)
	}
	if dup || state != LedgerStatePending || entry == nil {
		t.Fatalf("unexpected begin result: dup=%v state=%s entry=%+v", dup, state, entry)
	}

	// 2. Duplicate Begin with same signature
	dup2, state2, _, err := ledger.Begin(cascadeID, requestID, sig)
	if err != nil {
		t.Fatalf("duplicate Begin error: %v", err)
	}
	if !dup2 || state2 != LedgerStatePending {
		t.Fatalf("expected duplicate pending, got dup=%v state=%s", dup2, state2)
	}

	// 3. Duplicate Begin with conflicting signature
	_, _, _, errConflict := ledger.Begin(cascadeID, requestID, "different_signature")
	if errConflict == nil {
		t.Fatalf("expected idempotency conflict error")
	}

	// 4. Accept with result
	res := map[string]interface{}{"stepIndex": int64(42)}
	accepted, err := ledger.Accept(cascadeID, requestID, res)
	if err != nil {
		t.Fatalf("Accept error: %v", err)
	}
	if accepted.State != LedgerStateAccepted || accepted.Result["stepIndex"] != int64(42) {
		t.Fatalf("unexpected accept entry: %+v", accepted)
	}

	// 5. Verify persistence across instances
	reloadedLedger := NewSessionOperationLedger(tmpDir, 5)
	got, found := reloadedLedger.Get(cascadeID, requestID)
	if !found || got.State != LedgerStateAccepted {
		t.Fatalf("expected reloaded entry in accepted state, got found=%v entry=%+v", found, got)
	}
}

func TestSessionOperationLedger_AmbiguousFailure(t *testing.T) {
	tmpDir := t.TempDir()
	ledger := NewSessionOperationLedger(tmpDir, 5)

	cascadeID := "cas_test_2"
	requestID := "req_test_2"
	sig := CalculateSignature("approval", map[string]string{"decision": "allow"})

	_, _, _, _ = ledger.Begin(cascadeID, requestID, sig)
	err := ledger.Fail(cascadeID, requestID, true, map[string]interface{}{"partial": true})
	if err != nil {
		t.Fatalf("Fail error: %v", err)
	}

	entry, found := ledger.Get(cascadeID, requestID)
	if !found || entry.State != LedgerStateUncertain {
		t.Fatalf("expected uncertain state, got found=%v entry=%+v", found, entry)
	}
}

func TestSessionOperationLedger_Trim(t *testing.T) {
	tmpDir := t.TempDir()
	ledger := NewSessionOperationLedger(tmpDir, 3)

	for i := 1; i <= 5; i++ {
		cID := "cas"
		rID := filepath.Join("req", string(rune('0'+i)))
		sig := CalculateSignature("op", i)
		_, _, _, _ = ledger.Begin(cID, rID, sig)
		_, _ = ledger.Accept(cID, rID, nil)
		time.Sleep(2 * time.Millisecond)
	}

	diag := ledger.Diagnostics()
	total := diag["total"].(int)
	if total > 3 {
		t.Fatalf("expected total <= 3 after trim, got %d", total)
	}
}
