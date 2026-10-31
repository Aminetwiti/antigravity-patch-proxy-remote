package agent

import (
	"context"
	"encoding/json"

	"github.com/antigravity/remote-daemon/pkg/tools"
)

type LLMMessage struct {
	Role       string          `json:"role"` // "system", "user", "assistant", "tool"
	Content    string          `json:"content"`
	ToolCalls  []ToolCall      `json:"toolCalls,omitempty"`
	ToolCallID string          `json:"toolCallId,omitempty"`
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type UsageInfo struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
}

type LLMResponse struct {
	Thought   string     `json:"thought,omitempty"`
	Message   string     `json:"message,omitempty"`
	ToolCalls []ToolCall `json:"toolCalls,omitempty"`
	Done      bool       `json:"done"`
	Usage     UsageInfo  `json:"usage,omitempty"`
}

type LLMClient interface {
	Generate(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*LLMResponse, error)
}

// MockLLMClient for deterministic testing and offline execution simulation
type MockLLMClient struct {
	Responses []*LLMResponse
	callIndex int
}

func NewMockLLMClient(responses ...*LLMResponse) *MockLLMClient {
	return &MockLLMClient{
		Responses: responses,
	}
}

func (m *MockLLMClient) Generate(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*LLMResponse, error) {
	if m.callIndex >= len(m.Responses) {
		return &LLMResponse{
			Message: "I have finished processing your request.",
			Done:    true,
		}, nil
	}

	resp := m.Responses[m.callIndex]
	m.callIndex++

	if onChunk != nil && resp.Thought != "" {
		onChunk(resp.Thought)
	}
	if onChunk != nil && resp.Message != "" {
		onChunk(resp.Message)
	}

	return resp, nil
}
