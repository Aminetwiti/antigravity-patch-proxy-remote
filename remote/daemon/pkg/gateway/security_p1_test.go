package gateway

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// volumeRoot retourne la racine du volume contenant p ("C:\\" sous Windows,
// "/" sous Unix) : une racine absolue étrangère que le client ne doit jamais
// pouvoir installer comme racine de confinement.
func volumeRoot(p string) string {
	if v := filepath.VolumeName(p); v != "" {
		return v + string(filepath.Separator)
	}
	return string(filepath.Separator)
}

// SEC-01 (régression) : une racine workspace absolue étrangère (racine du
// volume) doit être rejetée par validatedWorkspaceRoot.
func TestValidatedWorkspaceRoot_RejectsForeignRoot(t *testing.T) {
	tmp := t.TempDir()
	foreign := volumeRoot(tmp)
	if _, err := validatedWorkspaceRoot(foreign); err == nil {
		t.Fatalf("la racine du volume (%s) doit être rejetée comme racine workspace", foreign)
	}
	if _, err := validatedWorkspaceRoot(""); err != nil {
		t.Fatalf("racine vide → chaîne vide sans erreur, got %v", err)
	}
	// En mode test, le répertoire temporaire est une racine autorisée.
	resolved, err := validatedWorkspaceRoot(tmp)
	if err != nil || resolved == "" {
		t.Fatalf("racine temp légitime rejetée: %v (resolved=%q)", err, resolved)
	}
}

// SEC-01 (régression, handler) : write_file avec workspacePath = racine du
// volume ne doit PAS écrire hors des locations autorisées. Avant le fix, le
// client choisissait sa propre prison et pouvait écrire n'importe où.
func TestWriteFile_RejectsForeignWorkspaceRoot(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	victimDir := t.TempDir()
	victimFile := filepath.Join(victimDir, "evil.bat")

	client.sendRaw(t, `{
		"type": "write_file",
		"requestId": "sec01-w",
		"workspacePath": `+quoteJSON(volumeRoot(victimFile))+`,
		"filePath": `+quoteJSON(victimFile)+`,
		"content": "`+base64.StdEncoding.EncodeToString([]byte("pwned"))+`"
	}`)

	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("write_file avec racine étrangère doit être refusé: %v", resp)
	}
	if _, err := os.Stat(victimFile); err == nil {
		t.Fatal("AUCUN fichier ne doit être créé hors workspace autorisé")
	}
}

// SEC-01 (régression, handler) : read_file avec workspacePath = racine du
// volume ne doit pas exfiltrer un fichier arbitraire.
func TestReadFile_RejectsForeignWorkspaceRoot(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	victimDir := t.TempDir()
	victimFile := filepath.Join(victimDir, "secret.txt")
	if err := os.WriteFile(victimFile, []byte("TOP-SECRET"), 0o644); err != nil {
		t.Fatal(err)
	}

	client.sendRaw(t, `{
		"type": "read_file",
		"requestId": "sec01-r",
		"workspacePath": `+quoteJSON(volumeRoot(victimFile))+`,
		"filePath": `+quoteJSON(victimFile)+`
	}`)

	// Le handler read_file tente plusieurs chemins ; on scanne les réponses
	// jusqu'à la réponse request-scoped (type=response, requestId matché).
	for i := 0; i < 10; i++ {
		msg, err := client.recvSafe()
		if err != nil {
			break
		}
		if msg["type"] == "response" && msg["requestId"] == "sec01-r" {
			content, _ := msg["data"].(map[string]interface{})
			blob := ""
			if content != nil {
				if c, ok := content["content"].(string); ok {
					blob = c
				}
			}
			if strings.Contains(blob, "TOP-SECRET") {
				t.Fatal("le contenu du fichier victime ne doit jamais être retourné")
			}
			if msg["error"] == nil {
				t.Fatalf("read_file avec racine étrangère doit renvoyer une erreur: %v", msg)
			}
			return
		}
	}
	t.Fatal("aucune réponse request-scoped reçue pour read_file")
}

// SEC-02 (régression) : deleteSessionFromDisk rejette les cascadeID malformés
// et ne supprime rien hors ~/.gemini.
func TestDeleteSessionFromDisk_RejectsTraversal(t *testing.T) {
	home := t.TempDir()
	victim := filepath.Join(home, "victim")
	if err := os.MkdirAll(victim, 0o755); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(victim, "keep.txt")
	if err := os.WriteFile(keep, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	traversal := strings.Repeat(".."+string(filepath.Separator), 3) + "victim"
	if err := deleteSessionFromDisk(home, traversal); err == nil {
		t.Fatal("cascadeID avec traversal doit être rejeté")
	}
	if err := deleteSessionFromDisk(home, ".."); err == nil {
		t.Fatal("cascadeID '..' doit être rejeté")
	}
	if err := deleteSessionFromDisk(home, ""); err != nil {
		t.Fatalf("cascadeID vide → no-op silencieux attendu, got %v", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("la victime ne doit PAS être supprimée")
	}
}

// SEC-02 (régression) : les mutations d'annotation rejettent les ID malformés.
func TestAnnotationMutations_RejectMalformedCascadeID(t *testing.T) {
	home := t.TempDir()
	bad := []string{"..", "../evil", "a/b", `a\b`, "id:with:colons", strings.Repeat("x", 65), ""}
	for _, id := range bad {
		if err := renameSessionOnDisk(home, id, "titre"); err == nil {
			t.Fatalf("renameSessionOnDisk(%q) doit échouer", id)
		}
		if err := pinSessionOnDisk(home, id, true); err == nil {
			t.Fatalf("pinSessionOnDisk(%q) doit échouer", id)
		}
		if err := archiveSessionOnDisk(home, id, true); err == nil {
			t.Fatalf("archiveSessionOnDisk(%q) doit échouer", id)
		}
	}
	if findBrainDir("..") != "" {
		t.Fatal("findBrainDir('..') doit retourner chaîne vide")
	}
}

// SEC-02 (régression, handler) : delete_cascade avec cascadeID traversal est
// refusé avant toute opération disque/RPC.
func TestDeleteCascade_RejectsTraversalCascadeID(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{
		"type": "delete_cascade",
		"requestId": "sec02-d",
		"cascadeId": "../../../../Users/victim/Documents",
		"confirm": true
	}`)

	resp := client.recv(t)
	errStr, _ := resp["error"].(string)
	if resp["error"] == nil || !strings.Contains(errStr, "invalide") {
		t.Fatalf("delete_cascade avec cascadeID malformé doit être refusé: %v", resp)
	}
}

// quoteJSON sérialise s en littéral JSON.
func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
