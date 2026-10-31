package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

var (
	ErrClientClosed    = errors.New("mcp client is closed")
	ErrRequestTimeout  = errors.New("mcp request timed out")
	ErrNullResponse    = errors.New("mcp server returned empty response")
)

type JSONRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      *int64      `json:"id,omitempty"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

type JSONRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *JSONRPCError) Error() string {
	return fmt.Sprintf("jsonrpc error (%d): %s", e.Code, e.Message)
}

type ToolInfo struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

type ToolCallResult struct {
	Content []ToolContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

type ToolContent struct {
	Type string `json:"type"` // "text", "image", "resource"
	Text string `json:"text,omitempty"`
}

// Client represents a connected MCP client.
type Client interface {
	Initialize(ctx context.Context) error
	ListTools(ctx context.Context) ([]ToolInfo, error)
	CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error)
	Close() error
}

// StdioClient implements Client over standard I/O (exec.Cmd or custom streams).
type StdioClient struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   io.ReadCloser
	stderr   io.ReadCloser

	seq      int64
	mu       sync.Mutex
	pending  map[int64]chan *JSONRPCResponse
	closed   bool
	closeCh  chan struct{}
}

// NewProcessClient spawns a child process and attaches stdio streams.
func NewProcessClient(command string, args []string, env map[string]string, dir string) (*StdioClient, error) {
	cmd := exec.Command(command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if len(env) > 0 {
		cmd.Env = os.Environ()
		for k, v := range env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("failed to open stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("failed to open stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close()
		return nil, fmt.Errorf("failed to start mcp process %q: %w", command, err)
	}

	sc := &StdioClient{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		pending: make(map[int64]chan *JSONRPCResponse),
		closeCh: make(chan struct{}),
	}

	go sc.readLoop()
	go sc.drainStderr()

	return sc, nil
}

// NewStreamClient initializes a StdioClient using existing Read/Write streams (e.g. for testing).
func NewStreamClient(in io.WriteCloser, out io.ReadCloser) *StdioClient {
	sc := &StdioClient{
		stdin:   in,
		stdout:  out,
		pending: make(map[int64]chan *JSONRPCResponse),
		closeCh: make(chan struct{}),
	}
	go sc.readLoop()
	return sc
}

func (c *StdioClient) drainStderr() {
	if c.stderr == nil {
		return
	}
	// Drain stderr using streaming io.Copy into io.Discard to prevent deadlock
	// on lines exceeding bufio scanner limits without accumulating unbounded memory.
	_, _ = io.Copy(io.Discard, c.stderr)
}

func (c *StdioClient) readLoop() {
	scanner := bufio.NewScanner(c.stdout)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 10*1024*1024) // up to 10MB per line

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var resp JSONRPCResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			continue
		}

		if resp.ID != nil {
			c.mu.Lock()
			ch, ok := c.pending[*resp.ID]
			if ok {
				delete(c.pending, *resp.ID)
			}
			c.mu.Unlock()

			if ok {
				ch <- &resp
			}
		}
	}

	// EOF / closed
	c.mu.Lock()
	c.closed = true
	for id, ch := range c.pending {
		delete(c.pending, id)
		close(ch)
	}
	c.mu.Unlock()
}

func (c *StdioClient) sendRequest(ctx context.Context, method string, params interface{}) (*JSONRPCResponse, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, ErrClientClosed
	}

	id := atomic.AddInt64(&c.seq, 1)
	respCh := make(chan *JSONRPCResponse, 1)
	c.pending[id] = respCh
	c.mu.Unlock()

	req := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      &id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, err
	}
	data = append(data, '\n')

	c.mu.Lock()
	_, writeErr := c.stdin.Write(data)
	c.mu.Unlock()

	if writeErr != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to write to mcp stdin: %w", writeErr)
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	case resp, ok := <-respCh:
		if !ok || resp == nil {
			return nil, ErrClientClosed
		}
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp, nil
	}
}

func (c *StdioClient) sendNotification(method string, params interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return ErrClientClosed
	}

	req := JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	}
	data, err := json.Marshal(req)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = c.stdin.Write(data)
	return err
}

func (c *StdioClient) Initialize(ctx context.Context) error {
	params := map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities": map[string]interface{}{
			"tools": map[string]interface{}{},
		},
		"clientInfo": map[string]interface{}{
			"name":    "ag-agentd",
			"version": "1.0.0",
		},
	}

	initCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	_, err := c.sendRequest(initCtx, "initialize", params)
	if err != nil {
		return fmt.Errorf("mcp initialize failed: %w", err)
	}

	_ = c.sendNotification("notifications/initialized", map[string]interface{}{})
	return nil
}

func (c *StdioClient) ListTools(ctx context.Context) ([]ToolInfo, error) {
	listCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	resp, err := c.sendRequest(listCtx, "tools/list", map[string]interface{}{})
	if err != nil {
		return nil, fmt.Errorf("mcp tools/list failed: %w", err)
	}

	var result struct {
		Tools []ToolInfo `json:"tools"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to parse mcp tools result: %w", err)
	}

	return result.Tools, nil
}

func (c *StdioClient) CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	params := map[string]interface{}{
		"name":      name,
		"arguments": args,
	}

	resp, err := c.sendRequest(ctx, "tools/call", params)
	if err != nil {
		return "", err
	}

	var result ToolCallResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return string(resp.Result), nil
	}

	var textParts []string
	for _, c := range result.Content {
		if c.Type == "text" && c.Text != "" {
			textParts = append(textParts, c.Text)
		}
	}

	output := ""
	if len(textParts) == 1 {
		output = textParts[0]
	} else if len(textParts) > 1 {
		output = fmt.Sprintf("%s", textParts)
	} else {
		output = string(resp.Result)
	}

	if result.IsError {
		return output, fmt.Errorf("mcp tool error: %s", output)
	}

	return output, nil
}

func (c *StdioClient) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	c.mu.Unlock()

	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.stdout != nil {
		_ = c.stdout.Close()
	}
	if c.stderr != nil {
		_ = c.stderr.Close()
	}

	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_ = c.cmd.Wait()
	}

	return nil
}
