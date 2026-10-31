package gateway

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestListIdeSessions_ActiveAndProjectFallback(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("USERPROFILE")
	if origHome == "" {
		origHome = os.Getenv("HOME")
	}
	os.Setenv("USERPROFILE", tmpHome)
	os.Setenv("HOME", tmpHome)
	defer func() {
		os.Setenv("USERPROFILE", origHome)
		os.Setenv("HOME", origHome)
	}()

	ideBrain := filepath.Join(tmpHome, ".gemini", "antigravity-ide", "brain")
	ideAnno := filepath.Join(tmpHome, ".gemini", "antigravity-ide", "annotations")
	_ = os.MkdirAll(ideBrain, 0o755)
	_ = os.MkdirAll(ideAnno, 0o755)

	createTestSession := func(cid, ws, title string, modTime, viewTime time.Time) {
		sessDir := filepath.Join(ideBrain, cid)
		_ = os.MkdirAll(sessDir, 0o755)
		meta := filepath.Join(sessDir, "metadata.json")
		_ = os.WriteFile(meta, []byte(`{"workspace":"`+ws+`"}`), 0o644)
		logsDir := filepath.Join(sessDir, ".system_generated", "logs")
		_ = os.MkdirAll(logsDir, 0o755)
		tr := filepath.Join(logsDir, "transcript.jsonl")
		_ = os.WriteFile(tr, []byte(`{"title":"`+title+`"}`+"\n"), 0o644)
		_ = os.Chtimes(tr, modTime, modTime)
		_ = os.Chtimes(sessDir, modTime, modTime)

		if !viewTime.IsZero() {
			anno := filepath.Join(ideAnno, cid+".pbtxt")
			content := fmt.Sprintf("last_user_view_time:{seconds:%d nanos:0}", viewTime.Unix())
			_ = os.WriteFile(anno, []byte(content), 0o644)
		}
	}

	now := time.Now()
	yesterday := now.Add(-3 * 24 * time.Hour) // 3 days ago

	// Project A: Has 1 active session (today) and 1 old session (3 days ago)
	createTestSession("projA-active", "projA", "Proj A Active", now, time.Time{})
	createTestSession("projA-old", "projA", "Proj A Old", yesterday, time.Time{})

	// Project B: Has NO active sessions (only 2 old sessions: 5 days ago and 3 days ago)
	createTestSession("projB-older", "projB", "Proj B Older", yesterday.Add(-2*24*time.Hour), time.Time{})
	createTestSession("projB-latest-old", "projB", "Proj B Latest Old", yesterday, time.Time{})

	res := ListIdeSessions(nil, false)

	// We expect:
	// - projA: ONLY "projA-active" (projA-old filtered out because projA has active session)
	// - projB: ONLY "projB-latest-old" (projB has no active, fallback to last session)
	if len(res) != 2 {
		t.Fatalf("expected exactly 2 sessions, got %d", len(res))
	}

	foundAActive := false
	foundBLatest := false
	for _, s := range res {
		cid := s["cascadeId"].(string)
		if cid == "projA-active" {
			foundAActive = true
		}
		if cid == "projA-old" {
			t.Errorf("projA-old should NOT be included when an active session exists for projA")
		}
		if cid == "projB-latest-old" {
			foundBLatest = true
		}
		if cid == "projB-older" {
			t.Errorf("projB-older should NOT be included, only the latest old session")
		}
	}

	if !foundAActive {
		t.Errorf("expected projA-active to be present")
	}
	if !foundBLatest {
		t.Errorf("expected projB-latest-old to be present as fallback")
	}
}

func TestFilterIdeSessionsWithRule(t *testing.T) {
	now := time.Now()
	oldTime := now.Add(-72 * time.Hour) // 3 days ago

	items := []map[string]interface{}{
		// Antigravity 2.0 sessions (isIde == false): ALL must be preserved (1:1 sync with 2.0)
		{
			"cascadeId": "2.0-session-1",
			"workspace": "my-project",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": oldTime.Format(time.RFC3339),
			"isIde":     false,
		},
		{
			"cascadeId": "2.0-session-2",
			"workspace": "my-project",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": oldTime.Add(-1 * time.Hour).Format(time.RFC3339),
			"isIde":     false,
		},

		// IDE sessions for ide-proj-A: 1 active (today) + 1 old (3 days ago)
		{
			"cascadeId": "ide-projA-active",
			"workspace": "ide-proj-A",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": now.Format(time.RFC3339),
			"isIde":     true,
		},
		{
			"cascadeId": "ide-projA-old",
			"workspace": "ide-proj-A",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": oldTime.Format(time.RFC3339),
			"isIde":     true,
		},

		// IDE sessions for ide-proj-B: 2 old sessions (no active)
		{
			"cascadeId": "ide-projB-latest",
			"workspace": "ide-proj-B",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": oldTime.Format(time.RFC3339),
			"isIde":     true,
		},
		{
			"cascadeId": "ide-projB-older",
			"workspace": "ide-proj-B",
			"status":    "CASCADE_STATUS_READY",
			"updatedAt": oldTime.Add(-24 * time.Hour).Format(time.RFC3339),
			"isIde":     true,
		},
	}

	filtered := filterIdeSessionsWithRule(items, nil)

	// Expecting:
	// - BOTH 2.0 sessions preserved: "2.0-session-1" and "2.0-session-2" (len 2)
	// - ide-proj-A: ONLY "ide-projA-active" (len 1)
	// - ide-proj-B: ONLY "ide-projB-latest" (len 1)
	// Total: 4
	if len(filtered) != 4 {
		t.Fatalf("expected 4 sessions, got %d", len(filtered))
	}

	foundMap := make(map[string]bool)
	for _, f := range filtered {
		cid := f["cascadeId"].(string)
		foundMap[cid] = true
	}

	if !foundMap["2.0-session-1"] || !foundMap["2.0-session-2"] {
		t.Errorf("Antigravity 2.0 sessions must be preserved for 1:1 sync")
	}
	if !foundMap["ide-projA-active"] {
		t.Errorf("expected active IDE session to be included")
	}
	if foundMap["ide-projA-old"] {
		t.Errorf("ide-projA-old should be filtered out")
	}
	if !foundMap["ide-projB-latest"] {
		t.Errorf("expected latest IDE session as fallback for projB")
	}
	if foundMap["ide-projB-older"] {
		t.Errorf("ide-projB-older should be filtered out")
	}
}
