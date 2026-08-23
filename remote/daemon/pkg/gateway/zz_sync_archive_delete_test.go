package gateway

// Tests de la synchronisation temps réel archive/suppression (P0) :
// 1. delete_cascade purge la carte Jetbox + invalide le cache cold-path
//    → la session supprimée ne réapparaît PLUS dans list_sessions (même
//    avec le cache encore chaud), et le broadcast sessions_updated part.
// 2. une frame Jetbox avec annotations.archived=true (archive depuis le PC)
//    est broadcastée en sessions_updated et la session archivée est exclue
//    de la payload.
// 3. la chaîne de filtrage des sessions locales (fallback) ignore les
//    sessions archivées (annotations .pbtxt).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestDeleteCascadePurgesSessionFromList — après un delete_cascade réussi :
// la session a disparu de la carte Jetbox ET du cache cold-path. Un
// list_sessions immédiat (servi depuis le cache) ne doit plus la contenir.
func TestDeleteCascadePurgesSessionFromList(t *testing.T) {
	backend := &fakeRPCClient{}
	ts, gw := newTestServerWithGW(backend)
	defer ts.Close()

	// Carte Jetbox chaude avec 2 sessions.
	gw.mu.Lock()
	gw.jetboxSummaries = map[string]connectrpc.JetboxSummary{
		"casc-keep": {CascadeID: "casc-keep", Title: "gardée", Status: "CASCADE_STATUS_READY"},
		"casc-del":  {CascadeID: "casc-del", Title: "à supprimer", Status: "CASCADE_STATUS_READY"},
	}
	gw.mu.Unlock()

	// Cache cold-path volontairement chaud (TTL 5 s) : il ne doit pas
	// ressusciter la session supprimée.
	gw.mu.Lock()
	gw.sessionsCache = []byte(`{"request":{"casc-del":"stale"}}`)
	gw.sessionsCachedAt = time.Now()
	gw.mu.Unlock()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// Suppression confirmée.
	client.send(t, map[string]string{"type": "delete_cascade", "requestId": "rD", "cascadeId": "casc-del", "confirm": "true"})
	if msg := client.recv(t); msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse delete inattendue: %v", msg)
	}

	// Le broadcast sessions_updated suit la réponse.
	msg := client.recv(t)
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu broadcast sessions_updated, reçu %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	sessions, _ := data["sessions"].([]interface{})
	if len(sessions) != 1 {
		t.Fatalf("attendu 1 session après delete, reçu %d (%v)", len(sessions), sessions)
	}
	if first := sessions[0].(map[string]interface{}); first["cascadeId"] != "casc-keep" {
		t.Fatalf("session restante inattendue: %v", first)
	}

	// Assertions internes directes : la purge doit être effective côté serveur.
	gw.mu.Lock()
	if _, stillThere := gw.jetboxSummaries["casc-del"]; stillThere {
		gw.mu.Unlock()
		t.Fatal("carte Jetbox : la session supprimée est toujours présente")
	}
	cacheNil := gw.sessionsCache == nil
	gw.mu.Unlock()
	if !cacheNil {
		t.Fatal("cache cold-path : sessionsCache n'a pas été invalidé après delete")
	}

	// list_sessions immédiat : servi depuis la carte Jetbox (chaud) — la
	// session supprimée ne doit pas réapparaître.
	client.send(t, map[string]string{"type": "list_sessions", "requestId": "rL"})
	msg = client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rL" {
		t.Fatalf("réponse list_sessions inattendue: %v", msg)
	}
	data, _ = msg["data"].(map[string]interface{})
	sessions, _ = data["sessions"].([]interface{})
	for _, s := range sessions {
		if sm, ok := s.(map[string]interface{}); ok && sm["cascadeId"] == "casc-del" {
			t.Fatalf("session supprimée réapparue dans list_sessions: %v", sm)
		}
	}
}

// TestJetboxArchiveBroadcastExcludesArchived — une frame Jetbox portant
// annotations.archived=true (archive déclenchée depuis Antigravity 2.0) est
// broadcastée en sessions_updated et la session archivée est exclue de la
// payload : le mobile la fait disparaître de la sidebar.
func TestJetboxArchiveBroadcastExcludesArchived(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	jetbox := newFakeJetboxStreamer()
	defer jetbox.closeStream()
	gw.RunJetboxSubscription(jetbox)

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()
	time.Sleep(30 * time.Millisecond)

	recvSessionsUpdated := func() map[string]interface{} {
		for i := 0; i < 15; i++ {
			m, err := client.recvSafe()
			if err != nil {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			if m["type"] == "sessions_updated" {
				return m
			}
		}
		t.Fatalf("attendu sessions_updated, aucun reçu")
		return nil
	}

	// Snapshot initial : 2 sessions actives.
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"casc-a": {CascadeID: "casc-a", Title: "active", Status: "CASCADE_STATUS_READY"},
		"casc-b": {CascadeID: "casc-b", Title: "à archiver", Status: "CASCADE_STATUS_READY"},
	}, nil)
	if msg := recvSessionsUpdated(); msg["type"] != "sessions_updated" {
		t.Fatalf("attendu sessions_updated (snapshot), reçu %v", msg)
	}

	// L'utilisateur archive casc-b depuis le PC → le LS pousse une frame
	// avec annotations.archived=true (le streamer la convertit en
	// Archived=true + Status=CASCADE_STATUS_ARCHIVED).
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"casc-b": {CascadeID: "casc-b", Title: "à archiver", Status: "CASCADE_STATUS_ARCHIVED", Archived: true},
	}, nil)

	msg := recvSessionsUpdated()
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu sessions_updated (archive), reçu %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	sessions, _ := data["sessions"].([]interface{})
	if len(sessions) != 1 {
		t.Fatalf("attendu 1 session (archivée exclue), reçu %d (%v)", len(sessions), sessions)
	}
	if first := sessions[0].(map[string]interface{}); first["cascadeId"] != "casc-a" {
		t.Fatalf("session restante inattendue: %v", first)
	}
}

// TestJetboxArchiveExcludedFromListSessions — la carte Jetbox alimente
// list_sessions (hot path) : une session archivée n'y figure plus.
func TestJetboxArchiveExcludedFromListSessions(t *testing.T) {
	backend := &fakeRPCClient{}
	ts, gw := newTestServerWithGW(backend)
	defer ts.Close()

	gw.mu.Lock()
	gw.jetboxSummaries = map[string]connectrpc.JetboxSummary{
		"casc-a": {CascadeID: "casc-a", Title: "active", Status: "CASCADE_STATUS_READY"},
		"casc-z": {CascadeID: "casc-z", Title: "archivée", Status: "CASCADE_STATUS_ARCHIVED", Archived: true},
	}
	gw.mu.Unlock()

	// La payload list_sessions dérivée de la carte doit exclure l'archivée
	// SANS toucher au fallback local (sinon 19 vrais dossiers brain locaux
	// polluent le test) : on passe par le même chemin que le handler, mais
	// à travers le parseur de carte (source de vérité temps réel).
	out := sessionsFromSummaries(gw.jetboxSummaries)
	sessions, _ := out["sessions"].([]map[string]interface{})
	if len(sessions) != 1 {
		t.Fatalf("attendu 1 session (archivée exclue), reçu %d (%v)", len(sessions), out)
	}
	if sessions[0]["cascadeId"] != "casc-a" {
		t.Fatalf("session restante inattendue: %v", sessions[0])
	}
}

// TestListLocalSessionsSkipsArchived — le fallback local (hub vide) ignore
// les sessions archivées : un fichier annotations/<cascadeId>.pbtxt avec
// archived: true suffit à les exclure.
func TestListLocalSessionsSkipsArchived(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	annoDir := filepath.Join(home, ".gemini", "antigravity", "annotations")
	if err := os.MkdirAll(annoDir, 0o755); err != nil {
		t.Fatalf("MkdirAll annotations: %v", err)
	}
	// Ne pas écraser une vraie annotation de l'utilisateur : ID de test unique.
	testID := "deadbeef-0000-4000-8000-00000000dead"
	annoPath := filepath.Join(annoDir, testID+".pbtxt")
	if _, err := os.Stat(annoPath); err == nil {
		t.Skipf("annotation existante %s — test ignoré (fichier réel)", annoPath)
	}
	if err := os.WriteFile(annoPath, []byte("cascade_id: \""+testID+"\"\narchived: true\n"), 0o644); err != nil {
		t.Fatalf("WriteFile annotation: %v", err)
	}
	defer os.Remove(annoPath)

	if !isSessionArchived(home, testID) {
		t.Fatalf("isSessionArchived(%s) = false, attendu true", testID)
	}

	// Et les sessions locales listées n'incluent pas la session archivée.
	sessions := ListLocalSessions()
	for _, s := range sessions {
		if id, _ := s["cascadeId"].(string); id == testID {
			t.Fatalf("session archivée %s listée par ListLocalSessions", testID)
		}
	}
}

// TestArchiveAndUnarchiveCascadeActions — vérifie que les messages WebSocket
// archive_cascade et unarchive_cascade écrivent sur disque, mettent à jour la
// carte Jetbox et diffusent sessions_updated.
func TestArchiveAndUnarchiveCascadeActions(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	annoDir := filepath.Join(home, ".gemini", "antigravity", "annotations")
	_ = os.MkdirAll(annoDir, 0o755)

	testID := "feedface-0000-4000-8000-00000000act2"
	annoPath := filepath.Join(annoDir, testID+".pbtxt")
	_ = os.WriteFile(annoPath, []byte("cascade_id: \""+testID+"\"\n"), 0o644)
	defer os.Remove(annoPath)

	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	gw.mu.Lock()
	gw.jetboxSummaries = map[string]connectrpc.JetboxSummary{
		testID: {CascadeID: testID, Title: "test archive", Status: "CASCADE_STATUS_READY"},
	}
	gw.mu.Unlock()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Archiver via WebSocket
	client.send(t, map[string]string{"type": "archive_cascade", "requestId": "rA1", "cascadeId": testID})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse archive inattendue: %v", msg)
	}

	// Réception du broadcast sessions_updated
	msg = client.recv(t)
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu broadcast sessions_updated, reçu %v", msg)
	}

	// Vérifie sur disque
	if !isSessionArchived(home, testID) {
		content, _ := os.ReadFile(annoPath)
		t.Fatalf("isSessionArchived(%s) = false après archive_cascade, attendu true (msg=%v, file=%q)", testID, msg, string(content))
	}

	// 2. Désarchiver via WebSocket
	client.send(t, map[string]string{"type": "unarchive_cascade", "requestId": "rU1", "cascadeId": testID})
	msg = client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse unarchive inattendue: %v", msg)
	}

	// Réception du broadcast sessions_updated
	msg = client.recv(t)
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu broadcast sessions_updated, reçu %v", msg)
	}

	// Vérifie sur disque
	if isSessionArchived(home, testID) {
		t.Fatalf("isSessionArchived(%s) = true après unarchive_cascade, attendu false", testID)
	}
}

// TestSessionsFromSummariesSortsByUpdatedAtDesc vérifie que la payload list_sessions
// et sessions_updated trie strictement les sessions par date updatedAt décroissante.
func TestSessionsFromSummariesSortsByUpdatedAtDesc(t *testing.T) {
	now := time.Now()
	summaries := map[string]connectrpc.JetboxSummary{
		"sess-old": {
			CascadeID: "sess-old",
			Title:     "Old Session",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: now.Add(-10 * time.Minute),
			StepCount: 5,
		},
		"sess-recent": {
			CascadeID: "sess-recent",
			Title:     "Recent Session",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: now.Add(-1 * time.Minute),
			StepCount: 5,
		},
		"sess-active": {
			CascadeID: "sess-active",
			Title:     "Active Session",
			Status:    "CASCADE_STATUS_RUNNING",
			UpdatedAt: now,
			StepCount: 5,
		},
	}

	gw := &Server{}
	res := gw.sessionsFromSummaries(summaries)
	sessions, ok := res["sessions"].([]map[string]interface{})
	if !ok {
		t.Fatalf("sessions invalides: %v", res["sessions"])
	}
	if len(sessions) != 3 {
		t.Fatalf("attendu 3 sessions, reçu %d", len(sessions))
	}

	if sessions[0]["cascadeId"] != "sess-active" {
		t.Errorf("attendu sess-active en 1er, reçu %v", sessions[0]["cascadeId"])
	}
	if sessions[1]["cascadeId"] != "sess-recent" {
		t.Errorf("attendu sess-recent en 2ème, reçu %v", sessions[1]["cascadeId"])
	}
	if sessions[2]["cascadeId"] != "sess-old" {
		t.Errorf("attendu sess-old en 3ème, reçu %v", sessions[2]["cascadeId"])
	}
}

// TestRenameCascadeSyncsToDisk vérifie que rename_cascade persiste custom_title
// dans les annotations sur disque et diffuse sessions_updated.
func TestRenameCascadeSyncsToDisk(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("UserHomeDir indisponible")
	}

	testID := "feedface-0000-4000-8000-00000000ren1"
	defer func() {
		for _, sub := range []string{"antigravity", "antigravity-ide"} {
			_ = os.Remove(filepath.Join(home, ".gemini", sub, "annotations", testID+".pbtxt"))
		}
	}()

	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	gw.mu.Lock()
	gw.jetboxSummaries = map[string]connectrpc.JetboxSummary{
		testID: {CascadeID: testID, Title: "titre original", Status: "CASCADE_STATUS_READY"},
	}
	gw.mu.Unlock()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type":      "rename_cascade",
		"requestId": "rR1",
		"cascadeId": testID,
		"prompt":    "Nouveau Titre Renommé",
	})

	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse rename inattendue: %v", msg)
	}

	// Broadcast sessions_updated
	msg = client.recv(t)
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu broadcast sessions_updated, reçu %v", msg)
	}

	// Vérifie sur disque
	for _, sub := range []string{"antigravity", "antigravity-ide"} {
		annoPath := filepath.Join(home, ".gemini", sub, "annotations", testID+".pbtxt")
		if data, err := os.ReadFile(annoPath); err == nil {
			if !strings.Contains(string(data), "Nouveau Titre Renommé") {
				t.Errorf("%s: attendu 'Nouveau Titre Renommé' dans le pbtxt, reçu: %s", sub, string(data))
			}
		}
	}
}
