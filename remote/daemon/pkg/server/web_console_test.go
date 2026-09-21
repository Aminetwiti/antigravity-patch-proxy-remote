package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebConsole_Endpoints(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", HandleWebConsole)
	mux.HandleFunc("/console", HandleWebConsole)

	ts := httptest.NewServer(mux)
	defer ts.Close()

	// 1. GET /
	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("failed to GET /: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}
	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/html") {
		t.Errorf("expected text/html, got %s", contentType)
	}
	if xfo := resp.Header.Get("X-Frame-Options"); xfo != "DENY" {
		t.Errorf("expected X-Frame-Options: DENY, got %q", xfo)
	}
	if xcto := resp.Header.Get("X-Content-Type-Options"); xcto != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", xcto)
	}
	if csp := resp.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("expected frame-ancestors 'none' in CSP, got %q", csp)
	}

	// 2. GET /console
	respConsole, err := http.Get(ts.URL + "/console")
	if err != nil {
		t.Fatalf("failed to GET /console: %v", err)
	}
	defer respConsole.Body.Close()

	if respConsole.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", respConsole.StatusCode)
	}

	// 3. GET /invalid -> 404
	respInvalid, err := http.Get(ts.URL + "/invalid-route")
	if err != nil {
		t.Fatalf("failed to GET /invalid-route: %v", err)
	}
	defer respInvalid.Body.Close()

	if respInvalid.StatusCode != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", respInvalid.StatusCode)
	}
}
