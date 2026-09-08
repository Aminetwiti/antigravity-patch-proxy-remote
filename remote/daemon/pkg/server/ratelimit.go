package server

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SlidingWindowLimiter implements an in-memory sliding window rate limiter.
type SlidingWindowLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	entries map[string][]time.Time
}

func NewSlidingWindowLimiter(limit int, window time.Duration) *SlidingWindowLimiter {
	l := &SlidingWindowLimiter{
		limit:   limit,
		window:  window,
		entries: make(map[string][]time.Time),
	}
	go l.cleanupLoop()
	return l
}

func (l *SlidingWindowLimiter) Allow(key string) (bool, int, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	// Filter timestamps within window
	timestamps := l.entries[key]
	valid := make([]time.Time, 0, len(timestamps))
	for _, t := range timestamps {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) < l.limit {
		valid = append(valid, now)
		l.entries[key] = valid
		remaining := l.limit - len(valid)
		return true, remaining, l.window
	}

	// Rate limit exceeded
	l.entries[key] = valid
	retryAfter := valid[0].Add(l.window).Sub(now)
	if retryAfter < 0 {
		retryAfter = time.Second
	}
	return false, 0, retryAfter
}

func (l *SlidingWindowLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		l.mu.Lock()
		cutoff := time.Now().Add(-l.window)
		for k, timestamps := range l.entries {
			var valid []time.Time
			for _, t := range timestamps {
				if t.After(cutoff) {
					valid = append(valid, t)
				}
			}
			if len(valid) == 0 {
				delete(l.entries, k)
			} else {
				l.entries[k] = valid
			}
		}
		l.mu.Unlock()
	}
}

// Middleware returns an HTTP middleware enforcing rate limits.
func (l *SlidingWindowLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Key by client IP or Bearer token
		key := extractClientKey(r)
		allowed, remaining, retryAfter := l.Allow(key)

		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", l.limit))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))

		if !allowed {
			retrySeconds := int(retryAfter.Seconds())
			if retrySeconds < 1 {
				retrySeconds = 1
			}
			w.Header().Set("Retry-After", fmt.Sprintf("%d", retrySeconds))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error":             "rate limit exceeded: too many requests",
				"retryAfterSeconds": retrySeconds,
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func extractClientKey(r *http.Request) string {
	// If bearer token present, key by token
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		if token != "" && token != "none" {
			return "tok:" + token
		}
	}

	// Otherwise key by IP
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return "ip:" + strings.TrimSpace(parts[0])
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return "ip:" + host
	}
	return "ip:" + r.RemoteAddr
}
