package gateway

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// jsonlExportDir : dossier d'export des transcripts JSONL (variable pour tests).
var jsonlExportDir = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, ".gemini", "antigravity-remote", "exports")
}()

// ExportSessionJSONL convertit un transcript local en JSONL format Claude Code
// (interopérabilité : les outils de replay Claude Code consomment ce format).
// Retourne le chemin du fichier écrit.
func ExportSessionJSONL(cascadeID string) (string, error) {
	src := findTranscriptPath(cascadeID)
	if src == "" {
		return "", fmt.Errorf("aucun transcript trouvé pour %s", cascadeID)
	}
	f, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer f.Close()

	if err := os.MkdirAll(jsonlExportDir, 0755); err != nil {
		return "", err
	}
	outPath := filepath.Join(jsonlExportDir, cascadeID+".jsonl")
	outFile, err := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return "", err
	}
	defer outFile.Close()

	writer := bufio.NewWriter(outFile)
	defer writer.Flush()

	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	index := 0
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var step map[string]interface{}
		if err := json.Unmarshal(line, &step); err != nil {
			continue
		}
		entry := map[string]interface{}{"index": index, "step": step}
		b, err := json.Marshal(entry)
		if err != nil {
			continue
		}
		writer.Write(b)
		writer.WriteByte('\n')
		index++
	}

	done := map[string]interface{}{"type": "done", "session_id": "", "exit_code": 0}
	b, _ := json.Marshal(done)
	writer.Write(b)
	writer.WriteByte('\n')

	return outPath, nil
}

// convertTranscriptToJSONL transforme les lignes JSON brutes du transcript en
// lignes JSONL structurées : {"index":N,"step":{...}} puis un marqueur
// final {"type":"done"} (contrat du format Claude Code).
func convertTranscriptToJSONL(raw []byte) (string, error) {
	var out strings.Builder
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	index := 0
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var step map[string]interface{}
		if err := json.Unmarshal(line, &step); err != nil {
			continue // ligne invalide — on saute, on ne casse pas l'export
		}
		entry := map[string]interface{}{"index": index, "step": step}
		b, err := json.Marshal(entry)
		if err != nil {
			continue
		}
		out.Write(b)
		out.WriteByte('\n')
		index++
	}
	done := map[string]interface{}{"type": "done", "session_id": "", "exit_code": 0}
	b, _ := json.Marshal(done)
	out.Write(b)
	out.WriteByte('\n')
	return out.String(), nil
}
