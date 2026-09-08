package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebSearchTool_MockResponse(t *testing.T) {
	mockHTML := `<!DOCTYPE html>
<html>
<body>
  <div class="result__body">
    <a class="result__a" href="/l/?kh=-1&uddg=https%3A%2F%2Fgolang.org%2Fpkg%2Fnet%2Fhttp%2F">Go HTTP Package</a>
    <a class="result__snippet" href="#">Package http provides HTTP client and server implementations.</a>
  </div>
  <div class="result__body">
    <a class="result__a" href="https://example.com/docs">Example Documentation</a>
    <a class="result__snippet" href="#">Comprehensive documentation for testing.</a>
  </div>
</body>
</html>`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(mockHTML))
	}))
	defer server.Close()

	tool := NewWebSearchTool()
	tool.searchBase = server.URL + "/?q="

	params, _ := json.Marshal(WebSearchParams{
		Query:      "golang http",
		MaxResults: 2,
	})

	var streamedChunks []string
	res, err := tool.Execute(context.Background(), "sess-1", "ws-1", params, func(chunk []byte) {
		streamedChunks = append(streamedChunks, string(chunk))
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected success, got error: %s", res.Error)
	}

	if !strings.Contains(res.Output, "Go HTTP Package") {
		t.Errorf("expected result to contain 'Go HTTP Package', got: %s", res.Output)
	}
	if !strings.Contains(res.Output, "https://golang.org/pkg/net/http/") {
		t.Errorf("expected result to unescape uddg redirect link, got: %s", res.Output)
	}
	if len(streamedChunks) == 0 {
		t.Errorf("expected chunks to be streamed to callback")
	}
}

func TestFetchWebPageTool_Sanitization(t *testing.T) {
	mockPage := `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <style>body { color: red; }</style>
  <script>console.log("secret tracker");</script>
</head>
<body>
  <h1>Welcome to Antigravity</h1>
  <p>This is a <b>clean</b> paragraph with an &amp; entity.</p>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
</body>
</html>`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(mockPage))
	}))
	defer server.Close()

	tool := NewFetchWebPageTool()

	params, _ := json.Marshal(FetchWebPageParams{
		URL:       server.URL,
		MaxLength: 500,
	})

	res, err := tool.Execute(context.Background(), "sess-1", "ws-1", params, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected success, got error: %s", res.Error)
	}

	// Assert tags and scripts are removed
	if strings.Contains(res.Output, "<script>") || strings.Contains(res.Output, "secret tracker") {
		t.Errorf("expected script content to be stripped, got: %s", res.Output)
	}
	if strings.Contains(res.Output, "<style>") || strings.Contains(res.Output, "color: red") {
		t.Errorf("expected style content to be stripped, got: %s", res.Output)
	}
	if !strings.Contains(res.Output, "Welcome to Antigravity") {
		t.Errorf("expected text 'Welcome to Antigravity', got: %s", res.Output)
	}
	if !strings.Contains(res.Output, "clean paragraph with an & entity") {
		t.Errorf("expected unescaped text 'clean paragraph with an & entity', got: %s", res.Output)
	}
}
