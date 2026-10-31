import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

void main() {
  group('URL Approval & 5-Scope Validation Tests', () {
    testWidgets('Renders URL Approval with domain and 5 options', (tester) async {
      ToolDecision? submittedDecision;
      ApprovalScope? submittedScope;
      String? submittedDenyReason;

      final request = ToolApprovalRequest(
        callId: 'call_url_1',
        toolName: 'read_url_content',
        command: 'https://antigravity.google/blog/introducing-google-antigravity-2',
        description: 'Read URL content',
        cascadeId: 'casc_123',
        trajectoryId: 'traj_456',
        stepIndex: 2,
        approvalType: 'read_url_content',
        url: 'https://antigravity.google/blog/introducing-google-antigravity-2',
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: Scaffold(
            body: ToolApprovalCard(
              request: request,
              onDecision: (decision, {scope = ApprovalScope.once, denyReason = ''}) {
                submittedDecision = decision;
                submittedScope = scope;
                submittedDenyReason = denyReason;
              },
            ),
          ),
        ),
      );

      // Verify Title & Target
      expect(find.text('Allow reading this URL?'), findsOneWidget);
      expect(find.text('antigravity.google'), findsOneWidget);

      // Verify all 5 options are present
      expect(find.text('Yes, allow this time'), findsOneWidget);
      expect(find.text('Yes, and always allow in this conversation'), findsOneWidget);
      expect(find.text('Yes, and always allow in this project'), findsOneWidget);
      expect(find.text('Yes, and always allow'), findsOneWidget);
      expect(find.text('No (tell the agent what to do instead)'), findsOneWidget);

      // Verify default submit submits scope once
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pumpAndSettle();
      expect(submittedDecision, ToolDecision.allow);
      expect(submittedScope, ApprovalScope.once);

      // Select Option 3 (project)
      await tester.tap(find.byKey(const Key('approval-option-3')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pumpAndSettle();
      expect(submittedDecision, ToolDecision.allow);
      expect(submittedScope, ApprovalScope.project);

      // Select Option 4 (global)
      await tester.tap(find.byKey(const Key('approval-option-4')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pumpAndSettle();
      expect(submittedDecision, ToolDecision.allow);
      expect(submittedScope, ApprovalScope.global);

      // Select Option 5 (deny with feedback)
      await tester.tap(find.byKey(const Key('approval-option-5')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('deny-reason-field')), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('deny-reason-field')),
        'Do not read external websites',
      );
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pumpAndSettle();
      expect(submittedDecision, ToolDecision.deny);
      expect(submittedDenyReason, 'Do not read external websites');
    });

    testWidgets('Skip button sends deny decision immediately', (tester) async {
      ToolDecision? submittedDecision;

      final request = ToolApprovalRequest(
        callId: 'call_url_2',
        toolName: 'read_url_content',
        command: 'https://example.com',
        description: 'Read URL',
        approvalType: 'read_url_content',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ToolApprovalCard(
              request: request,
              onDecision: (decision, {scope = ApprovalScope.once, denyReason = ''}) {
                submittedDecision = decision;
              },
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('deny-btn')));
      await tester.pumpAndSettle();
      expect(submittedDecision, ToolDecision.deny);
    });
  });
}
