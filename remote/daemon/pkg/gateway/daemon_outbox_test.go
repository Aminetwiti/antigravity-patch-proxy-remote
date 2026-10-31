package gateway

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDaemonOutboxAppendPendingConfirm(t *testing.T) {
	dir := t.TempDir()
	o := NewDaemonOutbox()
	o.now = func() time.Time { return time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC) }

	// Redirige le chemin par cascade vers le tempdir de test.
	old := pendingOutboxPath
	pendingOutboxPath = func(id string) string { return filepath.Join(dir, id+".jsonl") }
	defer func() { pendingOutboxPath = old }()

	// Append 2 prompts non confirmés.
	if err := o.Append("casc-outbox", "r1", "prompt un"); err != nil {
		t.Fatalf("Append r1: %v", err)
	}
	if err := o.Append("casc-outbox", "r2", "prompt deux"); err != nil {
		t.Fatalf("Append r2: %v", err)
	}

	// Re-append du même requestId → idempotent (pas de doublon).
	if err := o.Append("casc-outbox", "r1", "prompt un"); err != nil {
		t.Fatalf("Append r1 (dupe): %v", err)
	}

	pending := o.Pending("casc-outbox")
	if len(pending) != 2 {
		t.Fatalf("attendu 2 messages en attente, got %d: %v", len(pending), pending)
	}
	if pending[0]["requestId"] != "r1" || pending[0]["prompt"] != "prompt un" {
		t.Fatalf("message r1 incorrect: %v", pending[0])
	}
	if pending[1]["requestId"] != "r2" {
		t.Fatalf("message r2 incorrect: %v", pending[1])
	}

	// Confirm r1 → seul r2 reste.
	if err := o.Confirm("casc-outbox", "r1"); err != nil {
		t.Fatalf("Confirm r1: %v", err)
	}
	pending = o.Pending("casc-outbox")
	if len(pending) != 1 || pending[0]["requestId"] != "r2" {
		t.Fatalf("attendu [r2] après confirm, got %v", pending)
	}

	// Confirm r2 → fichier supprimé, Pending vide.
	if err := o.Confirm("casc-outbox", "r2"); err != nil {
		t.Fatalf("Confirm r2: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "casc-outbox.jsonl")); !os.IsNotExist(err) {
		t.Fatalf("fichier outbox attendu supprimé, stat err=%v", err)
	}
	if p := o.Pending("casc-outbox"); len(p) != 0 {
		t.Fatalf("attendu outbox vide, got %v", p)
	}
}

func TestDaemonOutboxCorruptLineIgnored(t *testing.T) {
	dir := t.TempDir()
	o := NewDaemonOutbox()
	old := pendingOutboxPath
	pendingOutboxPath = func(id string) string { return filepath.Join(dir, id+".jsonl") }
	defer func() { pendingOutboxPath = old }()

	if err := o.Append("casc-corrupt", "r1", "ok"); err != nil {
		t.Fatalf("Append: %v", err)
	}
	// Ligne corrompue ajoutée à la main → ignorée par Pending.
	f, err := os.OpenFile(filepath.Join(dir, "casc-corrupt.jsonl"), os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := f.WriteString("not json\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	f.Close()

	pending := o.Pending("casc-corrupt")
	if len(pending) != 1 || pending[0]["requestId"] != "r1" {
		t.Fatalf("attendu [r1] (corrompu ignoré), got %v", pending)
	}
}

func TestDaemonOutboxEmpty(t *testing.T) {
	dir := t.TempDir()
	o := NewDaemonOutbox()
	old := pendingOutboxPath
	pendingOutboxPath = func(id string) string { return filepath.Join(dir, id+".jsonl") }
	defer func() { pendingOutboxPath = old }()

	if p := o.Pending("casc-inexistante"); len(p) != 0 {
		t.Fatalf("attendu 0 message sur fichier absent, got %v", p)
	}
	if err := o.Confirm("casc-inexistante", "r-inconnu"); err != nil {
		t.Fatalf("Confirm sur vide ne doit pas échouer: %v", err)
	}
}

func TestDaemonOutboxStalePurged(t *testing.T) {
	dir := t.TempDir()
	o := NewDaemonOutbox()
	old := pendingOutboxPath
	pendingOutboxPath = func(id string) string { return filepath.Join(dir, id+".jsonl") }
	defer func() { pendingOutboxPath = old }()

	// r-old écrit avec l'horloge reculée de 25 h → obsolète.
	o.now = func() time.Time { return time.Now().Add(-25 * time.Hour) }
	if err := o.Append("casc-stale", "r-old", "vieux"); err != nil {
		t.Fatalf("Append old: %v", err)
	}
	// r-new écrit à l'instant présent → récent.
	o.now = func() time.Time { return time.Now() }
	if err := o.Append("casc-stale", "r-new", "récent"); err != nil {
		t.Fatalf("Append new: %v", err)
	}

	pending := o.Pending("casc-stale")
	if len(pending) != 1 || pending[0]["requestId"] != "r-new" {
		t.Fatalf("attendu [r-new] après purge 24h (r-old obsolète), got %v", pending)
	}
}
