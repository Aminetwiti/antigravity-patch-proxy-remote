import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/mcp/models/mcp_server_info.dart';
import 'package:mobile/features/mcp/mcp_explorer_screen.dart';

void main() {
  testWidgets('McpExplorerScreen displays servers and tools count', (tester) async {
    final servers = [
      McpServerInfo(
        name: 'coolify',
        status: 'ready',
        toolCount: 14,
        tools: ['list_servers', 'deploy_application', 'get_logs'],
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: McpExplorerScreen(servers: servers),
      ),
    );

    expect(find.text('MCP Servers (1)'), findsOneWidget);
    expect(find.text('coolify'), findsOneWidget);
    expect(find.text('14 tools'), findsOneWidget);
  });

  testWidgets('McpExplorerScreen displays empty state', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: McpExplorerScreen(servers: []),
      ),
    );

    expect(find.text('MCP Servers (0)'), findsOneWidget);
    expect(find.text('Aucun serveur MCP configuré'), findsOneWidget);
  });

  test('McpServerInfo fromJson handles missing tools', () {
    final json = {'name': 'test-server', 'status': 'ready'};
    final server = McpServerInfo.fromJson(json);
    expect(server.name, 'test-server');
    expect(server.toolCount, 0);
    expect(server.tools, isEmpty);
  });
}
