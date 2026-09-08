package security

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

func TestIsPrivateOrReservedIP(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		{"127.0.0.1", true},
		{"127.0.0.2", true},
		{"::1", true},
		{"::ffff:127.0.0.1", true},
		{"10.0.0.1", true},
		{"10.255.255.255", true},
		{"172.16.0.1", true},
		{"172.31.255.255", true},
		{"192.168.1.1", true},
		{"192.168.0.254", true},
		{"169.254.169.254", true}, // AWS / GCP metadata
		{"169.254.1.1", true},       // Link local
		{"100.64.0.1", true},        // Carrier grade NAT
		{"0.0.0.0", true},           // Unspecified
		{"::", true},
		{"224.0.0.1", true},         // Multicast
		{"8.8.8.8", false},          // Public Google DNS
		{"1.1.1.1", false},          // Public Cloudflare DNS
		{"93.184.216.34", false},    // example.com
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.ip)
		if ip == nil {
			t.Fatalf("failed to parse IP: %s", tt.ip)
		}
		got := IsPrivateOrReservedIP(ip)
		if got != tt.expected {
			t.Errorf("IsPrivateOrReservedIP(%s) = %v; want %v", tt.ip, got, tt.expected)
		}
	}
}

func TestValidateURL(t *testing.T) {
	blockedURLs := []string{
		"http://localhost/admin",
		"http://localhost./admin",
		"http://127.0.0.1:8080/api",
		"http://127.1:8080/api",
		"http://2130706433/admin",
		"http://0x7f000001/admin",
		"http://0177.0.0.1/admin",
		"http://[::ffff:127.0.0.1]/admin",
		"http://169.254.169.254/latest/meta-data/",
		"http://metadata.google.internal/computeMetadata/v1/",
		"http://metadata.aws/latest/meta-data/",
		"http://instance-data/latest/meta-data/",
		"http://10.0.0.5/",
		"http://192.168.1.100:3000",
		"http://app.localhost",
		"ftp://example.com/file",
		"file:///etc/passwd",
		"gopher://example.com",
		"ws://example.com/socket",
		"wss://example.com/socket",
	}

	for _, u := range blockedURLs {
		if err := ValidateURL(u); err == nil {
			t.Errorf("ValidateURL(%q) expected error, got nil", u)
		}
	}

	allowedURLs := []string{
		"https://example.com",
		"http://example.com/path?query=1",
		"https://api.github.com/repos",
	}

	for _, u := range allowedURLs {
		if err := ValidateURL(u); err != nil {
			t.Errorf("ValidateURL(%q) unexpected error: %v", u, err)
		}
	}
}

func TestSafeDialer_BlocksLoopback(t *testing.T) {
	dialer := SafeDialer(2 * time.Second)
	_, err := dialer(context.Background(), "tcp", "127.0.0.1:80")
	if err == nil {
		t.Fatalf("expected dialer to block loopback address, got nil")
	}
	if !strings.Contains(err.Error(), "blocked") {
		t.Errorf("expected error to mention 'blocked', got: %v", err)
	}
}
