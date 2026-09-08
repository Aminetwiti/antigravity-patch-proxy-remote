package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/tools"
)

type ProviderType string

const (
	ProviderOpenAI    ProviderType = "openai"
	ProviderAnthropic ProviderType = "anthropic"
	ProviderOllama    ProviderType = "ollama"
	ProviderProxy     ProviderType = "proxy"
)

type ProviderConfig struct {
	Type       ProviderType
	BaseURL    string
	APIKey     string
	Model      string
	HTTPClient *http.Client
}

func AutoDetectProviderConfig() ProviderConfig {
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		model := os.Getenv("ANTHROPIC_MODEL")
		if model == "" {
			model = "claude-3-5-sonnet-20241022"
		}
		return ProviderConfig{
			Type:    ProviderAnthropic,
			BaseURL: "https://api.anthropic.com",
			APIKey:  key,
			Model:   model,
		}
	}

	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		baseURL := os.Getenv("OPENAI_BASE_URL")
		if baseURL == "" {
			baseURL = "https://api.openai.com/v1"
		}
		model := os.Getenv("OPENAI_MODEL")
		if model == "" {
			model = "gpt-4o"
		}
		return ProviderConfig{
			Type:    ProviderOpenAI,
			BaseURL: baseURL,
			APIKey:  key,
			Model:   model,
		}
	}

	if host := os.Getenv("OLLAMA_HOST"); host != "" {
		model := os.Getenv("OLLAMA_MODEL")
		if model == "" {
			model = "llama3"
		}
		cleanHost := strings.TrimRight(host, "/")
		if !strings.HasSuffix(cleanHost, "/v1") {
			cleanHost += "/v1"
		}
		return ProviderConfig{
			Type:    ProviderOllama,
			BaseURL: cleanHost,
			Model:   model,
		}
	}

	// Default fallback to local Antigravity proxy
	return ProviderConfig{
		Type:    ProviderProxy,
		BaseURL: "http://127.0.0.1:51074/v1",
		Model:   "claude-3-5-sonnet-20241022",
	}
}

type HTTPProviderClient struct {
	cfg        ProviderConfig
	httpClient *http.Client
}

func NewHTTPProviderClient(cfg ProviderConfig) *HTTPProviderClient {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	return &HTTPProviderClient{
		cfg:        cfg,
		httpClient: client,
	}
}

func (c *HTTPProviderClient) Generate(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*LLMResponse, error) {
	switch c.cfg.Type {
	case ProviderAnthropic:
		return c.generateAnthropic(ctx, messages, availableTools, onChunk)
	case ProviderOpenAI, ProviderOllama, ProviderProxy:
		return c.generateOpenAI(ctx, messages, availableTools, onChunk)
	default:
		return c.generateOpenAI(ctx, messages, availableTools, onChunk)
	}
}

// -----------------------------------------------------------------------------
// OpenAI-compatible Chat Completions
// -----------------------------------------------------------------------------

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type openAITool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

type openAIRequest struct {
	Model    string          `json:"model"`
	Messages []openAIMessage `json:"messages"`
	Tools    []openAITool    `json:"tools,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message struct {
			Role      string           `json:"role"`
			Content   string           `json:"content"`
			ToolCalls []openAIToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c *HTTPProviderClient) generateOpenAI(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*LLMResponse, error) {
	reqBody := openAIRequest{
		Model:    c.cfg.Model,
		Messages: make([]openAIMessage, 0, len(messages)),
	}

	for _, m := range messages {
		msg := openAIMessage{
			Role:    m.Role,
			Content: m.Content,
		}
		if m.ToolCallID != "" {
			msg.ToolCallID = m.ToolCallID
		}
		if len(m.ToolCalls) > 0 {
			msg.ToolCalls = make([]openAIToolCall, 0, len(m.ToolCalls))
			for _, tc := range m.ToolCalls {
				var tcObj openAIToolCall
				tcObj.ID = tc.ID
				tcObj.Type = "function"
				tcObj.Function.Name = tc.Name
				tcObj.Function.Arguments = string(tc.Arguments)
				msg.ToolCalls = append(msg.ToolCalls, tcObj)
			}
		}
		reqBody.Messages = append(reqBody.Messages, msg)
	}

	if len(availableTools) > 0 {
		reqBody.Tools = make([]openAITool, 0, len(availableTools))
		for _, t := range availableTools {
			var ot openAITool
			ot.Type = "function"
			ot.Function.Name = t.Name
			ot.Function.Description = t.Description
			ot.Function.Parameters = t.Parameters
			reqBody.Tools = append(reqBody.Tools, ot)
		}
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}

	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		if c.cfg.Type == ProviderProxy {
			return nil, fmt.Errorf("connection to Antigravity proxy failed (%s): please ensure IDE proxy is active, or configure ANTHROPIC_API_KEY/OPENAI_API_KEY for headless server execution: %w", url, err)
		}
		return nil, fmt.Errorf("HTTP request to %s failed: %w", c.cfg.Type, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("provider returned HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	var oaiResp openAIResponse
	if err := json.Unmarshal(respBytes, &oaiResp); err != nil {
		return nil, fmt.Errorf("failed to parse provider response: %w", err)
	}

	if oaiResp.Error != nil {
		return nil, fmt.Errorf("provider API error: %s", oaiResp.Error.Message)
	}

	if len(oaiResp.Choices) == 0 {
		return nil, fmt.Errorf("provider returned 0 choices")
	}

	choice := oaiResp.Choices[0]
	result := &LLMResponse{
		Message: choice.Message.Content,
		Done:    choice.FinishReason == "stop" || len(choice.Message.ToolCalls) == 0,
		Usage: UsageInfo{
			PromptTokens:     oaiResp.Usage.PromptTokens,
			CompletionTokens: oaiResp.Usage.CompletionTokens,
			TotalTokens:      oaiResp.Usage.TotalTokens,
		},
	}

	if onChunk != nil && result.Message != "" {
		onChunk(result.Message)
	}

	if len(choice.Message.ToolCalls) > 0 {
		result.ToolCalls = make([]ToolCall, 0, len(choice.Message.ToolCalls))
		for _, tc := range choice.Message.ToolCalls {
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:        tc.ID,
				Name:      tc.Function.Name,
				Arguments: json.RawMessage(tc.Function.Arguments),
			})
		}
		result.Done = false
	}

	return result, nil
}

// -----------------------------------------------------------------------------
// Anthropic native Messages API
// -----------------------------------------------------------------------------

type anthropicContentBlock struct {
	Type  string                 `json:"type"`
	Text  string                 `json:"text,omitempty"`
	ID    string                 `json:"id,omitempty"`
	Name  string                 `json:"name,omitempty"`
	Input map[string]interface{} `json:"input,omitempty"`
}

type anthropicMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type anthropicTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	Messages  []anthropicMessage `json:"messages"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
}

type anthropicResponse struct {
	Content    []anthropicContentBlock `json:"content"`
	StopReason string                  `json:"stop_reason"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c *HTTPProviderClient) generateAnthropic(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*LLMResponse, error) {
	reqBody := anthropicRequest{
		Model:     c.cfg.Model,
		MaxTokens: 4096,
		Messages:  make([]anthropicMessage, 0, len(messages)),
	}

	for _, m := range messages {
		role := m.Role
		if role == "tool" {
			// Anthropic formats tool results as user messages with tool_result blocks.
			// Consecutive tool results MUST be grouped into a single user message with
			// multiple tool_result blocks to satisfy Anthropic's role alternation rule.
			block := map[string]interface{}{
				"type":        "tool_result",
				"tool_use_id": m.ToolCallID,
				"content":     m.Content,
			}
			n := len(reqBody.Messages)
			if n > 0 && reqBody.Messages[n-1].Role == "user" {
				if blocks, ok := reqBody.Messages[n-1].Content.([]interface{}); ok {
					reqBody.Messages[n-1].Content = append(blocks, block)
					continue
				}
			}
			reqBody.Messages = append(reqBody.Messages, anthropicMessage{
				Role:    "user",
				Content: []interface{}{block},
			})
			continue
		}

		if len(m.ToolCalls) > 0 {
			var blocks []interface{}
			if m.Content != "" {
				blocks = append(blocks, map[string]string{"type": "text", "text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				var inputMap map[string]interface{}
				_ = json.Unmarshal(tc.Arguments, &inputMap)
				blocks = append(blocks, map[string]interface{}{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  tc.Name,
					"input": inputMap,
				})
			}
			reqBody.Messages = append(reqBody.Messages, anthropicMessage{
				Role:    "assistant",
				Content: blocks,
			})
			continue
		}

		reqBody.Messages = append(reqBody.Messages, anthropicMessage{
			Role:    role,
			Content: m.Content,
		})
	}

	if len(availableTools) > 0 {
		reqBody.Tools = make([]anthropicTool, 0, len(availableTools))
		for _, t := range availableTools {
			var at anthropicTool
			at.Name = t.Name
			at.Description = t.Description
			at.InputSchema = t.Parameters
			reqBody.Tools = append(reqBody.Tools, at)
		}
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to encode anthropic request: %w", err)
	}

	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/v1/messages"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.cfg.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("HTTP request to Anthropic failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Anthropic response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("anthropic returned HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	var antResp anthropicResponse
	if err := json.Unmarshal(respBytes, &antResp); err != nil {
		return nil, fmt.Errorf("failed to parse Anthropic response: %w", err)
	}

	if antResp.Error != nil {
		return nil, fmt.Errorf("anthropic error: %s", antResp.Error.Message)
	}

	result := &LLMResponse{
		Done: antResp.StopReason == "end_turn",
		Usage: UsageInfo{
			PromptTokens:     antResp.Usage.InputTokens,
			CompletionTokens: antResp.Usage.OutputTokens,
			TotalTokens:      antResp.Usage.InputTokens + antResp.Usage.OutputTokens,
		},
	}

	for _, block := range antResp.Content {
		if block.Type == "text" {
			result.Message += block.Text
			if onChunk != nil && block.Text != "" {
				onChunk(block.Text)
			}
		} else if block.Type == "tool_use" {
			argsBytes, _ := json.Marshal(block.Input)
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:        block.ID,
				Name:      block.Name,
				Arguments: argsBytes,
			})
			result.Done = false
		}
	}

	return result, nil
}
