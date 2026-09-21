package gateway

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestRareCase_MonorepoPrefixCollisionsAndSpecialCharacters vérifie que matchOfficialProject
// ne fait aucun faux positif sur les préfixes similaires (www vs www - Copie, app vs app_v2, etc.)
func TestRareCase_MonorepoPrefixCollisionsAndSpecialCharacters(t *testing.T) {
	projects := []ProjectSummary{
		{
			ID:        "p-www",
			Name:      "www",
			Path:      "c:/demo taxi/www",
			FolderURI: "file:///c:/demo%20taxi/www",
		},
		{
			ID:        "p-www-copie",
			Name:      "www - Copie",
			Path:      "c:/demo taxi/www - Copie",
			FolderURI: "file:///c:/demo%20taxi/www%20-%20Copie",
		},
		{
			ID:        "p-www-sub",
			Name:      "www-frontend",
			Path:      "c:/demo taxi/www/frontend",
			FolderURI: "file:///c:/demo%20taxi/www/frontend",
		},
		{
			ID:        "p-unicode",
			Name:      "Café & Société",
			Path:      "c:/projets/café & société",
			FolderURI: "file:///c:/projets/caf%C3%A9%20&%20soci%C3%A9t%C3%A9",
		},
	}

	testCases := []struct {
		name         string
		projID       string
		wsPath       string
		wsName       string
		expectedName string
		expectedPath string
		expectedID   string
	}{
		{
			name:         "Exact path match for www - Copie",
			wsPath:       "C:\\demo taxi\\www - Copie",
			expectedName: "www - Copie",
			expectedPath: "c:/demo taxi/www - Copie",
			expectedID:   "p-www-copie",
		},
		{
			name:         "URL-encoded path match for www - Copie",
			wsPath:       "file:///c%3A/demo%20taxi/www%20-%20Copie",
			expectedName: "www - Copie",
			expectedPath: "c:/demo taxi/www - Copie",
			expectedID:   "p-www-copie",
		},
		{
			name:         "Subfolder inside www/frontend matches most specific child www-frontend",
			wsPath:       "c:/demo taxi/www/frontend/src/components",
			expectedName: "www-frontend",
			expectedPath: "c:/demo taxi/www/frontend",
			expectedID:   "p-www-sub",
		},
		{
			name:         "Subfolder inside www (outside frontend) matches www",
			wsPath:       "c:/demo taxi/www/backend/api",
			expectedName: "www",
			expectedPath: "c:/demo taxi/www",
			expectedID:   "p-www",
		},
		{
			name:         "Unicode and special characters match",
			wsPath:       "C:\\projets\\café & société\\app",
			expectedName: "Café & Société",
			expectedPath: "c:/projets/café & société",
			expectedID:   "p-unicode",
		},
		{
			name:         "Unrelated path returns empty match",
			wsPath:       "c:/demo taxi/www-other-project",
			expectedName: "",
			expectedPath: "c:/demo taxi/www-other-project",
			expectedID:   "",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mName, mPath, mID := matchOfficialProject(tc.projID, tc.wsPath, tc.wsName, projects)
			if mName != tc.expectedName {
				t.Errorf("expected project name %q, got %q", tc.expectedName, mName)
			}
			if mPath != tc.expectedPath {
				t.Errorf("expected project path %q, got %q", tc.expectedPath, mPath)
			}
			if mID != tc.expectedID {
				t.Errorf("expected project ID %q, got %q", tc.expectedID, mID)
			}
		})
	}
}

// TestRareCase_ArchivePbtxtFormatVariations teste toutes les variantes réelles
// de sérialisation Protobuf d'archivage écrites par l'IDE sur disque
func TestRareCase_ArchivePbtxtFormatVariations(t *testing.T) {
	tempHome, err := os.MkdirTemp("", "antigravity_archive_test_*")
	if err != nil {
		t.Fatalf("failed to create temp home: %v", err)
	}
	defer os.RemoveAll(tempHome)

	annoDir := filepath.Join(tempHome, ".gemini", "antigravity", "annotations")
	if err := os.MkdirAll(annoDir, 0755); err != nil {
		t.Fatalf("failed to create annotations dir: %v", err)
	}

	// 1. Session avec archived:true et timestamp
	_ = os.WriteFile(
		filepath.Join(annoDir, "sess-1.pbtxt"),
		[]byte("archived:true archival_status_timestamp:{seconds:1787151750 nanos:115769200}"),
		0644,
	)
	// 2. Session avec uniquement archival_status_timestamp (sans archived:true explicite)
	_ = os.WriteFile(
		filepath.Join(annoDir, "sess-2.pbtxt"),
		[]byte("archival_status_timestamp:{seconds:1787240250 nanos:997779200} last_user_view_time:{seconds:1787150306 nanos:863000000}"),
		0644,
	)
	// 3. Session désarchivée explicitement (archived: false)
	_ = os.WriteFile(
		filepath.Join(annoDir, "sess-3.pbtxt"),
		[]byte("archived: false last_user_view_time:{seconds:1787150306 nanos:863000000}"),
		0644,
	)
	// 4. Session active normale (sans archive)
	_ = os.WriteFile(
		filepath.Join(annoDir, "sess-4.pbtxt"),
		[]byte("last_user_view_time:{seconds:1787150306 nanos:863000000} marked_as_unread:false"),
		0644,
	)
	// 5. Session marquée supprimée
	_ = os.WriteFile(
		filepath.Join(annoDir, "sess-5.pbtxt"),
		[]byte("deleted: true last_user_view_time:{seconds:1787150306 nanos:863000000}"),
		0644,
	)

	if !isSessionArchived(tempHome, "sess-1") {
		t.Errorf("sess-1 should be archived")
	}
	if !isSessionArchived(tempHome, "sess-2") {
		t.Errorf("sess-2 (timestamp only) should be archived")
	}
	if isSessionArchived(tempHome, "sess-3") {
		t.Errorf("sess-3 (unarchived) should NOT be archived")
	}
	if isSessionArchived(tempHome, "sess-4") {
		t.Errorf("sess-4 (active) should NOT be archived")
	}
	if !isSessionArchived(tempHome, "sess-5") {
		t.Errorf("sess-5 (deleted) should be considered archived/unavailable")
	}
}

// TestRareCase_StateVersionMonotonicityConcurrent vérifie que les broadcasts
// et sessionsFromSummaries incrémentent strictement stateVersion sous concurrence
func TestRareCase_StateVersionMonotonicityConcurrent(t *testing.T) {
	srv := &Server{
		stateVersion:   0,
		activeCascades: make(map[string]bool),
		approvals:      make(map[string]*pendingApproval),
	}

	jetbox := map[string]connectrpc.JetboxSummary{
		"s1": {
			CascadeID: "s1",
			Title:     "Active Session",
			Workspace: "c:/project",
			Status:    "CASCADE_STATUS_READY",
		},
	}

	const goroutines = 20
	const iterations = 50

	var wg sync.WaitGroup
	var versions sync.Map

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				res := srv.sessionsFromSummaries(jetbox)
				v, ok := res["version"].(int64)
				if !ok || v <= 0 {
					t.Errorf("invalid version generated: %v", res["version"])
				}
				versions.Store(v, true)
			}
		}()
	}

	wg.Wait()

	// Vérifie que nous avons généré exactement goroutines * iterations versions distinctes
	count := 0
	versions.Range(func(key, value any) bool {
		count++
		return true
	})

	if count != goroutines*iterations {
		t.Errorf("expected %d unique versions, got %d", goroutines*iterations, count)
	}

	if srv.stateVersion != int64(goroutines*iterations) {
		t.Errorf("expected final stateVersion %d, got %d", goroutines*iterations, srv.stateVersion)
	}
}

// TestRareCase_CustomTitlePrimingOverGenericJetboxSummary vérifie que le renommage
// utilisateur prime toujours sur les résumés génériques Jetbox
func TestRareCase_CustomTitlePrimingOverGenericJetboxSummary(t *testing.T) {
	srv := &Server{
		stateVersion:   0,
		activeCascades: make(map[string]bool),
	}

	cascadeID := "casc-title-test-999"
	customTitle := "Audit Sécurité NaviCab 2.0"

	convTitlesMu.Lock()
	globalConvTitles[cascadeID] = customTitle
	convTitlesMu.Unlock()

	// Le flux Jetbox renvoie un titre par défaut ou obsolète
	jetbox := map[string]connectrpc.JetboxSummary{
		cascadeID: {
			CascadeID: cascadeID,
			Title:     "Cascade Session",
			Workspace: "c:/project",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: time.Now(),
		},
	}

	res := srv.sessionsFromSummaries(jetbox)
	sessions, ok := res["sessions"].([]map[string]interface{})
	if !ok || len(sessions) == 0 {
		t.Fatalf("expected at least 1 session in output")
	}

	if sessions[0]["title"] != customTitle {
		t.Errorf("expected custom title %q, got %q", customTitle, sessions[0]["title"])
	}
}
