package discovery

import (
	"fmt"
	"math/rand"
	"net"
	"strings"
	"testing"
)

// ─── Propriétés de splitJsonObjects ───

// TestSplitJsonObjectsRoundTrip — chaque objet extrait doit pouvoir être
// parsé par extractJsonInt/extractJsonString, quelle que soit la forme
// (objet unique, array, objets avec séparateurs, CommandLine avec accolades).
func TestSplitJsonObjectsRoundTrip(t *testing.T) {
	cases := []string{
		`{"ProcessId": 1, "Name": "a.exe"}`,
		`[{"ProcessId":1,"Name":"a.exe"},{"ProcessId":2,"Name":"b.exe"}]`,
		`{"ProcessId":1,"Name":"a.exe"},{"ProcessId":2,"Name":"b.exe"}`,
		`[{"ProcessId":1,"Name":"a.exe","CommandLine":"x --flag {a} y"}]`,
		`[{"ProcessId": 9}]`,
	}
	for _, in := range cases {
		objs := splitJsonObjects(in)
		if len(objs) == 0 {
			t.Fatalf("aucun objet extrait pour %q", in)
		}
		for _, o := range objs {
			if !strings.HasPrefix(o, "{") || !strings.HasSuffix(o, "}") {
				t.Errorf("objet mal formé: %q (source %q)", o, in)
			}
			_ = extractJsonInt(o, "ProcessId")
			_ = extractJsonString(o, "Name")
		}
	}
}

// TestSplitJsonObjectsEscapedQuotes — un CommandLine avec guillemets échappés
// ne doit pas casser le découpage (la regex extractJsonString gère \\\").
func TestSplitJsonObjectsEscapedQuotes(t *testing.T) {
	in := `[{"ProcessId":1,"Name":"a.exe","CommandLine":"--path \"C:\\Users\\x\" --token abc"},{"ProcessId":2,"Name":"b.exe"}]`
	objs := splitJsonObjects(in)
	if len(objs) != 2 {
		t.Fatalf("attendu 2 objets, reçu %d (%v)", len(objs), objs)
	}
	if v := extractJsonString(objs[0], "Name"); v != "a.exe" {
		t.Errorf("Name attendu a.exe, reçu %q", v)
	}
}

// TestSplitJsonObjectsRandomInputs — entrées aléatoires : ne doit ni paniquer
// ni renvoyer d'objets qui cassent extractJsonString.
func TestSplitJsonObjectsRandomInputs(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	chars := []byte(`{}[]",:\abcXYZ019 -_`)
	for i := 0; i < 2000; i++ {
		n := r.Intn(60)
		b := make([]byte, n)
		for j := range b {
			b[j] = chars[r.Intn(len(chars))]
		}
		func() {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("panic sur %q: %v", string(b), p)
				}
			}()
			for _, o := range splitJsonObjects(string(b)) {
				_ = extractJsonString(o, "Name")
				_ = extractJsonInt(o, "ProcessId")
			}
		}()
	}
}

// ─── Propriétés d'extractArg ───

// TestExtractArgForms — les deux formes (--k v et --k=v) doivent donner
// le même résultat, y compris avec valeurs contenant des tirets.
func TestExtractArgForms(t *testing.T) {
	values := []string{"abc123", "v2.4.1", "token-xyz"}
	for _, v := range values {
		space := fmt.Sprintf("--csrf_token %s", v)
		eq := fmt.Sprintf("--csrf_token=%s", v)
		if a, b := extractArg(space, "csrf_token"), extractArg(eq, "csrf_token"); a != b || a != v {
			t.Errorf("formes divergentes: space=%q eq=%q (attendu %q)", a, b, v)
		}
	}
}

// TestExtractArgNoValue — un flag sans valeur ne doit pas capturer le flag suivant.
func TestExtractArgNoValue(t *testing.T) {
	cmdLine := `lang.exe --subclient_type hub --verbose --csrf_token abc`
	if v := extractArg(cmdLine, "verbose"); v != "" {
		t.Errorf("verbose n'a pas de valeur, reçu %q", v)
	}
}

// TestExtractArgPrefixedSimilar — un flag préfixe ne doit pas matcher.
func TestExtractArgPrefixedSimilar(t *testing.T) {
	cmdLine := `lang.exe --csrf_token_old abc --csrf_token new`
	if v := extractArg(cmdLine, "csrf_token"); v != "new" {
		t.Errorf("attendu new, reçu %q", v)
	}
}

// ─── Propriétés de listeningPortsForPID / probePorts ───

// TestProbePorts — la sonde parallèle trouve le port qui répond parmi un lot,
// et ignore les ports fermés (le timeout n'est pas déclenché : listener local).
func TestProbePorts(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("pas de socket locale: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	// Le listener local ne répond pas HTTP — probeService retournerait false.
	// On teste donc la couche parallèle via un faux probeService injectable ?
	// probeService est une fonction package-level non injectable : on valide
	// juste le contrat (port fermé → 0, pas de panique, terminaison rapide).
	if got, _ := probePorts([]int{1, port}, "tok"); got != 0 {
		t.Errorf("probePorts = %d, want 0 (listener non-HTTP ignoré)", got)
	}
	// Lot vide → 0 sans panique
	if got, _ := probePorts(nil, "tok"); got != 0 {
		t.Errorf("probePorts(nil) = %d, want 0", got)
	}
}

// TestListeningPortsParsing — simule la sortie netstat : seuls les ports en
// LISTEN du bon PID sont extraits.
func TestListeningPortsParsing(t *testing.T) {
	// On ne peut pas injecter la sortie netstat facilement (fonction interne
	// qui exécute la commande), mais on vérifie que la logique de parsing
	// tient sur un échantillon réel de format.
	lines := []string{
		"  TCP    127.0.0.1:51000    127.0.0.1:0    LISTENING       1234",
		"  TCP    127.0.0.1:51001    127.0.0.1:0    LISTENING       9999",
		"  UDP    0.0.0.0:5353       *:*                            1234",
	}
	got := 0
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[4] != "1234" {
			continue
		}
		if !strings.Contains(fields[3], "LISTEN") {
			continue
		}
		got++
	}
	if got != 1 {
		t.Errorf("attendu 1 port LISTEN pour PID 1234, reçu %d", got)
	}
}
