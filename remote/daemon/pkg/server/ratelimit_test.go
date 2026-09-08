package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSlidingWindowLimiter_Allow(t *testing.T) {
	limiter := NewSlidingWindowLimiter(3, 100*time.Millisecond)

	key := "client-1"

	// 1st request - allowed
	allowed, remaining, _ := limiter.Allow(key)
	if !allowed || remaining != 2 {
		t.Fatalf("expected allowed with 2 remaining, got allowed=%v remaining=%d", allowed, remaining)
	}

	// 2nd request - allowed
	allowed, remaining, _ = limiter.Allow(key)
	if !allowed || remaining != 1 {
		t.Fatalf("expected allowed with 1 remaining, got allowed=%v remaining=%d", allowed, remaining)
	}

	// 3rd request - allowed
	allowed, remaining, _ = limiter.Allow(key)
	if !allowed || remaining != 0 {
		t.Fatalf("expected allowed with 0 remaining, got allowed=%v remaining=%d", allowed, remaining)
	}

	// 4th request - rejected
	allowed, remaining, retryAfter := limiter.Allow(key)
	if allowed || remaining != 0 {
		t.Fatalf("expected blocked, got allowed=%v remaining=%d", allowed, remaining)
	}
	if retryAfter <= 0 {
		t.Errorf("expected positive retryAfter, got %v", retryAfter)
	}

	// Different key should still be allowed
	allowed, _, _ = limiter.Allow("client-2")
	if !allowed {
		t.Fatalf("expected client-2 to be allowed")
	}

	// Wait for window to expire
	time.Sleep(120 * time.Millisecond)

	// Should be allowed again
	allowed, remaining, _ = limiter.Allow(key)
	if !allowed || remaining != 2 {
		t.Fatalf("expected allowed after window expiration, got allowed=%v remaining=%d", allowed, remaining)
	}
}

func TestSlidingWindowLimiter_Middleware(t *testing.T) {
	limiter := NewSlidingWindowLimiter(2, 200*time.Millisecond)

	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	// 1st request
	req1 := httptest.NewRequest("GET", "/test", nil)
	req1.RemoteAddr = "192.168.1.50:1234"
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w1.Code)
	}
	if w1.Header().Get("X-RateLimit-Remaining") != "1" {
		t.Errorf("expected remaining 1, got %s", w1.Header().Get("X-RateLimit-Remaining"))
	}

	// 2nd request
	req2 := httptest.NewRequest("GET", "/test", nil)
	req2.RemoteAddr = "192.168.1.50:1234"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w2.Code)
	}

	// 3rd request - should be 429
	req3 := httptest.NewRequest("GET", "/test", nil)
	req3.RemoteAddr = "192.168.1.50:1234"
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	if w3.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", w3.Code)
	}
	if w3.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header to be set")
	}
}
