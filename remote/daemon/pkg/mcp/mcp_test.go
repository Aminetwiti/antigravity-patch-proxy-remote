package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

// mockMCPServer creates an in-memory stdio mock MCP server responding to JSON-RPC 2.0
func createMockMCPStreams(t *testing.T) (io.WriteCloser, io.ReadCloser) {
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()

	go func() {
		scanner := bufio.NewScanner(inReader)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}

			var req JSONRPCRequest
			if err := json.Unmarshal(line, &req); err != nil {
				continue
			}

			var resp JSONRPCResponse
			resp.JSONRPC = "2.0"
			resp.ID = req.ID

			switch req.Method {
			case "initialize":
				res := map[string]interface{}{
					"protocolVersion": "2024-11-05",
					"capabilities": map[string]interface{}{
						"tools": map[string]interface{}{},
					},
					"serverInfo": map[string]interface{}{
						"name":    "mock-mcp-server",
						"version": "1.0.0",
					},
				}
				data, _ := json.Marshal(res)
				resp.Result = data

			case "tools/list":
				res := map[string]interface{}{
					"tools": []map[string]interface{}{
						{
							"name":        "list_containers",
							"description": "List all active docker containers",
							"inputSchema": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"all": map[string]interface{}{"type": "boolean"},
								},
							},
						},
						{
							"name":        "delete_database",
							"description": "Permanently delete database",
							"inputSchema": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"id": map[string]interface{}{"type": "string"},
								},
							},
						},
					},
				}
				data, _ := json.Marshal(res)
				resp.Result = data

			case "tools/call":
				var params struct {
					Name      string                 `json:"name"`
					Arguments map[string]interface{} `json:"arguments"`
				}
				pData, _ := json.Marshal(req.Params)
				_ = json.Unmarshal(pData, &params)

				if params.Name == "delete_database" {
					res := map[string]interface{}{
						"content": []map[string]interface{}{
							{"type": "text", "text": fmt.Sprintf("database %v deleted successfully", params.Arguments["id"])},
						},
					}
					data, _ := json.Marshal(res)
					resp.Result = data
				} else {
					res := map[string]interface{}{
						"content": []map[string]interface{}{
							{"type": "text", "text": "container-1 (running), container-2 (stopped)"},
						},
					}
					data, _ := json.Marshal(res)
					resp.Result = data
				}

			default:
				// Notification or unknown
				continue
			}

			outData, _ := json.Marshal(resp)
			outData = append(outData, '\n')
			_, _ = outWriter.Write(outData)
		}
	}()

	return inWriter, outReader
}

type mockClientWrapper struct {
	*StdioClient
}

func TestStdioClient_Lifecycle(t *testing.T) {
	in, out := createMockMCPStreams(t)
	client := NewStreamClient(in, out)
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Initialize
	if err := client.Initialize(ctx); err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}

	// 2. List tools
	toolsList, err := client.ListTools(ctx)
	if err != nil {
		t.Fatalf("ListTools failed: %v", err)
	}
	if len(toolsList) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(toolsList))
	}
	if toolsList[0].Name != "list_containers" {
		t.Errorf("expected first tool list_containers, got %s", toolsList[0].Name)
	}

	// 3. Call tool
	outStr, err := client.CallTool(ctx, "list_containers", map[string]interface{}{"all": true})
	if err != nil {
		t.Fatalf("CallTool failed: %v", err)
	}
	if !strings.Contains(outStr, "container-1") {
		t.Errorf("unexpected tool output: %s", outStr)
	}
}

func TestManager_RegistryIntegration(t *testing.T) {
	tmpDir := t.TempDir()
	wsMgr := workspace.NewManager()
	_, _ = wsMgr.RegisterWorkspace("ws1", "WS1", tmpDir)

	toolRegistry := tools.NewRegistry(wsMgr, false)
	mgr := NewManager(toolRegistry)
	defer func() { _ = mgr.Close() }()

	// Hook client factory to use in-memory stream mock
	mgr.SetClientFactory(func(cfg ServerConfig) (Client, error) {
		in, out := createMockMCPStreams(t)
		return NewStreamClient(in, out), nil
	})

	ctx := context.Background()
	cfg := ServerConfig{
		Name:        "docker_mcp",
		Description: "Docker MCP Server",
	}

	// 1. Register server
	info, err := mgr.RegisterServer(ctx, cfg)
	if err != nil {
		t.Fatalf("RegisterServer failed: %v", err)
	}
	if info.ToolCount != 2 {
		t.Errorf("expected 2 tools, got %d", info.ToolCount)
	}

	// 2. Verify tool discovery in central tool registry
	tool, ok := toolRegistry.GetTool("mcp__docker_mcp__list_containers")
	if !ok {
		t.Fatalf("tool mcp__docker_mcp__list_containers not found in registry")
	}
	if !strings.Contains(tool.Description(), "[MCP docker_mcp]") {
		t.Errorf("expected tool description prefix, got %s", tool.Description())
	}

	// Simple alias should also be registered
	aliasTool, ok := toolRegistry.GetTool("list_containers")
	if !ok {
		t.Fatalf("alias list_containers not found in registry")
	}

	// 3. Check destructive tool requires approval
	delTool, _ := toolRegistry.GetTool("mcp__docker_mcp__delete_database")
	if !delTool.RequiresApproval(nil) {
		t.Errorf("expected delete_database to require approval")
	}
	if aliasTool.RequiresApproval(nil) {
		t.Errorf("expected list_containers to not require approval")
	}

	// 4. Execute tool through tool registry
	res, err := toolRegistry.Execute(ctx, "sess-1", "ws1", "mcp__docker_mcp__delete_database", json.RawMessage(`{"id":"prod-db"}`), nil)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if !res.Success || !strings.Contains(res.Output, "prod-db deleted") {
		t.Errorf("unexpected output: %+v", res)
	}

	// 5. Unregister server
	if err := mgr.UnregisterServer("docker_mcp"); err != nil {
		t.Fatalf("UnregisterServer failed: %v", err)
	}

	// Verify tools removed from registry
	if _, ok := toolRegistry.GetTool("mcp__docker_mcp__list_containers"); ok {
		t.Errorf("expected tool to be unregistered from registry")
	}
	if _, ok := toolRegistry.GetTool("list_containers"); ok {
		t.Errorf("expected alias to be unregistered from registry")
	}
}

func TestManager_LoadConfigFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "mcp_config.json")

	cfgJSON := `{
		"mcpServers": {
			"test_server": {
				"command": "node",
				"args": ["test.js"],
				"description": "Test server from config"
			}
		}
	}`
	if err := os.WriteFile(configPath, []byte(cfgJSON), 0644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	mgr := NewManager(nil)
	defer func() { _ = mgr.Close() }()

	var mu sync.Mutex
	registeredNames := make([]string, 0)

	mgr.SetClientFactory(func(cfg ServerConfig) (Client, error) {
		mu.Lock()
		registeredNames = append(registeredNames, cfg.Name)
		mu.Unlock()
		in, out := createMockMCPStreams(t)
		return NewStreamClient(in, out), nil
	})

	if err := mgr.LoadConfigFile(configPath); err != nil {
		t.Fatalf("LoadConfigFile failed: %v", err)
	}

	servers := mgr.ListServers()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server, got %d", len(servers))
	}
	if servers[0].Name != "test_server" {
		t.Errorf("expected server name test_server, got %s", servers[0].Name)
	}
}
