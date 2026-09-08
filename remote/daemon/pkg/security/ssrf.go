package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
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

// parseAlternativeIPv4 parses integer (decimal, hex, octal) or shorthand IPv4 formats (e.g. 2130706433, 0x7f000001, 127.1, 0177.0.0.1).
func parseAlternativeIPv4(host string) net.IP {
	parts := strings.Split(host, ".")
	if len(parts) == 1 {
		// Single integer: decimal (2130706433), hex (0x7f000001), or octal (017700000001)
		val, err := strconv.ParseUint(parts[0], 0, 32)
		if err == nil {
			return net.IPv4(byte(val>>24), byte(val>>16), byte(val>>8), byte(val))
		}
		return nil
	}

	if len(parts) > 4 {
		return nil
	}

	var vals [4]uint32
	for i, p := range parts {
		v, err := strconv.ParseUint(p, 0, 32)
		if err != nil {
			return nil
		}
		vals[i] = uint32(v)
	}

	var ipInt uint32
	switch len(parts) {
	case 2: // a.b (e.g. 127.1 -> 127.0.0.1)
		if vals[0] > 0xFF || vals[1] > 0xFFFFFF {
			return nil
		}
		ipInt = (vals[0] << 24) | vals[1]
	case 3: // a.b.c (e.g. 127.0.1 -> 127.0.0.1)
		if vals[0] > 0xFF || vals[1] > 0xFF || vals[2] > 0xFFFF {
			return nil
		}
		ipInt = (vals[0] << 24) | (vals[1] << 16) | vals[2]
	case 4: // a.b.c.d (with possible hex/octal e.g. 0177.0.0.1)
		if vals[0] > 0xFF || vals[1] > 0xFF || vals[2] > 0xFF || vals[3] > 0xFF {
			return nil
		}
		ipInt = (vals[0] << 24) | (vals[1] << 16) | (vals[2] << 8) | vals[3]
	default:
		return nil
	}

	return net.IPv4(byte(ipInt>>24), byte(ipInt>>16), byte(ipInt>>8), byte(ipInt))
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

	cleanHost := strings.TrimSuffix(hostname, ".")
	if cleanHost == "localhost" || strings.HasSuffix(cleanHost, ".localhost") || strings.HasSuffix(cleanHost, ".local") || strings.HasSuffix(cleanHost, ".internal") || strings.HasSuffix(cleanHost, "metadata.google.internal") || strings.HasSuffix(cleanHost, "metadata.aws") || cleanHost == "instance-data" {
		return fmt.Errorf("%w: %s", ErrSSRFBlocked, hostname)
	}

	// If host is standard IP literal
	if ip := net.ParseIP(cleanHost); ip != nil {
		if IsPrivateOrReservedIP(ip) {
			return fmt.Errorf("%w: %s", ErrSSRFBlocked, ip.String())
		}
	}

	// Check alternative IPv4 formats (decimal integer, hex, octal, shorthand)
	if ip := parseAlternativeIPv4(cleanHost); ip != nil {
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
