package discovery

import (
	"net"
	"strings"
)

// IsVirtualIP vérifie si une adresse IP appartient à un sous-réseau virtuel
// connu (VirtualBox, VMware, Docker, WSL2 Hyper-V, APIPA / Link-Local).
func IsVirtualIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	ip4 := ip.To4()
	if ip4 == nil {
		// Ignorer IPv6 pour l'appairage LAN standard
		return true
	}

	if ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || ip4.IsUnspecified() {
		return true
	}

	ipStr := ip4.String()

	// VirtualBox Host-Only
	if strings.HasPrefix(ipStr, "192.168.56.") {
		return true
	}

	// VMware Workstation / Player
	if strings.HasPrefix(ipStr, "192.168.152.") || strings.HasPrefix(ipStr, "192.168.233.") {
		return true
	}

	// APIPA (Automatic Private IP Addressing)
	if strings.HasPrefix(ipStr, "169.254.") {
		return true
	}

	// Docker Default Bridge / WSL2 Virtual Switch (172.16.0.0/12: 172.16.x.x -> 172.31.x.x)
	if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
		return true
	}

	return false
}

// GetPhysicalLANIP résout l'adresse IPv4 physique active de la machine hôte.
// Elle teste en priorité la route de sortie UDP, puis vérifie les interfaces
// réseau physiques pour éliminer tout adaptateur virtuel.
func GetPhysicalLANIP() string {
	// 1. Tenter une résolution de route via socket UDP (sans envoi effectif)
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		localAddr := conn.LocalAddr().(*net.UDPAddr)
		_ = conn.Close()
		if !IsVirtualIP(localAddr.IP) {
			return localAddr.IP.String()
		}
	}

	// 2. Parcourir les interfaces réseau physiques
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	for _, iface := range ifaces {
		// Ignorer interfaces éteintes, loopback ou virtuelles par nom
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		nameLower := strings.ToLower(iface.Name)
		if strings.Contains(nameLower, "virtual") ||
			strings.Contains(nameLower, "vbox") ||
			strings.Contains(nameLower, "vmware") ||
			strings.Contains(nameLower, "docker") ||
			strings.Contains(nameLower, "vethernet") ||
			strings.Contains(nameLower, "wsl") {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip != nil && ip.To4() != nil && !IsVirtualIP(ip) {
				return ip.To4().String()
			}
		}
	}

	return ""
}
