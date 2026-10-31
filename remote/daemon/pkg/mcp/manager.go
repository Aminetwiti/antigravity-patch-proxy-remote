package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/antigravity/remote-daemon/pkg/tools"
)

var (
	ErrServerAlreadyExists = errors.New("mcp server already registered")
	ErrServerNotFound      = errors.New("mcp server not found")
)

type ServerConfig struct {
	Name        string            `json:"name"`
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env,omitempty"`
	Dir         string            `json:"dir,omitempty"`
	Description string            `json:"description,omitempty"`
}

type ConfigFile struct {
	MCPServers map[string]ConfigFileEntry `json:"mcpServers"`
}

type ConfigFileEntry struct {
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env,omitempty"`
	Dir         string            `json:"dir,omitempty"`
	Description string            `json:"description,omitempty"`
}

type ServerInfo struct {
	Name        string     `json:"name"`
	Status      string     `json:"status"` // "ready", "running", "stopped", "error"
	ToolCount   int        `json:"toolCount"`
	Tools       []string   `json:"tools"`
	Description string     `json:"description,omitempty"`
	SidecarID   string     `json:"sidecarId,omitempty"`
	Error       string     `json:"error,omitempty"`
	ToolDefs    []ToolInfo `json:"toolDefs,omitempty"`
}

type serverEntry struct {
	config  ServerConfig
	client  Client
	info    ServerInfo
	aliases []string
}

// Manager manages MCP server lifecycles and tool registration.
type Manager struct {
	mu           sync.RWMutex
	servers      map[string]*serverEntry
	toolRegistry *tools.Registry

	// Optional factory hook for testing
	clientFactory func(cfg ServerConfig) (Client, error)
}

func NewManager(registry *tools.Registry) *Manager {
	return &Manager{
		servers:      make(map[string]*serverEntry),
		toolRegistry: registry,
	}
}

// SetClientFactory overrides process spawning (used in unit tests).
func (m *Manager) SetClientFactory(fn func(cfg ServerConfig) (Client, error)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clientFactory = fn
}

func (m *Manager) RegisterServer(ctx context.Context, cfg ServerConfig) (*ServerInfo, error) {
	if cfg.Name == "" {
		return nil, errors.New("mcp server name cannot be empty")
	}

	m.mu.Lock()
	if _, exists := m.servers[cfg.Name]; exists {
		m.mu.Unlock()
		return nil, fmt.Errorf("%w: %s", ErrServerAlreadyExists, cfg.Name)
	}
	m.mu.Unlock()

	var client Client
	var err error
	if m.clientFactory != nil {
		client, err = m.clientFactory(cfg)
	} else {
		client, err = NewProcessClient(cfg.Command, cfg.Args, cfg.Env, cfg.Dir)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to start mcp server %s: %w", cfg.Name, err)
	}

	// Handshake
	if err := client.Initialize(ctx); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("failed to initialize mcp server %s: %w", cfg.Name, err)
	}

	// Discover tools
	toolList, err := client.ListTools(ctx)
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("failed to list tools for mcp server %s: %w", cfg.Name, err)
	}

	toolNames := make([]string, 0, len(toolList))
	var registeredAliases []string

	for _, t := range toolList {
		fullName := fmt.Sprintf("mcp__%s__%s", cfg.Name, t.Name)
		toolNames = append(toolNames, t.Name)

		adapter := &mcpToolAdapter{
			fullName:     fullName,
			originalName: t.Name,
			serverName:   cfg.Name,
			desc:         t.Description,
			schema:       t.InputSchema,
			client:       client,
		}

		if m.toolRegistry != nil {
			m.toolRegistry.RegisterTool(adapter)
			registeredAliases = append(registeredAliases, fullName)

			// Try simple alias if not in use
			if _, inUse := m.toolRegistry.GetTool(t.Name); !inUse {
				aliasAdapter := &mcpToolAdapter{
					fullName:     t.Name,
					originalName: t.Name,
					serverName:   cfg.Name,
					desc:         t.Description,
					schema:       t.InputSchema,
					client:       client,
				}
				m.toolRegistry.RegisterTool(aliasAdapter)
				registeredAliases = append(registeredAliases, t.Name)
			}
		}
	}

	info := ServerInfo{
		Name:        cfg.Name,
		Status:      "ready",
		ToolCount:   len(toolList),
		Tools:       toolNames,
		Description: cfg.Description,
		ToolDefs:    toolList,
	}

	entry := &serverEntry{
		config:  cfg,
		client:  client,
		info:    info,
		aliases: registeredAliases,
	}

	m.mu.Lock()
	m.servers[cfg.Name] = entry
	m.mu.Unlock()

	return &info, nil
}

func (m *Manager) UnregisterServer(name string) error {
	m.mu.Lock()
	entry, exists := m.servers[name]
	if !exists {
		m.mu.Unlock()
		return ErrServerNotFound
	}
	delete(m.servers, name)
	m.mu.Unlock()

	// Clean up tools from central registry
	if m.toolRegistry != nil {
		for _, toolName := range entry.aliases {
			m.toolRegistry.UnregisterTool(toolName)
		}
	}

	// Terminate client
	return entry.client.Close()
}

func (m *Manager) ListServers() []ServerInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make([]ServerInfo, 0, len(m.servers))
	for _, entry := range m.servers {
		res = append(res, entry.info)
	}
	return res
}

func (m *Manager) GetServer(name string) (*ServerInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entry, ok := m.servers[name]
	if !ok {
		return nil, false
	}
	cp := entry.info
	return &cp, true
}

func (m *Manager) CallServerTool(ctx context.Context, serverName, toolName string, args map[string]interface{}) (string, error) {
	m.mu.RLock()
	entry, ok := m.servers[serverName]
	m.mu.RUnlock()

	if !ok {
		return "", ErrServerNotFound
	}

	return entry.client.CallTool(ctx, toolName, args)
}

func (m *Manager) LoadConfigFile(filePath string) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var cf ConfigFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return fmt.Errorf("invalid mcp config file: %w", err)
	}

	ctx := context.Background()
	for name, entry := range cf.MCPServers {
		cfg := ServerConfig{
			Name:        name,
			Command:     entry.Command,
			Args:        entry.Args,
			Env:         entry.Env,
			Dir:         entry.Dir,
			Description: entry.Description,
		}
		_, _ = m.RegisterServer(ctx, cfg)
	}

	return nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, entry := range m.servers {
		_ = entry.client.Close()
		if m.toolRegistry != nil {
			for _, toolName := range entry.aliases {
				m.toolRegistry.UnregisterTool(toolName)
			}
		}
		delete(m.servers, name)
	}
	return nil
}

// -----------------------------------------------------------------------------
// MCP Tool Adapter for tools.Registry
// -----------------------------------------------------------------------------

type mcpToolAdapter struct {
	fullName     string
	originalName string
	serverName   string
	desc         string
	schema       map[string]interface{}
	client       Client
}

func (a *mcpToolAdapter) Name() string {
	return a.fullName
}

func (a *mcpToolAdapter) Description() string {
	if a.desc != "" {
		return fmt.Sprintf("[MCP %s] %s", a.serverName, a.desc)
	}
	return fmt.Sprintf("[MCP %s] Tool %s", a.serverName, a.originalName)
}

func (a *mcpToolAdapter) ParametersSchema() map[string]interface{} {
	if a.schema != nil {
		return a.schema
	}
	return map[string]interface{}{
		"type":       "object",
		"properties": map[string]interface{}{},
	}
}

func (a *mcpToolAdapter) RequiresApproval(params json.RawMessage) bool {
	// Destructive MCP actions require user confirmation
	lower := strings.ToLower(a.originalName)
	destructivePrefixes := []string{"delete", "remove", "drop", "destroy", "kill", "stop", "deploy", "publish"}
	for _, p := range destructivePrefixes {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func (a *mcpToolAdapter) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*tools.ToolResult, error) {
	var args map[string]interface{}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &args)
	}
	if args == nil {
		args = make(map[string]interface{})
	}

	output, err := a.client.CallTool(ctx, a.originalName, args)
	if err != nil {
		return &tools.ToolResult{
			Success:  false,
			Error:    err.Error(),
			ExitCode: 1,
		}, nil
	}

	if onChunk != nil {
		onChunk([]byte(output))
	}

	return &tools.ToolResult{
		Success:  true,
		Output:   output,
		ExitCode: 0,
	}, nil
}
