package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrSSRFBlocked = errors.New("access to private, local, or reserved IP address is blocked (SSRF protection)")
	ErrInvalidURL  = errors.New("invalid or unsafe URL scheme: only http and https are allowed")
)

var (
	// Carrier-Grade NAT (RFC 6598) 100.64.0.0/10
	_, cgnatNet, _ = net.ParseCIDR("100.64.0.0/10")
	// IPv6 Unique Local Address (fc00::/7)
	_, ulaNet, _ = net.ParseCIDR("fc00::/7")
	// IPv6 Link-Local (fe80::/10)
	_, linkLocalV6, _ = net.ParseCIDR("fe80::/10")
)

// IsPrivateOrReservedIP returns true if the IP is loopback, private, link-local,
// cloud metadata, carrier-grade NAT, multicast, or unspecified.
func IsPrivateOrReservedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}

	// Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
	if ipv4 := ip.To4(); ipv4 != nil {
		ip = ipv4
	}

	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	// Explicit check for cloud metadata service (169.254.169.254)
	if ip.Equal(net.ParseIP("169.254.169.254")) {
		return true
	}

	// Check CGNAT (100.64.0.0/10)
	if cgnatNet != nil && cgnatNet.Contains(ip) {
		return true
	}

	// Check IPv6 ranges
	if ulaNet != nil && ulaNet.Contains(ip) {
		return true
	}
	if linkLocalV6 != nil && linkLocalV6.Contains(ip) {
		return true
	}

	return false
}

// ValidateURL performs initial syntax, scheme, and localhost checks on a target URL string.
func ValidateURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidURL, err)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("%w: scheme %q not supported", ErrInvalidURL, scheme)
	}

	hostname := strings.ToLower(u.Hostname())
	if hostname == "" {
		return fmt.Errorf("%w: host cannot be empty", ErrInvalidURL)
	}

	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") || strings.HasSuffix(hostname, ".local") || strings.HasSuffix(hostname, ".internal") {
		return fmt.Errorf("%w: %s", ErrSSRFBlocked, hostname)
	}

	// If host is an IP literal, validate immediately
	if ip := net.ParseIP(hostname); ip != nil {
		if IsPrivateOrReservedIP(ip) {
			return fmt.Errorf("%w: %s", ErrSSRFBlocked, ip.String())
		}
	}

	return nil
}

// SafeDialer creates a DialContext function that validates all resolved IPs against SSRF restrictions
// and dials directly to the validated IP to defeat DNS rebinding attacks.
func SafeDialer(dialTimeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("invalid address %q: %w", addr, err)
		}

		// Perform DNS lookup
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("dns resolution failed for %s: %w", host, err)
		}

		if len(ips) == 0 {
			return nil, fmt.Errorf("no ip addresses resolved for host %s", host)
		}

		// Verify that NONE of the resolved IPs are private or internal.
		// If ANY resolved IP is private/reserved, reject to avoid split-horizon DNS exploits.
		var safeIP net.IP
		for _, ip := range ips {
			if IsPrivateOrReservedIP(ip) {
				return nil, fmt.Errorf("%w: host %s resolved to blocked IP %s", ErrSSRFBlocked, host, ip.String())
			}
			if safeIP == nil {
				safeIP = ip
			}
		}

		dialer := &net.Dialer{
			Timeout:   dialTimeout,
			KeepAlive: 30 * time.Second,
		}

		// Pin to the validated IP address
		targetAddr := net.JoinHostPort(safeIP.String(), port)
		return dialer.DialContext(ctx, network, targetAddr)
	}
}

// NewSSRFProtectedTransport returns an http.Transport configured with SafeDialer.
func NewSSRFProtectedTransport(timeout time.Duration) *http.Transport {
	return &http.Transport{
		DialContext:           SafeDialer(timeout),
		TLSHandshakeTimeout:   10 * time.Second,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: timeout,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

// NewSSRFProtectedClient returns an http.Client safe against SSRF and DNS rebinding attacks.
func NewSSRFProtectedClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewSSRFProtectedTransport(timeout),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			// Validate redirect destination
			if err := ValidateURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}
