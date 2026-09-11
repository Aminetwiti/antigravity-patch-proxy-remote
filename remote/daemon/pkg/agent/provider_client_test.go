package agent_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/tools"
)

func TestHTTPProviderClient_OpenAI(t *testing.T) {
	var receivedAuth string
	var receivedBody map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)

		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"role":    "assistant",
						"content": "I will run the command.",
						"tool_calls": []map[string]interface{}{
							{
								"id":   "call_abc",
								"type": "function",
								"function": map[string]interface{}{
									"name":      "run_command",
									"arguments": `{"command":"pwd"}`,
								},
							},
						},
					},
					"finish_reason": "tool_calls",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	cfg := agent.ProviderConfig{
		Type:       agent.ProviderOpenAI,
		BaseURL:    server.URL,
		APIKey:     "sk-test-key",
		Model:      "gpt-4o",
		HTTPClient: server.Client(),
	}

	client := agent.NewHTTPProviderClient(cfg)

	msgs := []agent.LLMMessage{
		{Role: "user", Content: "What directory am I in?"},
	}
	sampleTools := []tools.ToolDefinition{
		{Name: "run_command", Description: "Executes command", Parameters: map[string]interface{}{"type": "object"}},
	}

	resp, err := client.Generate(context.Background(), msgs, sampleTools, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	if receivedAuth != "Bearer sk-test-key" {
		t.Errorf("expected Bearer sk-test-key, got: %s", receivedAuth)
	}

	if resp.Message != "I will run the command." {
		t.Errorf("unexpected message: %s", resp.Message)
	}

	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}

	if resp.ToolCalls[0].Name != "run_command" || resp.ToolCalls[0].ID != "call_abc" {
		t.Errorf("unexpected tool call: %+v", resp.ToolCalls[0])
	}
}

func TestHTTPProviderClient_Anthropic(t *testing.T) {
	var receivedKey string
	var receivedVersion string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedKey = r.Header.Get("x-api-key")
		receivedVersion = r.Header.Get("anthropic-version")

		resp := map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": "Reading the project file.",
				},
				{
					"type": "tool_use",
					"id":   "toolu_xyz",
					"name": "view_file",
					"input": map[string]interface{}{
						"path": "main.go",
					},
				},
			},
			"stop_reason": "tool_use",
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	cfg := agent.ProviderConfig{
		Type:       agent.ProviderAnthropic,
		BaseURL:    server.URL,
		APIKey:     "ant-key-123",
		Model:      "claude-3-5-sonnet-20241022",
		HTTPClient: server.Client(),
	}

	client := agent.NewHTTPProviderClient(cfg)

	msgs := []agent.LLMMessage{
		{Role: "user", Content: "Inspect main.go"},
	}
	sampleTools := []tools.ToolDefinition{
		{Name: "view_file", Description: "Reads file", Parameters: map[string]interface{}{"type": "object"}},
	}

	resp, err := client.Generate(context.Background(), msgs, sampleTools, nil)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	if receivedKey != "ant-key-123" {
		t.Errorf("expected x-api-key ant-key-123, got: %s", receivedKey)
	}
	if receivedVersion != "2023-06-01" {
		t.Errorf("expected anthropic-version 2023-06-01, got: %s", receivedVersion)
	}

	if resp.Message != "Reading the project file." {
		t.Errorf("unexpected message: %s", resp.Message)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "view_file" || resp.ToolCalls[0].ID != "toolu_xyz" {
		t.Errorf("unexpected tool call: %+v", resp.ToolCalls[0])
	}
}

func TestAutoDetectProviderConfig_Gemini(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "AIzaSyFakeKey123")
	t.Setenv("GEMINI_MODEL", "gemini-2.5-flash")

	cfg := agent.AutoDetectProviderConfig()
	if cfg.Type != agent.ProviderOpenAI {
		t.Errorf("expected ProviderOpenAI, got: %s", cfg.Type)
	}
	if cfg.APIKey != "AIzaSyFakeKey123" {
		t.Errorf("expected APIKey AIzaSyFakeKey123, got: %s", cfg.APIKey)
	}
	if cfg.Model != "gemini-2.5-flash" {
		t.Errorf("expected model gemini-2.5-flash, got: %s", cfg.Model)
	}
	if cfg.BaseURL != "https://generativelanguage.googleapis.com/v1beta/openai" {
		t.Errorf("expected Gemini OpenAI baseURL, got: %s", cfg.BaseURL)
	}
}
