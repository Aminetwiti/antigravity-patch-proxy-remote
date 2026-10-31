package server

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// SlidingWindowLimiter implements an in-memory sliding window rate limiter.
type SlidingWindowLimiter struct {
	mu             sync.Mutex
	limit          int
	window         time.Duration
	entries        map[string][]time.Time
	trustedProxies []*net.IPNet
}

func NewSlidingWindowLimiter(limit int, window time.Duration) *SlidingWindowLimiter {
	l := &SlidingWindowLimiter{
		limit:   limit,
		window:  window,
		entries: make(map[string][]time.Time),
	}
	if env := os.Getenv("AG_TRUSTED_PROXIES"); env != "" {
		for _, part := range strings.Split(env, ",") {
			l.AddTrustedProxy(strings.TrimSpace(part))
		}
	}
	go l.cleanupLoop()
	return l
}

func (l *SlidingWindowLimiter) SetTrustedProxies(cidrs []string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.trustedProxies = nil
	for _, cidr := range cidrs {
		c := strings.TrimSpace(cidr)
		if c == "" {
			continue
		}
		if !strings.Contains(c, "/") {
			if strings.Contains(c, ":") {
				c += "/128"
			} else {
				c += "/32"
			}
		}
		_, ipNet, err := net.ParseCIDR(c)
		if err == nil {
			l.trustedProxies = append(l.trustedProxies, ipNet)
		}
	}
}

func (l *SlidingWindowLimiter) AddTrustedProxy(cidr string) {
	c := strings.TrimSpace(cidr)
	if c == "" {
		return
	}
	if !strings.Contains(c, "/") {
		if strings.Contains(c, ":") {
			c += "/128"
		} else {
			c += "/32"
		}
	}
	_, ipNet, err := net.ParseCIDR(c)
	if err == nil {
		l.mu.Lock()
		defer l.mu.Unlock()
		l.trustedProxies = append(l.trustedProxies, ipNet)
	}
}

func (l *SlidingWindowLimiter) isTrustedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, network := range l.trustedProxies {
		if network.Contains(ip) {
			return true
		}
	}
	return false
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
		// Key by client IP (with trusted-proxy verification) or Bearer token
		key := l.extractClientKey(r)
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

func (l *SlidingWindowLimiter) extractClientKey(r *http.Request) string {
	// If bearer token present, key by token
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		if token != "" && token != "none" {
			return "tok:" + token
		}
	}

	peerHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peerHost = r.RemoteAddr
	}
	peerIP := net.ParseIP(peerHost)

	// ONLY inspect X-Forwarded-For if peer is in trusted proxies (HIGH-02 Remediation)
	l.mu.Lock()
	trusted := l.isTrustedProxy(peerIP)
	l.mu.Unlock()

	if trusted {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			clientIP := strings.TrimSpace(parts[0])
			if net.ParseIP(clientIP) != nil {
				return "ip:" + clientIP
			}
		}
	}

	return "ip:" + peerHost
}
