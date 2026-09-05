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
