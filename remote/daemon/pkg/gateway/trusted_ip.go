package gateway

import (
	"net"
	"net/http"
	"strings"
)

func ParseCIDRs(raw []string) []*net.IPNet {
	var nets []*net.IPNet
	for _, r := range raw {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		_, ipnet, err := net.ParseCIDR(r)
		if err == nil && ipnet != nil {
			nets = append(nets, ipnet)
		}
	}
	return nets
}

func ResolveClientIP(r *http.Request, trusted []*net.IPNet) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remoteIP := net.ParseIP(host)

	if len(trusted) > 0 && remoteIP != nil {
		isTrusted := false
		for _, n := range trusted {
			if n.Contains(remoteIP) {
				isTrusted = true
				break
			}
		}
		if isTrusted {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				parts := strings.Split(xff, ",")
				if len(parts) > 0 {
					client := strings.TrimSpace(parts[0])
					if net.ParseIP(client) != nil {
						return client
					}
				}
			}
			if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
				if net.ParseIP(xri) != nil {
					return xri
				}
			}
		}
	}

	return host
}
