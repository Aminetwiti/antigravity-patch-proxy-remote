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

func TestSlidingWindowLimiter_UntrustedXForwardedForIgnored(t *testing.T) {
	// Limit = 2 per client
	limiter := NewSlidingWindowLimiter(2, time.Minute)
	// Untrusted peer: 203.0.113.5 (NOT in trusted proxies)
	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Request 1 from 203.0.113.5 with spoofed XFF 1.1.1.1
	req1 := httptest.NewRequest("GET", "/test", nil)
	req1.RemoteAddr = "203.0.113.5:12345"
	req1.Header.Set("X-Forwarded-For", "1.1.1.1")
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("req1: expected 200, got %d", w1.Code)
	}

	// Request 2 from 203.0.113.5 with spoofed XFF 1.1.1.2
	req2 := httptest.NewRequest("GET", "/test", nil)
	req2.RemoteAddr = "203.0.113.5:12345"
	req2.Header.Set("X-Forwarded-For", "1.1.1.2")
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("req2: expected 200, got %d", w2.Code)
	}

	// Request 3 from 203.0.113.5 with spoofed XFF 1.1.1.3:
	// MUST BE BLOCKED (HTTP 429) because XFF was IGNORED and peer IP 203.0.113.5 exceeded limit!
	req3 := httptest.NewRequest("GET", "/test", nil)
	req3.RemoteAddr = "203.0.113.5:12345"
	req3.Header.Set("X-Forwarded-For", "1.1.1.3")
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	if w3.Code != http.StatusTooManyRequests {
		t.Fatalf("HIGH-02 VULNERABILITY: attacker bypassed rate limiter by spoofing X-Forwarded-For! got %d", w3.Code)
	}
}

func TestSlidingWindowLimiter_TrustedProxyXForwardedForAccepted(t *testing.T) {
	limiter := NewSlidingWindowLimiter(2, time.Minute)
	// Trust reverse proxy 10.0.0.1
	limiter.SetTrustedProxies([]string{"10.0.0.1/32"})

	handler := limiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Client A through trusted proxy
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "10.0.0.1:43210"
		req.Header.Set("X-Forwarded-For", "198.51.100.10")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("client A req %d: expected 200, got %d", i+1, w.Code)
		}
	}

	// Client B through same trusted proxy should still have full quota!
	reqB := httptest.NewRequest("GET", "/test", nil)
	reqB.RemoteAddr = "10.0.0.1:43210"
	reqB.Header.Set("X-Forwarded-For", "198.51.100.20")
	wB := httptest.NewRecorder()
	handler.ServeHTTP(wB, reqB)
	if wB.Code != http.StatusOK {
		t.Fatalf("client B through trusted proxy expected 200, got %d", wB.Code)
	}
}
