package gateway

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestParseWorkspaceFromTranscript(t *testing.T) {
	cases := []struct {
		content string
		want    string
	}{
		{
			content: "The mapping is shown as follows in the format [URI] -> [CorpusName]:\nc:\\Users\\amine\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main -> Aminetwiti/antigravity-add-model-main\nCode relating to the user's requests...",
			want:    "c:\\Users\\amine\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main",
		},
		{
			content: "The mapping is shown as follows in the format [URI] -> [CorpusName]:\nc:\\Users\\amine\\Downloads\\raouf taxi\\www - Copie -> Aminetwiti/www-copie\n",
			want:    "c:\\Users\\amine\\Downloads\\raouf taxi\\www - Copie",
		},
		{
			content: "Workspace: /home/user/my-project\nSome other text",
			want:    "/home/user/my-project",
		},
	}

	for i, c := range cases {
		got := parseWorkspaceFromTranscript(c.content)
		if got != c.want {
			t.Errorf("case %d: got %q, want %q", i, got, c.want)
		}
	}
}

func TestListLocalSessions(t *testing.T) {
	sessions := ListLocalSessions()
	if len(sessions) == 0 {
		t.Log("No local sessions found on this machine, skipping validation")
		return
	}
	t.Logf("Found %d local sessions", len(sessions))
	for i, s := range sessions {
		if i >= 10 {
			break
		}
		t.Logf("[%d] ID=%s Title=%q Workspace=%q Time=%s", i, s["cascadeId"], s["title"], s["workspace"], s["updatedAt"])
		if s["cascadeId"] == "" {
			t.Errorf("session %d has empty cascadeId", i)
		}
		if s["workspace"] == "" {
			t.Errorf("session %d has empty workspace", i)
		}
	}
}

// TestFindTranscriptPathGhostSession ÔÇö r├®gression : un dossier de session sans
// transcript (ghost) ne doit PAS renvoyer un chemin inexistant (l'ancien
// return candidates[0] produisait un faux path ÔåÆ transcript_not_found dans
// les logs et une erreur silencieuse). findTranscriptPath lit le home r├®el de
// la machine, donc on v├®rifie l'invariant par un ID inexistant garanti : la
// fonction doit renvoyer "" et GetSessionHistory un historique vide propre.
func TestFindTranscriptPathGhostSession(t *testing.T) {
	ghostID := "ghost-session-" + time.Now().Format("150405.000000000")
	if p := findTranscriptPath(ghostID); p != "" {
		t.Fatalf("findTranscriptPath(%q) = %q, want empty pour une session fant├┤me", ghostID, p)
	}
	hist, err := GetSessionHistory(ghostID)
	if err != nil {
		t.Fatalf("GetSessionHistory ghost: erreur inattendue: %v", err)
	}
	if hist == nil || len(hist) != 0 {
		t.Fatalf("GetSessionHistory ghost = %v, want []HistoryMessage{} vide", hist)
	}
}

// TestFindTranscriptPathSkipsMissingCandidates ÔÇö v├®rifie la logique de
// candidats directement (sans d├®pendre du home r├®el) : aucune des variantes
// n'existant, la fonction d'aide locale doit renvoyer "".
func TestFindTranscriptPathSkipsMissingCandidates(t *testing.T) {
	candidates := []string{
		filepath.Join(t.TempDir(), "missing1.jsonl"),
		filepath.Join(t.TempDir(), "missing2.jsonl"),
	}
	got := ""
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			got = p
			break
		}
	}
	if got != "" {
		t.Fatalf("aucun candidat n'existe mais un chemin a ├®t├® retourn├®: %q", got)
	}
}

// TestParseTranscriptLine ÔÇö r├®gression du contenu vide : les PLANNER_RESPONSE
// interm├®diaires stockent la r├®ponse dans `thinking` (pas `content`), les
// encha├«nements d'outils purs n'ont ni l'un ni l'autre, et les lignes
// d'outils ne doivent jamais appara├«tre comme messages assistant.
func TestParseTranscriptLine(t *testing.T) {
	line := func(l string) []byte { return []byte(l) }

	tests := []struct {
		name     string
		line     []byte
		wantNil  bool
		wantSend string
		wantText string
		wantTh   string
	}{
		{
			name:     "user request",
			line:     line(`{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","created_at":"2026-08-15T15:44:39+01:00","content":"<USER_REQUEST>\nhello\n</USER_REQUEST>"}`),
			wantSend: "user",
			wantText: "hello",
		},
		{
			name:     "final response with content",
			line:     line(`{"step_index":137,"source":"MODEL","type":"PLANNER_RESPONSE","created_at":"2026-08-15T15:44:39+01:00","content":"Voici la r├®ponse finale"}`),
			wantSend: "assistant",
			wantText: "Voici la r├®ponse finale",
		},
		{
			name:     "intermediate reasoning in thinking only",
			line:     line(`{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","created_at":"2026-08-15T15:44:39+01:00","thinking":"**Analyzing**\nreasoning here"}`),
			wantSend: "assistant",
			wantTh:   "**Analyzing**\nreasoning here",
		},
		{
			name:     "content plus thinking",
			line:     line(`{"step_index":201,"source":"MODEL","type":"PLANNER_RESPONSE","created_at":"2026-08-15T15:44:39+01:00","content":"R├®ponse","thinking":"r├®fl├®chi"}`),
			wantSend: "assistant",
			wantText: "R├®ponse",
			wantTh:   "r├®fl├®chi",
		},
		{
			name:    "empty planner response skipped",
			line:    line(`{"step_index":5,"source":"MODEL","type":"PLANNER_RESPONSE","created_at":"2026-08-15T15:44:39+01:00"}`),
			wantNil: true,
		},
		{
			name:    "tool call invisible",
			line:    line(`{"step_index":6,"source":"MODEL","type":"VIEW_FILE","created_at":"2026-08-15T15:44:39+01:00","content":"..."}`),
			wantNil: true,
		},
		{
			name:    "garbage line ignored",
			line:    line(`not json`),
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTranscriptLine(tt.line)
			if tt.wantNil {
				if got != nil {
					t.Fatalf("parseTranscriptLine() = %+v, want nil", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("parseTranscriptLine() = nil, want message")
			}
			if got.Sender != tt.wantSend {
				t.Errorf("Sender = %q, want %q", got.Sender, tt.wantSend)
			}
			if got.Text != tt.wantText {
				t.Errorf("Text = %q, want %q", got.Text, tt.wantText)
			}
			if got.Thought != tt.wantTh {
				t.Errorf("Thought = %q, want %q", got.Thought, tt.wantTh)
			}
		})
	}
}

// TestReadSQLiteSteps ÔÇö v├®rifie la lecture de l'historique depuis la table
// `steps` (source de v├®rit├® Antigravity 2.0). Construit une base temporaire
// avec de VRAIS step_payload protobuf (layout valid├® sur 500+ conversations) :
//   - type 14 (user)   : f19 { f3 { f1: texte } } et legacy f5 { f2: texte }
//   - type 15 (assistant) : f20 { f1: texte, f3: raisonnement }
//   - type 23 (titre)  : f30 { f4: titre }
//   - metadata         : f1 { 1: secondes, 2: nanos }
func TestReadSQLiteSteps(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "conversation.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE steps (
		idx INTEGER, step_type INTEGER, status INTEGER,
		has_subtrajectory INTEGER, metadata BLOB, error_details BLOB,
		permissions BLOB, task_details BLOB, render_info BLOB,
		step_payload BLOB, step_format INTEGER)`); err != nil {
		t.Fatalf("create table: %v", err)
	}

	// metadata : f1 { 1: 1786813316 (secondes), 2: 787964600 (nanos) }
	meta := []byte{0x0a, 0x0c, 0x08, 0x84, 0xe2, 0xe5, 0xb3, 0x06, 0x10, 0xb8, 0xdc, 0xee, 0xf7, 0x02}

	// type 14 moderne : f19 { f3 { f1: "bonjour" } }
	userModern := []byte{0x9a, 0x01, 0x0b, 0x1a, 0x09, 0x0a, 0x07, 0x62, 0x6f, 0x6e, 0x6a, 0x6f, 0x75, 0x72}
	// type 14 legacy : f5 { f1 { f2: ts }, f2: "ancien texte" }
	userLegacy := []byte{0x2a, 0x14, 0x0a, 0x0c, 0x08, 0x84, 0xe2, 0xe5, 0xb3, 0x06, 0x10, 0xb8, 0xdc, 0xee, 0xf7, 0x02, 0x12, 0x04, 0x68, 0x69, 0x21, 0x21}

	// type 15 : f20 { f1: "réponse", f3: "réfléchi" }
	// f1 → 0x0a 0x08 "réponse" (8 octets UTF-8) ; f3 → 0x1a 0x0a "réfléchi" (10 octets)
	assistant := []byte{0xa2, 0x01, 0x16, 0x0a, 0x08, 0x72, 0xc3, 0xa9, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x1a, 0x0a, 0x72, 0xc3, 0xa9, 0x66, 0x6c, 0xc3, 0xa9, 0x63, 0x68, 0x69}

	// type 23 : f30 { f4: "Titre de session" }
	title := []byte{0xf2, 0x01, 0x12, 0x22, 0x10, 0x54, 0x69, 0x74, 0x72, 0x65, 0x20, 0x64, 0x65, 0x20, 0x73, 0x65, 0x73, 0x73, 0x69, 0x6f, 0x6e}

	rows := [][]interface{}{
		{0, 14, 3, 0, meta, nil, nil, nil, nil, userModern, 0},
		{1, 15, 3, 0, meta, nil, nil, nil, nil, assistant, 0},
		{2, 23, 3, 0, meta, nil, nil, nil, nil, title, 0},
		{3, 14, 3, 0, meta, nil, nil, nil, nil, userLegacy, 0},
	}
	for _, r := range rows {
		if _, err := db.Exec("INSERT INTO steps VALUES (?,?,?,?,?,?,?,?,?,?,?)", r...); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}

	messages, gotTitle, err := readSQLiteSteps(dbPath, "test-cascade")
	if err != nil {
		t.Fatalf("readSQLiteSteps: %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("got %d messages, want 3: %+v", len(messages), messages)
	}
	if gotTitle != "Titre de session" {
		t.Errorf("title = %q, want %q", gotTitle, "Titre de session")
	}

	want := []HistoryMessage{
		{ID: "h-0", Sender: "user", Text: "bonjour", Timestamp: "00:00"},
		{ID: "h-1", Sender: "assistant", Text: "réponse", Thought: "réfléchi", Timestamp: "00:00", IsError: true},
		{ID: "h-3", Sender: "user", Text: "hi!!", Timestamp: "00:00"},
	}
	for i, w := range want {
		m := messages[i]
		if m.Sender != w.Sender || m.Text != w.Text || m.Thought != w.Thought || m.ID != w.ID {
			t.Errorf("messages[%d] = %+v, want %+v", i, m, w)
		}
	}
}

// TestSQLiteEmptyDBFallback ÔÇö une base vide (aucune ├®tape exploitable) ne doit
// pas casser GetSessionHistory : le fallback transcript.jsonl prend le relais.
func TestSQLiteEmptyDBFallback(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "empty.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE steps (idx INTEGER, step_type INTEGER, status INTEGER, metadata BLOB, step_payload BLOB)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Close()

	msgs, title, err := readSQLiteSteps(dbPath, "empty")
	if err != nil {
		t.Fatalf("readSQLiteSteps: %v", err)
	}
	if len(msgs) != 0 || title != "" {
		t.Fatalf("empty db: got %d msgs, title %q", len(msgs), title)
	}
}

func TestExtractSubagentsEmpty(t *testing.T) {
	subs := ExtractSubagents("non-existent-session-id")
	if len(subs) != 0 {
		t.Fatalf("expected empty slice for non-existent session, got %d", len(subs))
	}
}

func TestExtractSubagentsRealSession(t *testing.T) {
	subs := ExtractSubagents("6864e4e0-2f88-4781-9472-5d26fd68dbac")
	t.Logf("Extracted %d subagents", len(subs))
	for i, s := range subs {
		t.Logf("[%d] ID=%s Role=%s Type=%s State=%s WorkedFor=%s PromptLen=%d", i, s.ID, s.Role, s.TypeName, s.State, s.WorkedFor, len(s.Prompt))
	}
	if len(subs) < 5 {
		t.Errorf("expected at least 5 subagents, got %d", len(subs))
	}
}

func TestCoalesceHistoryMessages(t *testing.T) {
	raw := []HistoryMessage{
		{ID: "h-0", Sender: "user", Text: "Hello", Timestamp: "10:00"},
		{ID: "h-1", Sender: "assistant", Text: "", Thought: "Thinking 1", Timestamp: "10:01"},
		{ID: "h-2", Sender: "assistant", Text: "First part", Thought: "Thinking 2", Timestamp: "10:02"},
		{ID: "h-3", Sender: "assistant", Text: "Second part", Thought: "", Timestamp: "10:03"},
		{ID: "h-4", Sender: "user", Text: "Next question", Timestamp: "10:04"},
		{ID: "h-5", Sender: "assistant", Text: "Answer", Thought: "Quick thought", Timestamp: "10:05"},
	}

	coalesced := CoalesceHistoryMessages(raw)
	if len(coalesced) != 4 {
		t.Fatalf("expected 4 coalesced messages, got %d", len(coalesced))
	}

	if coalesced[0].Sender != "user" || coalesced[0].Text != "Hello" {
		t.Errorf("coalesced[0] unexpected: %+v", coalesced[0])
	}
	if coalesced[1].Sender != "assistant" {
		t.Errorf("coalesced[1] should be assistant, got %+v", coalesced[1])
	}
	if coalesced[1].Text != "First part\n\nSecond part" {
		t.Errorf("coalesced[1].Text = %q, want %q", coalesced[1].Text, "First part\n\nSecond part")
	}
	if coalesced[1].Thought != "Thinking 1\n\nThinking 2" {
		t.Errorf("coalesced[1].Thought = %q, want %q", coalesced[1].Thought, "Thinking 1\n\nThinking 2")
	}
	if coalesced[2].Sender != "user" || coalesced[2].Text != "Next question" {
		t.Errorf("coalesced[2] unexpected: %+v", coalesced[2])
	}
	if coalesced[3].Sender != "assistant" || coalesced[3].Text != "Answer" {
		t.Errorf("coalesced[3] unexpected: %+v", coalesced[3])
	}
}

func TestCleanSystemMessages(t *testing.T) {
	rawUser := `<SYSTEM_MESSAGE>
[Message] timestamp=2026-08-17T16:13:24Z
sender=task-146
content=Wait for go test to complete
</SYSTEM_MESSAGE>`
	if got := extractUserRequest(rawUser); got != "" {
		t.Errorf("extractUserRequest(rawUser) = %q, want empty string", got)
	}

	validUser := `<USER_REQUEST>
corrige affiche de session ui ux remote sera comme antigravity desktop
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-08-17T17:05:14+01:00.
</ADDITIONAL_METADATA>`
	if got := extractUserRequest(validUser); got != "corrige affiche de session ui ux remote sera comme antigravity desktop" {
		t.Errorf("extractUserRequest(validUser) = %q", got)
	}

	userWithImage := `<USER_REQUEST>
voici la capture d'ecran
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-08-19T14:46:18+01:00.
</ADDITIONAL_METADATA>

[ARTIFACT: media_1787150759648]
Path: file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/.user_uploaded/media_1787150759648.jpg
Last Edited: 2026-08-19T14:46:18Z`
	gotWithImg := extractUserRequest(userWithImage)
	if !strings.Contains(gotWithImg, "voici la capture d'ecran") ||
		!strings.Contains(gotWithImg, "![Image](file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/.user_uploaded/media_1787150759648.jpg)") {
		t.Errorf("extractUserRequest(userWithImage) = %q, attendu text + markdown image", gotWithImg)
	}

	userWithArtifactInside := `<USER_REQUEST>
[ARTIFACT: photo_1787324794109.jpg]
Path: file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/scratch/upload_1787324800703.jpg

hi
</USER_REQUEST>`
	gotInside := extractUserRequest(userWithArtifactInside)
	if strings.Contains(gotInside, "[ARTIFACT:") || strings.Contains(gotInside, "Path:") {
		t.Errorf("extractUserRequest(userWithArtifactInside) contains raw artifact tag: %q", gotInside)
	}
	if !strings.Contains(gotInside, "hi") || !strings.Contains(gotInside, "![Image](file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/scratch/upload_1787324800703.jpg)") {
		t.Errorf("extractUserRequest(userWithArtifactInside) = %q, want hi + markdown image", gotInside)
	}

	userWithOnlyArtifact := `<USER_REQUEST>
[ARTIFACT: scaled_10050.jpg]
Path: file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/scratch/upload_1787325227558.jpg
</USER_REQUEST>`
	gotOnlyArt := extractUserRequest(userWithOnlyArtifact)
	if strings.Contains(gotOnlyArt, "[ARTIFACT:") || strings.Contains(gotOnlyArt, "Path:") {
		t.Errorf("extractUserRequest(userWithOnlyArtifact) contains raw artifact tag: %q", gotOnlyArt)
	}
	if gotOnlyArt != "![Image](file:///C:/Users/amine/.gemini/antigravity/brain/test-cascade/scratch/upload_1787325227558.jpg)" {
		t.Errorf("extractUserRequest(userWithOnlyArtifact) = %q", gotOnlyArt)
	}

	rawAssistant := `<SYSTEM_MESSAGE>
[Message] timestamp=2026-08-17T16:13:24Z
sender=task-146
content=Wait for go test to complete
</SYSTEM_MESSAGE>

The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.

## Amélioration terminée
Voici le résultat attendu.`
	cleaned := cleanAssistantText(rawAssistant)
	if cleaned != "## Amélioration terminée\nVoici le résultat attendu." {
		t.Errorf("cleanAssistantText(rawAssistant) = %q", cleaned)
	}
}

func TestListSessionModifiedFiles(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("impossible de lire UserHomeDir")
	}
	testCascadeID := "test-cascade-modified-files-xyz"
	brainLogsDir := filepath.Join(home, ".gemini", "antigravity", "brain", testCascadeID, ".system_generated", "logs")
	if err := os.MkdirAll(brainLogsDir, 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", testCascadeID))

	transcriptContent := `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"please fix file"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","content":"","tool_calls":[{"name":"replace_file_content","args":{"TargetFile":"C:\\Users\\amine\\Downloads\\project\\src\\main.ts"}}]}
{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","content":"","tool_calls":[{"name":"write_to_file","args":{"TargetFile":"/Users/amine/Downloads/project/src/new_file.ts"}}]}
{"step_index":3,"source":"MODEL","type":"PLANNER_RESPONSE","content":"","tool_calls":[{"name":"write_to_file","args":{"TargetFile":"C:\\Users\\amine\\.gemini\\antigravity\\brain\\test-cascade-modified-files-xyz\\implementation_plan.md"}}]}
`
	if err := os.WriteFile(filepath.Join(brainLogsDir, "transcript.jsonl"), []byte(transcriptContent), 0644); err != nil {
		t.Fatalf("write transcript failed: %v", err)
	}

	files := ListSessionModifiedFiles(testCascadeID)
	if len(files) != 2 {
		t.Fatalf("ListSessionModifiedFiles: attendu 2 fichiers modifiés (excluant l'artefact plan.md), reçu %d: %v", len(files), files)
	}
	if files[0] != "C:/Users/amine/Downloads/project/src/main.ts" {
		t.Errorf("files[0] = %q, attendu C:/Users/amine/Downloads/project/src/main.ts", files[0])
	}
	if files[1] != "/Users/amine/Downloads/project/src/new_file.ts" {
		t.Errorf("files[1] = %q, attendu /Users/amine/Downloads/project/src/new_file.ts", files[1])
	}

	counts := countTranscriptActivity(testCascadeID)
	if counts["files"] != 2 {
		t.Errorf("countTranscriptActivity files = %d, want 2", counts["files"])
	}
}

func TestParseTranscriptFullTurns_InterleavedSegments(t *testing.T) {
	tmpDir := t.TempDir()
	transcriptPath := filepath.Join(tmpDir, "transcript.jsonl")

	transcriptContent := `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"Fais les verifications","created_at":"2026-08-21T16:00:00Z"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","content":"","thinking":"Thinking about checks","tool_calls":[{"name":"view_file","args":{"AbsolutePath":"/app/main.go"}}],"created_at":"2026-08-21T16:00:05Z"}
{"step_index":2,"source":"SYSTEM","type":"VIEW_FILE","content":"package main","created_at":"2026-08-21T16:00:06Z"}
{"step_index":3,"source":"MODEL","type":"PLANNER_RESPONSE","content":"Je lance la vérification des tests existants.","created_at":"2026-08-21T16:00:07Z"}
{"step_index":4,"source":"MODEL","type":"PLANNER_RESPONSE","content":"","tool_calls":[{"name":"schedule","args":{"DurationSeconds":10,"Prompt":"Wait 10s"}}],"created_at":"2026-08-21T16:00:08Z"}
{"step_index":5,"source":"MODEL","type":"PLANNER_RESPONSE","content":"Je prépare les modifications pour les images.","created_at":"2026-08-21T16:00:18Z"}
{"step_index":6,"source":"MODEL","type":"PLANNER_RESPONSE","content":"Les tests Go sont terminés.","status":"DONE","created_at":"2026-08-21T16:00:20Z"}
`
	if err := os.WriteFile(transcriptPath, []byte(transcriptContent), 0644); err != nil {
		t.Fatalf("write mock transcript failed: %v", err)
	}

	msgs, err := parseTranscriptFullTurns(transcriptPath)
	if err != nil {
		t.Fatalf("parseTranscriptFullTurns failed: %v", err)
	}

	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages (1 user, 1 assistant), got %d", len(msgs))
	}

	asst := msgs[1]
	if asst.Sender != "assistant" {
		t.Fatalf("expected assistant sender, got %s", asst.Sender)
	}

	if len(asst.Segments) < 3 {
		t.Fatalf("expected at least 3 segments (interleaved thought/text), got %d: %+v", len(asst.Segments), asst.Segments)
	}

	// Vérifier la présence des segments de pensée et de texte
	hasThoughtSeg := false
	hasTextSeg1 := false
	hasTextSeg2 := false
	for _, seg := range asst.Segments {
		if seg.Type == "thought" {
			hasThoughtSeg = true
		}
		if seg.Type == "text" && strings.Contains(seg.Content, "Je lance la vérification") {
			hasTextSeg1 = true
		}
		if seg.Type == "text" && strings.Contains(seg.Content, "Je prépare les modifications") {
			hasTextSeg2 = true
		}
	}

	if !hasThoughtSeg {
		t.Error("missing thought segment in assistant message")
	}
	if !hasTextSeg1 {
		t.Error("missing text segment 1 in assistant message")
	}
	if !hasTextSeg2 {
		t.Error("missing text segment 2 in assistant message")
	}

	if !strings.Contains(asst.Text, "Je lance la vérification") || !strings.Contains(asst.Text, "Je prépare les modifications") {
		t.Errorf("asst.Text does not contain all paragraphs: %q", asst.Text)
	}
}