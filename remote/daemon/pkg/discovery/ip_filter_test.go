package discovery

import (
	"net"
	"testing"
)

func TestIsVirtualIP(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		// VirtualBox
		{"192.168.56.1", true},
		{"192.168.56.101", true},
		// VMware
		{"192.168.152.1", true},
		{"192.168.233.2", true},
		// APIPA
		{"169.254.10.20", true},
		{"169.254.1.1", true},
		// Docker & WSL2 (172.16.0.0/12)
		{"172.17.0.1", true},
		{"172.18.0.1", true},
		{"172.20.10.1", true},
		{"172.28.0.1", true},
		{"172.31.255.254", true},
		// Loopback & invalid
		{"127.0.0.1", true},
		{"0.0.0.0", true},
		// Valid physical LAN IPs
		{"192.168.1.100", false},
		{"192.168.0.25", false},
		{"10.0.0.15", false},
		{"10.10.1.50", false},
		{"172.15.0.1", false},  // Out of 172.16-31 range
		{"172.32.0.1", false},  // Out of 172.16-31 range
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.ip)
		got := IsVirtualIP(ip)
		if got != tt.expected {
			t.Errorf("IsVirtualIP(%s) = %v, want %v", tt.ip, got, tt.expected)
		}
	}
}

func TestGetPhysicalLANIP(t *testing.T) {
	ipStr := GetPhysicalLANIP()
	if ipStr != "" {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			t.Fatalf("GetPhysicalLANIP returned invalid IP string: %s", ipStr)
		}
		if IsVirtualIP(ip) {
			t.Errorf("GetPhysicalLANIP returned virtual IP: %s", ipStr)
		}
	}
}
