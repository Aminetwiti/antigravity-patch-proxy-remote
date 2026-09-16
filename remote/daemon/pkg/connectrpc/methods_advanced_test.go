package connectrpc

import (
	"testing"
)

func TestBuildStartBattleMode(t *testing.T) {
	blob := BuildStartBattleMode("file:///workspace/repo", "Compare implementations", "claude-3-7-sonnet", 384, "gemini-1-5-pro", 246)
	if len(blob) == 0 {
		t.Fatalf("BuildStartBattleMode produced empty bytes")
	}

	fields := DecodeFields(blob)
	if len(fields) < 3 {
		t.Fatalf("Expected at least 3 fields, got %d", len(fields))
	}

	// Field 1 = request (SendUserCascadeMessageRequest)
	if fields[0].Num != 1 || len(fields[0].Bytes) == 0 {
		t.Errorf("Field 1 mismatch for SendUserCascadeMessageRequest")
	}
	// Field 2 = num_forks (2)
	if fields[1].Num != 2 || fields[1].Varint != 2 {
		t.Errorf("Field 2 mismatch: %d", fields[1].Varint)
	}
	// Field 3 = models (repeated enum)
	if fields[2].Num != 3 || fields[2].Varint != 384 {
		t.Errorf("Field 3 mismatch: %d", fields[2].Varint)
	}
}

func TestBuildGetBattleWorktreeDiff(t *testing.T) {
	blob := BuildGetBattleWorktreeDiff("file:///workspace/repo")
	fields := DecodeFields(blob)
	if len(fields) != 1 || fields[0].Num != 1 || string(fields[0].Bytes) != "file:///workspace/repo" {
		t.Errorf("Field 1 mismatch for GetBattleWorktreeDiff")
	}
}

func TestBuildEliminateBattleModeArm(t *testing.T) {
	blob := BuildEliminateBattleModeArm("arm_b", "source_conv_1")
	fields := DecodeFields(blob)
	if len(fields) != 2 || fields[0].Num != 1 || string(fields[0].Bytes) != "source_conv_1" || fields[1].Num != 2 || string(fields[1].Bytes) != "arm_b" {
		t.Errorf("Fields mismatch for EliminateBattleModeArm: %+v", fields)
	}
}

func TestBuildEndBattleMode(t *testing.T) {
	blob := BuildEndBattleMode("arm_a", 2, "source_conv_1") // 2 = SAFE_MERGE
	fields := DecodeFields(blob)
	if len(fields) < 3 {
		t.Fatalf("Expected at least 3 fields, got %d", len(fields))
	}
	if fields[0].Num != 1 || string(fields[0].Bytes) != "arm_a" {
		t.Errorf("Field 1 mismatch: %s", string(fields[0].Bytes))
	}
	if fields[1].Num != 2 || fields[1].Varint != 2 {
		t.Errorf("Field 2 mismatch: %d", fields[1].Varint)
	}
	if fields[2].Num != 3 || fields[2].Varint != 1 {
		t.Errorf("Field 3 mismatch: %d", fields[2].Varint)
	}
}

func TestBuildDumpFlightRecorder(t *testing.T) {
	blob := BuildDumpFlightRecorder()
	if len(blob) != 0 {
		t.Errorf("Expected 0 bytes for empty request, got %d", len(blob))
	}
}

func TestBuildMcpLifecycle(t *testing.T) {
	refresh := BuildRefreshMcpServers()
	if len(refresh) != 0 {
		t.Errorf("Expected 0 bytes for RefreshMcpServers, got %d", len(refresh))
	}

	oauth := BuildCompleteMcpOAuth("coolify", "auth-token-xyz")
	fields := DecodeFields(oauth)
	if len(fields) != 2 || string(fields[0].Bytes) != "coolify" || string(fields[1].Bytes) != "auth-token-xyz" {
		t.Errorf("CompleteMcpOAuth fields mismatch")
	}

	disconnect := BuildDisconnectMcpOAuth("coolify")
	fieldsDisc := DecodeFields(disconnect)
	if len(fieldsDisc) != 1 || string(fieldsDisc[0].Bytes) != "coolify" {
		t.Errorf("DisconnectMcpOAuth fields mismatch")
	}
}
