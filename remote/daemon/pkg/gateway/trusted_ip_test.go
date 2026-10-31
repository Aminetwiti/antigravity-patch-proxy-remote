package gateway

import (
	"net/http"
	"testing"
)

func TestResolveClientIP(t *testing.T) {
	trusted := ParseCIDRs([]string{"127.0.0.1/32", "10.0.0.0/8"})

	req1, _ := http.NewRequest("GET", "/", nil)
	req1.RemoteAddr = "203.0.113.1:54321"
	req1.Header.Set("X-Forwarded-For", "198.51.100.2")
	if ip := ResolveClientIP(req1, trusted); ip != "203.0.113.1" {
		t.Fatalf("expected remoteAddr 203.0.113.1, got %s", ip)
	}

	req2, _ := http.NewRequest("GET", "/", nil)
	req2.RemoteAddr = "127.0.0.1:54321"
	req2.Header.Set("X-Forwarded-For", "198.51.100.2, 127.0.0.1")
	if ip := ResolveClientIP(req2, trusted); ip != "198.51.100.2" {
		t.Fatalf("expected forwarded client IP 198.51.100.2, got %s", ip)
	}
}
