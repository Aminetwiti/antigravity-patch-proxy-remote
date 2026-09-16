package connectrpc

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// ─── Encodeurs P0 (schémas vérifiés dans antigravity-client) ───

func TestBuildDeleteCascadeTrajectory(t *testing.T) {
	got := BuildDeleteCascadeTrajectory("casc-123")
	// field 1 (key 0x0A), len 8, "casc-123"
	want := []byte{0x0A, 0x08}
	want = append(want, []byte("casc-123")...)
	if !bytes.Equal(got, want) {
		t.Fatalf("BuildDeleteCascadeTrajectory = %x, attendu %x", got, want)
	}
}

func TestBuildReadFileRequest(t *testing.T) {
	uri := "file:///C:/proj/main.go"
	got := BuildReadFileRequest(uri)
	fields := DecodeFields(got)
	if len(fields) != 1 || fields[0].Num != 1 || string(fields[0].Bytes) != uri {
		t.Fatalf("BuildReadFileRequest = %x, attendu {1: %q}", got, uri)
	}
}

func TestBuildWriteFileRequest(t *testing.T) {
	uri := "file:///C:/proj/a.txt"
	content := []byte("hello")
	got := BuildWriteFileRequest(uri, content, true)
	fields := DecodeFields(got)
	if len(fields) != 3 {
		t.Fatalf("BuildWriteFileRequest = %x, attendu 3 champs, reçu %d", got, len(fields))
	}
	if fields[0].Num != 1 || string(fields[0].Bytes) != uri {
		t.Fatalf("champ 1 = %v, attendu uri", fields[0])
	}
	if fields[1].Num != 2 || !bytes.Equal(fields[1].Bytes, content) {
		t.Fatalf("champ 2 = %v, attendu content", fields[1])
	}
	if fields[2].Num != 3 || fields[2].Varint != 1 {
		t.Fatalf("champ 3 = %v, attendu overwrite=true", fields[2])
	}

	// overwrite=false → champ 3 absent
	gotNoOverwrite := BuildWriteFileRequest(uri, content, false)
	if len(DecodeFields(gotNoOverwrite)) != 2 {
		t.Fatalf("overwrite=false devrait omettre le champ 3 : %x", gotNoOverwrite)
	}
}

func TestBuildStatUriRequest(t *testing.T) {
	uri := "file:///C:/proj"
	got := BuildStatUriRequest(uri)
	fields := DecodeFields(got)
	if len(fields) != 1 || fields[0].Num != 1 || string(fields[0].Bytes) != uri {
		t.Fatalf("BuildStatUriRequest = %x, attendu {1: %q}", got, uri)
	}
}

// ─── ParseModels (best-effort) ───

// frameModels encapsule un payload protobuf dans une frame gRPC-Web.
func frameModels(payload []byte) []byte {
	buf := make([]byte, 5+len(payload))
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(payload)))
	copy(buf[5:], payload)
	return buf
}

// buildModelDetails construit un ModelDetails (champs 1,2,3,6,13 du schéma
// vérifié model_configs_pb.ts).
func buildModelDetails(displayName string, supportsImages, supportsThinking, recommended, disabled bool) []byte {
	w := &writer{}
	w.stringField(1, displayName)
	if supportsImages {
		w.varintField(2, 1)
	}
	if supportsThinking {
		w.varintField(3, 1)
	}
	if recommended {
		w.varintField(6, 1)
	}
	if disabled {
		w.varintField(13, 1)
	}
	return w.b
}

// buildModelsEntry construit une ModelsEntry {1: key, 2: value}.
func buildModelsEntry(key string, details []byte) []byte {
	w := &writer{}
	w.stringField(1, key)
	w.bytesField(2, details)
	return w.b
}

func TestParseModelsRealisticPayload(t *testing.T) {
	// FetchAvailableModelsResponse {1: ModelsEntry...}
	fetch := &writer{}
	fetch.bytesField(1, buildModelsEntry("claude-sonnet-4-6", buildModelDetails("Claude Sonnet 4.6", true, true, true, false)))
	fetch.bytesField(1, buildModelsEntry("gemini-3.1-pro-high", buildModelDetails("Gemini 3.1 Pro High", true, true, false, false)))
	fetch.bytesField(1, buildModelsEntry("disabled-model", buildModelDetails("Old Model", false, false, false, true)))

	// GetAvailableModelsResponse {1: FetchAvailableModelsResponse}
	outer := &writer{}
	outer.bytesField(1, fetch.b)

	models, ok := ParseModels(frameModels(outer.b))
	if !ok {
		t.Fatal("ParseModels devrait retourner ok=true sur payload réaliste")
	}
	if len(models) != 3 {
		t.Fatalf("attendu 3 modèles, reçu %d: %+v", len(models), models)
	}
	m := models[0]
	if m.ModelID != "claude-sonnet-4-6" || m.DisplayName != "Claude Sonnet 4.6" {
		t.Fatalf("modèle[0] = %+v", m)
	}
	if !m.SupportsImages || !m.SupportsThinking || !m.Recommended || m.Disabled {
		t.Fatalf("modèle[0] flags = %+v", m)
	}
	if models[2].Disabled != true || models[2].Recommended != false {
		t.Fatalf("modèle[2] flags = %+v", models[2])
	}
}

func TestParseModelsCorruptedPayload(t *testing.T) {
	// Payload corrompu : des champs aléatoires — ne doit JAMAIS paniquer.
	models, ok := ParseModels([]byte{0xFF, 0xFF, 0xFF, 0x00, 0x01, 0x02, 0x03})
	if ok {
		t.Fatalf("payload corrompu devrait retourner ok=false, reçu %+v", models)
	}

	// Réponse vide mais valide → ok=false (pas de modèle, pas d'erreur).
	models, ok = ParseModels(frameModels(nil))
	if ok {
		t.Fatal("réponse vide devrait retourner ok=false")
	}
	if models != nil {
		t.Fatalf("réponse vide devrait retourner nil, reçu %+v", models)
	}

	// Payload non protobuf mais frame valide → pas de panic, ok=false.
	models, ok = ParseModels(frameModels([]byte("not a protobuf")))
	if ok {
		t.Fatalf("payload texte devrait retourner ok=false, reçu %+v", models)
	}
}

func TestParseModelsNeverPanics(t *testing.T) {
	// Fuzz léger intégré : 1000 payloads aléatoires, jamais de panic.
	seed := []byte("deterministic-seed")
	for i := 0; i < 1000; i++ {
		raw := make([]byte, i%64)
		for j := range raw {
			raw[j] = seed[(i+j)%len(seed)]
		}
		func() {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("ParseModels a paniqué sur %x: %v", raw, p)
				}
			}()
			_, _ = ParseModels(raw)
		}()
	}
}

func TestParseReadFileResponse(t *testing.T) {
	fileContent := []byte("PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	w := &writer{}
	w.bytesField(1, fileContent)
	parsed := ParseReadFileResponse(w.b)
	if !bytes.Equal(parsed, fileContent) {
		t.Fatalf("ParseReadFileResponse = %x, attendu %x", parsed, fileContent)
	}

	// Raw content without protobuf tags fallback
	raw := []byte("raw plain text")
	if !bytes.Equal(ParseReadFileResponse(raw), raw) {
		t.Fatalf("ParseReadFileResponse fallback attendu %s", string(raw))
	}
}

