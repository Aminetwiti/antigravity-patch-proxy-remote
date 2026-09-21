package gateway

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestWorkspaceCacheConcurrencyRace vérifie qu'aucun data race ni panique ne se produit
// lors d'accès massivement concurrents (50 lecteurs + 10 invalideurs) sur ListOfficialProjects et listWorkspaces.
func TestWorkspaceCacheConcurrencyRace(t *testing.T) {
	var wg sync.WaitGroup
	workers := 40
	invalidatorWorkers := 10
	iterations := 100

	// Invalidation concurrente
	for i := 0; i < invalidatorWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				InvalidateProjectsCache()
				time.Sleep(100 * time.Microsecond)
			}
		}()
	}

	// Lectures concurrentes de ListOfficialProjects
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				projs := ListOfficialProjects()
				_ = len(projs)
				ws := listWorkspaces()
				_ = len(ws)
				u := GetUniqueWorkspaces()
				_ = len(u)
			}
		}()
	}

	wg.Wait()
}

// TestOverlappingWorkspacePathMatching vérifie la résolution précise et déterministe
// en cas de projets aux chemins imbriqués ou aux noms ambigus (ex: repo vs repo/packages/client).
func TestOverlappingWorkspacePathMatching(t *testing.T) {
	cachedProjects = []ProjectSummary{
		{
			ID:        "proj-root",
			Name:      "my-monorepo",
			FolderURI: "file:///c:/users/amine/projects/my-monorepo",
			Path:      "c:/users/amine/projects/my-monorepo",
		},
		{
			ID:        "proj-sub",
			Name:      "my-subapp",
			FolderURI: "file:///c:/users/amine/projects/my-monorepo/packages/my-subapp",
			Path:      "c:/users/amine/projects/my-monorepo/packages/my-subapp",
		},
		{
			ID:        "proj-encoded",
			Name:      "c:\\Users\\amine\\OmniRoute",
			FolderURI: "file:///c%3A%5CUsers%5Camine%5COmniRoute",
			Path:      "c:/Users/amine/OmniRoute",
		},
	}
	projectsCachedAt = time.Now().Add(10 * time.Hour) // cache chaud
	defer InvalidateProjectsCache()

	// 1. URI sous le sous-projet -> doit matcher proj-sub
	id1 := projectIDFromRegistry("file:///c:/users/amine/projects/my-monorepo/packages/my-subapp")
	if id1 != "proj-sub" {
		t.Errorf("Attendu 'proj-sub', reçu '%s'", id1)
	}

	// 2. URI encodée avec %5C pour OmniRoute -> doit matcher proj-encoded
	id2 := projectIDFromRegistry("file:///c%3A%5CUsers%5Camine%5COmniRoute")
	if id2 != "proj-encoded" {
		t.Errorf("Attendu 'proj-encoded', reçu '%s'", id2)
	}

	// 3. Chemin Windows avec antislashs pour OmniRoute
	id3 := projectIDFromRegistry("c:\\Users\\amine\\OmniRoute")
	if id3 != "proj-encoded" {
		t.Errorf("Attendu 'proj-encoded' via chemin natif, reçu '%s'", id3)
	}
}

// TestSubagentsExclusionFromSessionsAndWorkspaces vérifie sous concurrence élevée
// que les sous-agents générés en arrière-plan ne polluent jamais la liste des sessions ni des projets.
func TestSubagentsExclusionFromSessionsAndWorkspaces(t *testing.T) {
	srv := &Server{
		activeCascades: make(map[string]bool),
		approvals:      make(map[string]*pendingApproval),
	}

	// Simule un mix de sessions utilisateur et de sous-agents internes
	jetbox := map[string]connectrpc.JetboxSummary{
		"user-session-1": {
			CascadeID: "user-session-1",
			Title:     "Ajout du mode sombre",
			Workspace: "file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main",
			ProjectID: "cd157ca6-2bd3-4557-be26-cf478dfe0e46",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: time.Now(),
			StepCount: 5,
		},
		"subagent-cleaner": {
			CascadeID: "subagent-cleaner-123",
			Title:     "subagent-Cleanup-planner-researcher",
			Workspace: "subagent-Cleanup-planner-researcher",
			Status:    "CASCADE_STATUS_RUNNING",
			UpdatedAt: time.Now(),
			Source:    16, // SUBAGENT
		},
		"subagent-doc": {
			CascadeID: "subagent-doc-456",
			Title:     "subagent_Documentation_author",
			Workspace: "subagent_Documentation_author",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: time.Now(),
		},
		"subagent-prompt": {
			CascadeID: "subagent-sys-789",
			Title:     "System: Execute background lint",
			Workspace: "antigravity-workspace",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: time.Now(),
		},
	}

	out := srv.sessionsFromSummariesLocked(jetbox)
	sessions, ok := out["sessions"].([]map[string]interface{})
	if !ok {
		t.Fatalf("Format de sessions invalide")
	}

	// Seule la session utilisateur doit subsister
	for _, s := range sessions {
		cid, _ := s["cascadeId"].(string)
		title, _ := s["title"].(string)
		ws, _ := s["workspace"].(string)

		if strings.HasPrefix(cid, "subagent-") || strings.HasPrefix(title, "subagent") || strings.HasPrefix(ws, "subagent") {
			t.Errorf("Sous-agent détecté dans les sessions: cascadeId=%s, title=%s, ws=%s", cid, title, ws)
		}
		if strings.HasPrefix(strings.ToLower(title), "system:") {
			t.Errorf("Session système détectée dans les sessions: title=%s", title)
		}
	}
}

// TestWindowsUriAndPathNormalizationIdempotence teste l'idempotence et les cas extrêmes de normalisation.
func TestWindowsUriAndPathNormalizationIdempotence(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
	}{
		{"file:///c%3A/Users/developer/test", "c:/Users/developer/test"},
		{"file:///c%3A%5CUsers%5Cdeveloper%5COmniRoute", "c:/Users/developer/OmniRoute"},
		{"C:\\Users\\developer\\Desktop\\client-project\\posweb", "C:/Users/developer/Desktop/client-project/posweb"},
		{"file:///C:/Users/developer/Downloads/demo%20taxi/www%20-%20Copie/", "C:/Users/developer/Downloads/demo taxi/www - Copie"},
		{"c:/Users/developer/repo", "c:/Users/developer/repo"},
		{"", ""},
	}

	for _, tc := range testCases {
		res := normalizeWorkspace(tc.input)
		cleanExpected := filepath.ToSlash(tc.expected)
		if !strings.EqualFold(filepath.ToSlash(res), cleanExpected) {
			t.Errorf("normalizeWorkspace(%q) = %q, attendu %q", tc.input, res, cleanExpected)
		}
		// Vérification de l'idempotence : f(f(x)) == f(x)
		secondPass := normalizeWorkspace(res)
		if secondPass != res {
			t.Errorf("Normalisation non idempotente pour %q: %q != %q", tc.input, secondPass, res)
		}
	}
}

// TestConcurrentSessionFilteringConsistency simule 30 requêtes concurrentes de sessions
// avec mutation concurrente de l'état actif (running/approvals).
func TestConcurrentSessionFilteringConsistency(t *testing.T) {
	srv := &Server{
		activeCascades: make(map[string]bool),
		approvals:      make(map[string]*pendingApproval),
	}

	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			cid := fmt.Sprintf("session-%d", idx)

			// Mutate state
			srv.mu.Lock()
			if idx%2 == 0 {
				srv.activeCascades[cid] = true
			} else {
				srv.approvals[cid] = &pendingApproval{cascadeID: cid, expired: false}
			}
			srv.mu.Unlock()

			// Query sessions
			jetbox := map[string]connectrpc.JetboxSummary{
				cid: {
					CascadeID: cid,
					Title:     fmt.Sprintf("User Session %d", idx),
					Workspace: "file:///c:/Users/amine/OmniRoute",
					Status:    "CASCADE_STATUS_READY",
					UpdatedAt: time.Now(),
					StepCount: 2,
				},
			}

			res := srv.sessionsFromSummaries(jetbox)
			if res == nil {
				t.Errorf("Résultat nil pour index %d", idx)
			}
		}(i)
	}

	wg.Wait()
}
