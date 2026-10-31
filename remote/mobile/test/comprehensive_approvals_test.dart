import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

void main() {
  group('Comprehensive Approval Modules Tests', () {
    testWidgets('File Permission displays 5 scopes and absolute path', (tester) async {
      final req = ToolApprovalRequest.fromJson({
        'callId': 'call-file-123',
        'toolName': 'write_to_file',
        'filePath': 'C:/Users/developer/sensitive/config.json',
        'approvalType': 'file_permission',
        'description': 'Write outside workspace boundary',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ToolApprovalCard(
                request: req,
                onDecision: (_, {scope = ApprovalScope.once, denyReason = ''}) {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Check title and file path
      expect(find.text('Allow file access outside workspace?'), findsOneWidget);
      expect(find.text('C:/Users/developer/sensitive/config.json'), findsOneWidget);

      // Check all 5 options
      expect(find.byKey(const Key('approval-option-1')), findsOneWidget);
      expect(find.byKey(const Key('approval-option-2')), findsOneWidget);
      expect(find.byKey(const Key('approval-option-3')), findsOneWidget);
      expect(find.byKey(const Key('approval-option-4')), findsOneWidget);
      expect(find.byKey(const Key('approval-option-5')), findsOneWidget);
    });

    testWidgets('Destructive Action requires confirmation checkbox before allowing', (tester) async {
      ToolDecision? decision;
      final req = ToolApprovalRequest.fromJson({
        'callId': 'call-rm-123',
        'toolName': 'run_command',
        'command': 'rm -rf ./build/data',
        'isDestructive': true,
        'description': 'Delete build data recursively',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ToolApprovalCard(
                request: req,
                onDecision: (d, {scope = ApprovalScope.once, denyReason = ''}) {
                  decision = d;
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Action Destructive / Risque Élevé'), findsOneWidget);
      expect(find.textContaining('Attention : Cette opération risque de supprimer'), findsOneWidget);
      expect(find.byKey(const Key('destructive-confirm-checkbox')), findsOneWidget);

      // Verify allow button is disabled until checkbox checked
      final allowBtnFinder = find.byKey(const Key('allow-btn'));
      expect(tester.widget<ElevatedButton>(allowBtnFinder).onPressed, isNull);

      // Check checkbox
      await tester.tap(find.byKey(const Key('destructive-confirm-checkbox')));
      await tester.pumpAndSettle();

      // Allow button should now be enabled
      expect(tester.widget<ElevatedButton>(allowBtnFinder).onPressed, isNotNull);
      await tester.tap(allowBtnFinder);
      await tester.pumpAndSettle();

      expect(decision, ToolDecision.allow);
    });

    testWidgets('MCP tool displays inspector and toggles arguments', (tester) async {
      final req = ToolApprovalRequest.fromJson({
        'callId': 'call-mcp-999',
        'toolName': 'create_server',
        'mcpServer': 'coolify',
        'mcpArgs': '{"name": "production-node", "ip": "1.2.3.4"}',
        'approvalType': 'mcp_tool',
        'description': 'Create new server in Coolify',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ToolApprovalCard(
                request: req,
                onDecision: (d, {scope = ApprovalScope.once, denyReason = ''}) {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Allow MCP tool execution (coolify)?'), findsOneWidget);
      expect(find.text('coolify -> create_server'), findsOneWidget);
      expect(find.byKey(const Key('toggle-mcp-args-btn')), findsOneWidget);

      // Toggle arguments
      await tester.tap(find.byKey(const Key('toggle-mcp-args-btn')));
      await tester.pumpAndSettle();

      expect(find.text('{"name": "production-node", "ip": "1.2.3.4"}'), findsOneWidget);
    });

    testWidgets('Stdin tool displays quick action chips', (tester) async {
      String? submittedReason;
      final req = ToolApprovalRequest.fromJson({
        'callId': 'call-stdin-1',
        'toolName': 'send_command_input',
        'command': 'Do you want to continue? [y/N]',
        'approvalType': 'send_command_input',
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ToolApprovalCard(
                request: req,
                onDecision: (d, {scope = ApprovalScope.once, denyReason = ''}) {
                  submittedReason = denyReason;
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Send terminal input (stdin)'), findsOneWidget);
      expect(find.text('y (Yes)'), findsOneWidget);
      expect(find.text('n (No)'), findsOneWidget);
      expect(find.text('↵ Enter'), findsOneWidget);

      // Tap 'y (Yes)' chip
      await tester.tap(find.text('y (Yes)'));
      await tester.pumpAndSettle();

      expect(submittedReason, 'y');
    });
  });
}
