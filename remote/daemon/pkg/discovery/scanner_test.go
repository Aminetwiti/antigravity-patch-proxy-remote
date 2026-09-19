package discovery

import (
	"testing"
)

func TestExtractArg(t *testing.T) {
	cmdLine := `language_server.exe --subclient_type hub --csrf_token abc123xyz --extension_server_port 50999`

	if token := extractArg(cmdLine, "csrf_token"); token != "abc123xyz" {
		t.Errorf("Attendu token=abc123xyz, reçu=%s", token)
	}

	if subType := extractArg(cmdLine, "subclient_type"); subType != "hub" {
		t.Errorf("Attendu subclient_type=hub, reçu=%s", subType)
	}

	if portStr := extractArg(cmdLine, "extension_server_port"); portStr != "50999" {
		t.Errorf("Attendu port=50999, reçu=%s", portStr)
	}
}

func TestExtractJson(t *testing.T) {
	jsonStr := `{"ProcessId": 12345, "Name": "language_server.exe"}`

	if pid := extractJsonInt(jsonStr, "ProcessId"); pid != 12345 {
		t.Errorf("Attendu ProcessId=12345, reçu=%d", pid)
	}

	if name := extractJsonString(jsonStr, "Name"); name != "language_server.exe" {
		t.Errorf("Attendu Name=language_server.exe, reçu=%s", name)
	}
}

func TestExtractArgHTTPS(t *testing.T) {
	cmdLine := `language_server.exe --https_server_port 53373 --csrf_token abc123xyz`
	if portStr := extractArg(cmdLine, "https_server_port"); portStr != "53373" {
		t.Errorf("Attendu https_server_port=53373, reçu=%s", portStr)
	}
}

func TestDedupeInts(t *testing.T) {
	input := []int{5000, 5000, 5001, 0, 70000, 5002, 5001}
	expected := []int{5000, 5001, 5002}
	res := dedupeInts(input)
	if len(res) != len(expected) {
		t.Fatalf("Attendu %v, reçu %v", expected, res)
	}
	for i := range expected {
		if res[i] != expected[i] {
			t.Errorf("Index %d: attendu %d, reçu %d", i, expected[i], res[i])
		}
	}
}

func TestDiscoverLive(t *testing.T) {
	procs, err := getProcesses()
	t.Logf("getProcesses count: %d, err: %v", len(procs), err)
	for i, p := range procs {
		t.Logf("Proc[%d]: PID=%d, Name=%s, Cmd=%s", i, p.pid, p.name, p.commandLine)
		info := &LocalHarnessInfo{
			PID:             p.pid,
			ProcessName:     p.name,
			CSRFToken:       extractArg(p.commandLine, "csrf_token"),
			ExtensionCSRF:   extractArg(p.commandLine, "extension_server_csrf_token"),
			ExtensionPort:   atoi(extractArg(p.commandLine, "extension_server_port")),
			HTTPSServerPort: atoi(extractArg(p.commandLine, "https_server_port")),
		}
		if info.ExtensionCSRF == "" {
			info.ExtensionCSRF = info.CSRFToken
		}
		candidates := candidatePorts(info, &p)
		t.Logf("  Candidates for PID %d: %v (ExtensionPort=%d, HTTPSServerPort=%d)", p.pid, candidates, info.ExtensionPort, info.HTTPSServerPort)
		for _, port := range candidates {
			isTLS := isPortTLS(port)
			var httpHb, httpsHb, httpsUs bool
			if isTLS {
				httpsHb = probeHTTPSHeartbeat(port, info.ExtensionCSRF)
				httpsUs = probeHTTPSGetUserStatus(port, info.ExtensionCSRF)
			} else {
				httpHb = probeHTTPHeartbeat(port, info.ExtensionCSRF)
			}
			t.Logf("    Port %d (TLS=%v): HTTP_HB=%v, HTTPS_HB=%v, HTTPS_US=%v", port, isTLS, httpHb, httpsHb, httpsUs)
		}
	}

	info, err := Discover()
	if err != nil {
		t.Logf("Discover error: %v", err)
	} else {
		t.Logf("Discover SUCCESS: %+v", info)
	}
}
