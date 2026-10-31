package gateway

import (
	"testing"
)

func TestSessionLineageStore(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewSessionLineageStore(tmpDir)

	link, err := store.AddLink("cas_A", "cas_B", "handoff", "summary context")
	if err != nil || link == nil {
		t.Fatalf("AddLink error: %v", err)
	}

	linksA := store.ListLinksFor("cas_A")
	if len(linksA) != 1 || linksA[0].TargetSessionID != "cas_B" {
		t.Fatalf("expected link to cas_B, got %+v", linksA)
	}

	reloaded := NewSessionLineageStore(tmpDir)
	linksB := reloaded.ListLinksFor("cas_B")
	if len(linksB) != 1 || linksB[0].SourceSessionID != "cas_A" {
		t.Fatalf("expected link to cas_A in reloaded store")
	}
}
