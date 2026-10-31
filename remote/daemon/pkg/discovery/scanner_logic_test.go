package discovery

import (
	"strings"
	"testing"
)

func TestSplitJsonObjects_SingleObject(t *testing.T) {
	objs := splitJsonObjects(`{"ProcessId": 1, "Name": "a.exe"}`)
	if len(objs) != 1 {
		t.Fatalf("Attendu 1 objet, reçu %d", len(objs))
	}
	if !strings.Contains(objs[0], "ProcessId") {
		t.Errorf("Objet inattendu: %s", objs[0])
	}
}

func TestSplitJsonObjects_Array(t *testing.T) {
	in := `[{"ProcessId":1,"Name":"a.exe"},{"ProcessId":2,"Name":"b.exe"},{"ProcessId":3,"Name":"c.exe"}]`
	objs := splitJsonObjects(in)
	if len(objs) != 3 {
		t.Fatalf("Attendu 3 objets, reçu %d", len(objs))
	}
	for i, o := range objs {
		if !strings.HasPrefix(o, "{") || !strings.HasSuffix(o, "}") {
			t.Errorf("Objet %d mal reconstruit: %q", i, o)
		}
	}
}

func TestSplitJsonObjects_Empty(t *testing.T) {
	if objs := splitJsonObjects(""); len(objs) != 0 {
		t.Fatalf("Attendu 0 objet pour entrée vide, reçu %d", len(objs))
	}
}

func TestCandidatePorts(t *testing.T) {
	info := &LocalHarnessInfo{ExtensionPort: 50999}
	ports := candidatePorts(info, nil)
	// Doit contenir au moins les 20 ports de extension_server_port + offset
	if len(ports) < 20 {
		t.Fatalf("Attendu au moins 20 ports candidats, reçu %d", len(ports))
	}
	has51000 := false
	has51019 := false
	for _, p := range ports {
		if p == 51000 {
			has51000 = true
		}
		if p == 51019 {
			has51019 = true
		}
	}
	if !has51000 {
		t.Errorf("Attendu candidat 51000 dans les ports, non trouvé: %v", ports)
	}
	if !has51019 {
		t.Errorf("Attendu candidat 51019 dans les ports, non trouvé: %v", ports)
	}
}

func TestCandidatePorts_NoExtensionPort(t *testing.T) {
	info := &LocalHarnessInfo{}
	// Sans ExtensionPort, candidatePorts délègue à listeningPortsForPID
	// (le procEntry n'est jamais nil en production : pick est toujours défini).
	ports := candidatePorts(info, &procEntry{pid: 0})
	_ = ports // pas de panique ; le contenu dépend du netstat de la machine
}

func TestExtractArg_EqualsForm(t *testing.T) {
	// Certains processus passent les arguments avec un '=' au lieu d'un espace.
	cmdLine := `language_server.exe --csrf_token=xyz789 --subclient_type=hub`
	if v := extractArg(cmdLine, "csrf_token"); v != "xyz789" {
		t.Errorf("Attendu xyz789, reçu %q", v)
	}
	if v := extractArg(cmdLine, "subclient_type"); v != "hub" {
		t.Errorf("Attendu hub, reçu %q", v)
	}
}

func TestExtractArg_Missing(t *testing.T) {
	if v := extractArg("language_server.exe --port 42", "csrf_token"); v != "" {
		t.Errorf("Attendu chaîne vide, reçu %q", v)
	}
}

func TestAtoi(t *testing.T) {
	if v := atoi("50999"); v != 50999 {
		t.Errorf("Attendu 50999, reçu %d", v)
	}
	if v := atoi("not-a-number"); v != 0 {
		t.Errorf("Attendu 0 pour entrée invalide, reçu %d", v)
	}
}
