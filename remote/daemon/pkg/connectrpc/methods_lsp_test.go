package connectrpc

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestDiagnosticsJSONMethods vérifie que les 3 méthodes LSP envoient des
// requêtes ConnectRPC JSON correctes (méthode + corps) vers le Language Server.
func TestDiagnosticsJSONMethods(t *testing.T) {
	var gotMethod, gotBody string
	var gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := bytes.Split([]byte(r.URL.Path), []byte("/"))
		gotMethod = string(parts[len(parts)-1])
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotContentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := testClient(srv.URL, "tok")

	if _, err := c.GetLintErrors("file:///tmp/test.go"); err != nil {
		t.Fatalf("GetLintErrors: %v", err)
	}
	if gotMethod != "GetLintErrors" {
		t.Errorf("attendu GetLintErrors, got %s", gotMethod)
	}
	if !bytes.Contains([]byte(gotBody), []byte("file:///tmp/test.go")) {
		t.Errorf("corps sans uri: %s", gotBody)
	}

	if _, err := c.GetDefinition("file:///tmp/test.go", 10, 5); err != nil {
		t.Fatalf("GetDefinition: %v", err)
	}
	if gotMethod != "GetDefinition" {
		t.Errorf("attendu GetDefinition, got %s", gotMethod)
	}
	if !bytes.Contains([]byte(gotBody), []byte(`"line":10`)) || !bytes.Contains([]byte(gotBody), []byte(`"character":5`)) {
		t.Errorf("corps sans position: %s", gotBody)
	}

	if _, err := c.GetCodeValidationStates("file:///tmp/test.go"); err != nil {
		t.Fatalf("GetCodeValidationStates: %v", err)
	}
	if gotMethod != "GetCodeValidationStates" {
		t.Errorf("attendu GetCodeValidationStates, got %s", gotMethod)
	}
	if gotContentType != "application/json" {
		t.Errorf("attendu Content-Type application/json, got %s", gotContentType)
	}
}
