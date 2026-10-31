package connectrpc

import (
	"testing"
	"time"
)

// TestParseJetboxFrameSnapshots — le snapshot initial du stream
// JetboxSubscribeToSummaries arrive dans une frame {updates: {...}} : chaque
// entrée doit être mappée vers JetboxSummary avec titre, workspace, projet,
// statut et horodatage. Le filtre subagent (source 16) s'appuie sur Source.
func TestParseJetboxFrameSnapshots(t *testing.T) {
	frame := []byte(`{
		"updates": {
			"11111111-2222-3333-4444-555555555555": {
				"summary": "fix the build",
				"stepCount": 3,
				"lastModifiedTime": "2026-08-15T10:00:00Z",
				"trajectoryId": "traj-1",
				"status": "CASCADE_RUN_STATUS_IDLE",
				"annotations": {"archived": false},
				"trajectoryMetadata": {"projectId": "proj-a"},
				"workspaces": [{"workspaceFolderAbsoluteUri": "file:///c:/work"}],
				"source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
				"killed": false
			}
		},
		"deletes": ["99999999-0000-0000-0000-000000000000"]
	}`)

	updates, deletes := ParseJetboxFrame(frame)
	if len(deletes) != 1 || deletes[0] != "99999999-0000-0000-0000-000000000000" {
		t.Fatalf("deletes inattendus: %v", deletes)
	}
	s, ok := updates["11111111-2222-3333-4444-555555555555"]
	if !ok {
		t.Fatalf("update manquant pour la cascade test")
	}
	if s.Title != "fix the build" {
		t.Errorf("Title: %q", s.Title)
	}
	if s.Workspace != "file:///c:/work" {
		t.Errorf("Workspace: %q", s.Workspace)
	}
	if s.ProjectID != "proj-a" {
		t.Errorf("ProjectID: %q", s.ProjectID)
	}
	if s.Status != "CASCADE_STATUS_READY" {
		t.Errorf("Status: %q", s.Status)
	}
	if s.Source != 1 {
		t.Errorf("Source: %d", s.Source)
	}
	want := time.Date(2026, 8, 15, 10, 0, 0, 0, time.UTC)
	if !s.UpdatedAt.Equal(want) {
		t.Errorf("UpdatedAt: %v, attendu %v", s.UpdatedAt, want)
	}
}

// TestParseJetboxFrameNumericEnums — le LS peut sérialiser les enums en
// nombres (status 1=IDLE, source 16=SUBAGENT) au lieu de strings : le parseur
// doit accepter les deux formes.
func TestParseJetboxFrameNumericEnums(t *testing.T) {
	frame := []byte(`{
		"updates": {
			"aaa": {"status": 2, "source": 16, "notFullyIdle": true, "waitingSteps": []},
			"bbb": {"status": "CASCADE_RUN_STATUS_BUSY", "source": "CORTEX_TRAJECTORY_SOURCE_SUBAGENT"}
		}
	}`)
	updates, _ := ParseJetboxFrame(frame)
	a := updates["aaa"]
	if a.Status != "CASCADE_STATUS_RUNNING" {
		t.Errorf("aaa.Status: %q", a.Status)
	}
	if a.Source != 16 {
		t.Errorf("aaa.Source: %d", a.Source)
	}
	if !a.Waiting {
		t.Errorf("aaa.Waiting: attendu true (notFullyIdle)")
	}
	b := updates["bbb"]
	if b.Status != "CASCADE_STATUS_RUNNING" {
		t.Errorf("bbb.Status: %q", b.Status)
	}
	if b.Source != 16 {
		t.Errorf("bbb.Source: %d", b.Source)
	}
}

// TestParseJetboxFrameEmpty — une frame sans updates ni deletes (heartbeat)
// doit retourner des slices nil sans erreur.
func TestParseJetboxFrameEmpty(t *testing.T) {
	updates, deletes := ParseJetboxFrame([]byte(`{}`))
	if len(updates) != 0 || len(deletes) != 0 {
		t.Fatalf("frame vide: attendu 0/0, reçu %v / %v", updates, deletes)
	}
	updates, deletes = ParseJetboxFrame([]byte(`not json`))
	if updates != nil || deletes != nil {
		t.Fatalf("JSON invalide: attendu nil, reçu %v / %v", updates, deletes)
	}
}

// TestJetboxArchivedKilled — archived/killed doivent rester dans la carte
// (le filtre d'affichage est appliqué côté gateway), avec statut dédié.
func TestJetboxArchivedKilled(t *testing.T) {
	frame := []byte(`{
		"updates": {
			"a1": {"annotations": {"archived": true}, "summary": "archived session"},
			"a2": {"killed": true, "summary": "killed session"}
		}
	}`)
	updates, _ := ParseJetboxFrame(frame)
	if !updates["a1"].Archived || updates["a1"].Status != "CASCADE_STATUS_ARCHIVED" {
		t.Errorf("a1: archived=%v status=%q", updates["a1"].Archived, updates["a1"].Status)
	}
	if !updates["a2"].Killed || updates["a2"].Status != "CASCADE_STATUS_KILLED" {
		t.Errorf("a2: killed=%v status=%q", updates["a2"].Killed, updates["a2"].Status)
	}
}
