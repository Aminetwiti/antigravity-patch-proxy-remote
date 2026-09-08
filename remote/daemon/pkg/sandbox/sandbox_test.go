package sandbox

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNativeSandbox_ExecuteAndStream(t *testing.T) {
	sb := NewNativeSandbox()
	if !sb.IsAvailable() {
		t.Fatalf("NativeSandbox should always be available")
	}
	if sb.Name() != "native" {
		t.Errorf("expected name 'native', got %s", sb.Name())
	}

	var chunks []string
	var mu sync.Mutex
	onChunk := func(chunk []byte) {
		mu.Lock()
		chunks = append(chunks, string(chunk))
		mu.Unlock()
	}

	req := ExecutionRequest{
		SessionID:   "sess-test",
		WorkspaceID: "ws-test",
		CommandLine: "echo sandbox_test_output",
		Timeout:     5 * time.Second,
	}

	res, err := sb.Execute(context.Background(), req, onChunk)
	if err != nil {
		t.Fatalf("execution failed: %v", err)
	}

	if res.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %d", res.ExitCode)
	}

	if !strings.Contains(res.Output, "sandbox_test_output") {
		t.Errorf("expected output to contain 'sandbox_test_output', got %q", res.Output)
	}

	mu.Lock()
	chunkCount := len(chunks)
	mu.Unlock()
	if chunkCount == 0 {
		t.Errorf("expected at least 1 streaming chunk")
	}
}

func TestNativeSandbox_Timeout(t *testing.T) {
	sb := NewNativeSandbox()

	// Run a command that takes longer than timeout
	var cmd string
	cmd = "powershell -Command Start-Sleep -Milliseconds 500"

	req := ExecutionRequest{
		SessionID:   "sess-timeout",
		WorkspaceID: "ws-test",
		CommandLine: cmd,
		Timeout:     50 * time.Millisecond,
	}

	res, err := sb.Execute(context.Background(), req, nil)
	if err != nil {
		// Execution might return error on timeout context
		return
	}
	if res.ExitCode == 0 && res.Error == "" {
		t.Errorf("expected non-zero exit code or error on timeout, got exit %d err %q", res.ExitCode, res.Error)
	}
}

func TestDockerSandbox_FailClosedOnStrict(t *testing.T) {
	cfg := DockerSandboxConfig{
		Image:       "nonexistent-image-xyz:latest",
		MemoryLimit: "256m",
		Mode:        ModeStrict,
	}
	sb := NewDockerSandbox(cfg)

	if sb.Name() != "docker" {
		t.Errorf("expected name 'docker', got %s", sb.Name())
	}

	req := ExecutionRequest{
		SessionID:   "sess-strict",
		WorkspaceID: "ws-test",
		CommandLine: "echo should_fail",
		Timeout:     5 * time.Second,
	}

	if !sb.IsAvailable() {
		_, err := sb.Execute(context.Background(), req, nil)
		if err == nil {
			t.Fatalf("expected ErrSandboxUnavailable in strict mode when docker is down, got nil")
		}
		if !strings.Contains(err.Error(), "sandboxed execution failed") {
			t.Errorf("expected ErrSandboxUnavailable, got: %v", err)
		}
	}
}

func TestDockerSandbox_FallbackWhenPreferred(t *testing.T) {
	cfg := DockerSandboxConfig{
		Image:       "nonexistent-image-xyz:latest",
		MemoryLimit: "256m",
		Mode:        ModePreferred,
	}
	sb := NewDockerSandbox(cfg)

	req := ExecutionRequest{
		SessionID:   "sess-fb",
		WorkspaceID: "ws-test",
		CommandLine: "echo fallback_success",
		Timeout:     5 * time.Second,
	}

	if !sb.IsAvailable() {
		res, err := sb.Execute(context.Background(), req, nil)
		if err != nil {
			t.Fatalf("fallback execution failed in preferred mode: %v", err)
		}
		if !strings.Contains(res.Output, "fallback_success") {
			t.Errorf("expected fallback output to contain 'fallback_success', got %q", res.Output)
		}
	}
}
