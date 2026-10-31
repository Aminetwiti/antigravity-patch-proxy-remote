package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWebHandler_ServesIndex(t *testing.T) {
	handler := Handler()

	req, err := http.NewRequest("GET", "/", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	body := rr.Body.String()
	if len(body) == 0 {
		t.Error("body is empty")
	}
}

func TestWebHandler_ServesCSSAndJS(t *testing.T) {
	handler := Handler()

	for _, path := range []string{"/style.css", "/app.js"} {
		req, _ := http.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("path %s status = %d, want %d", path, rr.Code, http.StatusOK)
		}
	}
}
