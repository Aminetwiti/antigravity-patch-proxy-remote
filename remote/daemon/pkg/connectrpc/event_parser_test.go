package connectrpc

import (
	"testing"
)

func TestParseFrameEvents(t *testing.T) {
	// Frame protobuf contenant un payload JSON tool
	jsonPayload := `{"tool":"run_command","command":"ls"}`
	raw := append([]byte{0x0a, byte(len(jsonPayload))}, []byte(jsonPayload)...)
	events := ParseFrameEvents(raw, "cascade-123")

	if len(events) == 0 {
		t.Fatalf("Attendu au moins 1 événement, reçu 0")
	}

	if events[0].Kind != EventKindApprovalRequired {
		t.Errorf("Attendu Kind=%s, reçu=%s", EventKindApprovalRequired, events[0].Kind)
	}

	if events[0].Tool != "run_command" {
		t.Errorf("Attendu Tool=run_command, reçu=%s", events[0].Tool)
	}

	// Test regular text containing command word
	textPayload := "flutter run -d DEVICE_SERIAL_TEST_01"
	rawText := append([]byte{0x0a, byte(len(textPayload))}, []byte(textPayload)...)
	textEvents := ParseFrameEvents(rawText, "cascade-123")
	if len(textEvents) == 0 || textEvents[0].Kind != EventKindText {
		t.Errorf("Attendu Kind=%s pour texte normal, reçu=%v", EventKindText, textEvents)
	}

	// Test explanatory text mentioning tool names
	explText := "Pour analyser le code, vous pouvez utiliser run_command ou read_file."
	rawExpl := append([]byte{0x0a, byte(len(explText))}, []byte(explText)...)
	explEvents := ParseFrameEvents(rawExpl, "cascade-123")
	if len(explEvents) == 0 || explEvents[0].Kind != EventKindText {
		t.Errorf("Attendu Kind=%s pour texte explicatif, reçu=%v", EventKindText, explEvents)
	}
}

func TestParseFrameStructuredInteraction(t *testing.T) {
	// Construction d'une interaction structurée via BuildHandleCascadeUserInteraction
	payload := BuildRunCommandInteraction(true, "npm test", "")
	rawInteraction := BuildHandleCascadeUserInteraction("cascade-abc", "11112222-3333-4444-5555-666677778888", 42, InteractionRunCommand, payload)
	
	events := ParseFrameEvents(rawInteraction, "cascade-abc")
	if len(events) == 0 {
		t.Fatalf("Attendu au moins 1 événement d'interaction structurée, reçu 0")
	}

	if events[0].Kind != EventKindApprovalRequired {
		t.Errorf("Attendu Kind=%s, reçu=%s", EventKindApprovalRequired, events[0].Kind)
	}
	if events[0].StepIndex != 42 {
		t.Errorf("Attendu StepIndex=42, reçu=%d", events[0].StepIndex)
	}
	if events[0].TrajectoryID != "11112222-3333-4444-5555-666677778888" {
		t.Errorf("Attendu TrajectoryID=11112222-3333-4444-5555-666677778888, reçu=%s", events[0].TrajectoryID)
	}
}

func TestIsPrintable(t *testing.T) {
	if !IsPrintable("Hello World 123!\n") {
		t.Errorf("IsPrintable devrait être true pour du texte imprimable")
	}
	if IsPrintable(string([]byte{0x01, 0x02, 0x03})) {
		t.Errorf("IsPrintable devrait être false pour des octets binaires de contrôle")
	}
}

func TestExtractToolName(t *testing.T) {
	if name := extractToolName("executing run_command now"); name != "run_command" {
		t.Errorf("Attendu run_command, reçu=%s", name)
	}
	if name := extractToolName("modifying write_to_file"); name != "write_to_file" {
		t.Errorf("Attendu write_to_file, reçu=%s", name)
	}
	if name := extractToolName(`{"read_file":"src/main.dart"}`); name != "read_file" {
		t.Errorf("Attendu read_file, reçu=%s", name)
	}
	if name := extractToolName(`{"edit_file":"src/main.dart"}`); name != "edit_file" {
		t.Errorf("Attendu edit_file, reçu=%s", name)
	}
	if name := extractToolName(`{"search_files":"todo"}`); name != "search_files" {
		t.Errorf("Attendu search_files, reçu=%s", name)
	}
	if name := extractToolName("unknown action"); name != "generic_tool" {
		t.Errorf("Attendu generic_tool, reçu=%s", name)
	}
}
