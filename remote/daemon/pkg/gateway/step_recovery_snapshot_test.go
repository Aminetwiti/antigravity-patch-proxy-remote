package gateway

import (
	"testing"
)

func TestSessionStreamBuffer_SnapshotAndReplay(t *testing.T) {
	buf := NewSessionStreamBuffer(10)
	cascadeID := "casc-snapshot-test"

	// 1. Initial Snapshot
	snapshot := map[string]interface{}{
		"title":     "Refactoring Task",
		"worktree":  "/repo/worktrees/feat-auth",
		"subagents": []string{"subagent-1", "subagent-2"},
		"messages": []map[string]string{
			{"role": "user", "text": "Please refactor the auth layer"},
			{"role": "agent", "text": "Starting analysis..."},
		},
	}
	buf.SetSessionSnapshot(cascadeID, snapshot)

	// Verify snapshot retrieval
	savedSnapshot := buf.GetSessionSnapshot(cascadeID)
	if savedSnapshot == nil || savedSnapshot["title"] != "Refactoring Task" {
		t.Fatalf("expected snapshot title 'Refactoring Task', got %v", savedSnapshot)
	}

	// 2. Stream events
	seq1 := buf.RecordEvent(cascadeID, OutgoingMessage{
		Type:      "stream_delta",
		CascadeID: cascadeID,
		Data: map[string]interface{}{
			"events": []map[string]string{{"kind": "text", "delta": "Analyzing files"}},
		},
	})
	seq2 := buf.RecordEvent(cascadeID, OutgoingMessage{
		Type:      "stream_delta",
		CascadeID: cascadeID,
		Data: map[string]interface{}{
			"events": []map[string]string{{"kind": "text", "delta": "...\nDone"}},
		},
	})

	if seq1 != 1 || seq2 != 2 {
		t.Fatalf("unexpected sequence numbers: seq1=%d, seq2=%d", seq1, seq2)
	}

	// 3. Late-joiner catches up from lastStepIndex = 0
	missedAll, curSeq := buf.GetEventsSince(cascadeID, 0)
	if curSeq != 2 {
		t.Fatalf("expected curSeq 2, got %d", curSeq)
	}
	if len(missedAll) != 2 {
		t.Fatalf("expected 2 missed events, got %d", len(missedAll))
	}

	// 4. Reconnected client catches up from lastStepIndex = 1
	missedPartial, _ := buf.GetEventsSince(cascadeID, 1)
	if len(missedPartial) != 1 {
		t.Fatalf("expected 1 missed event, got %d", len(missedPartial))
	}

	// 5. ClearCascade purges both buffer and snapshot
	buf.ClearCascade(cascadeID)
	if buf.GetSessionSnapshot(cascadeID) != nil {
		t.Fatalf("expected snapshot to be deleted after ClearCascade")
	}
	if buf.LastStepIndex(cascadeID) != 0 {
		t.Fatalf("expected lastStepIndex to be 0 after ClearCascade")
	}
}
