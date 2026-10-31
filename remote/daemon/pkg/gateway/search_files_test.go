package gateway

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// TestSearchInWorkspace vérifie le moteur de recherche : correspondances nom +
// contenu, exclusions des dossiers ignorés, plafond maxResults.
func TestSearchInWorkspace(t *testing.T) {
	root := t.TempDir()
	// Fichier avec un mot-clé dans le contenu.
	writeTestFile(t, filepath.Join(root, "main.go"), "package main\n\nfunc Greeting() string { return \"bonjour\" }\n")
	// Fichier dont le NOM correspond.
	writeTestFile(t, filepath.Join(root, "bonjour_helper.dart"), "void helper() {}\n")
	// Fichier ignoré (node_modules) — ne doit JAMAIS remonter.
	writeTestFile(t, filepath.Join(root, "node_modules", "pkg", "index.js"), "bonjour from node_modules\n")
	// Fichier .git ignoré.
	writeTestFile(t, filepath.Join(root, ".git", "config"), "bonjour from git\n")
	// Fichier binaire simulé (gros) — doit être ignoré.
	big := make([]byte, 3<<20)
	copy(big, "bonjour big")
	writeTestFile(t, filepath.Join(root, "big.bin"), string(big))

	res, err := searchInWorkspace(root, "bonjour", 50)
	if err != nil {
		t.Fatalf("searchInWorkspace err: %v", err)
	}
	var paths []string
	for _, r := range res {
		paths = append(paths, r["path"].(string))
	}
	joined := strings.Join(paths, ",")
	if !strings.Contains(joined, "main.go") {
		t.Errorf("main.go absent: %v", paths)
	}
	if !strings.Contains(joined, "bonjour_helper.dart") {
		t.Errorf("bonjour_helper.dart absent: %v", paths)
	}
	if strings.Contains(joined, "node_modules") || strings.Contains(joined, ".git") {
		t.Errorf("dossiers ignorés remontés: %v", paths)
	}
	if strings.Contains(joined, "big.bin") {
		t.Errorf("fichier > 2 Mo indexé: %v", paths)
	}

	// Plafond maxResults respecté.
	res, err = searchInWorkspace(root, "bonjour", 1)
	if err != nil {
		t.Fatalf("searchInWorkspace(limit) err: %v", err)
	}
	if len(res) > 1 {
		t.Errorf("maxResults=1 dépassé: %d", len(res))
	}
}

// TestSearchFilesWSFlow vérifie le message WebSocket search_files de bout en
// bout (dial → requête → réponse structurée {results}).
func TestSearchFilesWSFlow(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "app.go"), "package app\n\nfunc Hello() {}\n")

	backend := &fakeRPCClient{}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial err: %v", err)
	}
	defer conn.Close()

	req := map[string]interface{}{
		"type":          "search_files",
		"requestId":     "req_search_1",
		"query":         "Hello",
		"workspacePath": root,
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}

	var res OutgoingMessage
	if err := conn.ReadJSON(&res); err != nil {
		t.Fatalf("ReadJSON err: %v", err)
	}
	if res.Type != "response" || res.RequestID != "req_search_1" {
		t.Fatalf("Unexpected response: %+v", res)
	}
	data, ok := res.Data.(map[string]interface{})
	if !ok || data["results"] == nil {
		t.Fatalf("results manquants: %+v", res.Data)
	}
	results := data["results"].([]interface{})
	if len(results) == 0 {
		t.Fatal("aucun résultat de recherche")
	}
	first := results[0].(map[string]interface{})
	if first["path"] == nil || first["line"] == nil {
		t.Fatalf("résultat incomplet: %+v", first)
	}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
