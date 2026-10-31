package gateway

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConvertTranscriptToJSONL(t *testing.T) {
	raw := []byte(`{"step_index":0,"type":"USER_INPUT","content":"hello"}
{"step_index":1,"type":"MODEL","content":"hi there"}
{"step_index":2,"type":"USER_INPUT","content":"how are you"}
{"step_index":3,"type":"MODEL","content":"fine thanks"}
`)
	out, err := convertTranscriptToJSONL(raw)
	if err != nil {
		t.Fatalf("convertTranscriptToJSONL: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 5 {
		t.Fatalf("attendu 5 lignes (4 steps + done), got %d: %q", len(lines), out)
	}
	if !strings.Contains(lines[0], `"index":0`) || !strings.Contains(lines[0], `"step"`) {
		t.Fatalf("ligne 0 mal formée: %s", lines[0])
	}
	if !strings.Contains(lines[3], `"index":3`) {
		t.Fatalf("ligne 3 mal formée: %s", lines[3])
	}
	if !strings.Contains(lines[4], `"type":"done"`) {
		t.Fatalf("dernière ligne doit être le marqueur done: %s", lines[4])
	}
}

func TestExportSessionJSONLWritesFile(t *testing.T) {
	dir := t.TempDir()
	oldExport := jsonlExportDir
	jsonlExportDir = filepath.Join(dir, "exports")
	defer func() { jsonlExportDir = oldExport }()

	// Simule un transcript source trouvable par findTranscriptPath : le chemin
	// est basé sur le home utilisateur réel, donc on fabrique le fichier là où
	// findTranscriptPath va le chercher (cascade factice improbable).
	home, _ := os.UserHomeDir()
	srcDir := filepath.Join(home, ".gemini", "antigravity", "brain", "cascade-jsonl-test", ".system_generated", "logs")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir source: %v", err)
	}
	src := filepath.Join(srcDir, "transcript.jsonl")
	if err := os.WriteFile(src, []byte(`{"step_index":0,"type":"USER_INPUT","content":"hi"}`+"\n"), 0644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", "cascade-jsonl-test"))

	path, err := ExportSessionJSONL("cascade-jsonl-test")
	if err != nil {
		t.Fatalf("ExportSessionJSONL: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("fichier exporté introuvable: %v", err)
	}
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `"type":"done"`) {
		t.Fatalf("export sans marqueur done: %s", string(data))
	}
}
