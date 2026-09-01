import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

void main() {
  group('Advanced Scenarios Phase 1 Tests', () {
    testWidgets('ToolApprovalCard debounces rapid taps (Scénario 6)', (WidgetTester tester) async {
      int tapCount = 0;
      final request = ToolApprovalRequest(
        callId: 'test_call',
        toolName: 'run_command',
        command: 'echo hello',
        description: 'test',
        cascadeId: 'test_cascade',
        trajectoryId: 'test_trajectory',
        stepIndex: 1,
        approvalType: 'approval',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ToolApprovalCard(
              request: request,
              onDecision: (decision,
                  {ApprovalScope scope = ApprovalScope.once,
                  String denyReason = ''}) async {
                tapCount++;
                // Simulate a network delay of 500ms
                await Future.delayed(const Duration(milliseconds: 500));
              },
            ),
          ),
        ),
      );

      // Find the Approve button
      final approveButton = find.byKey(const Key('allow-btn'));
      expect(approveButton, findsOneWidget);

      // Tap 3 times rapidly
      await tester.tap(approveButton);
      await tester.tap(approveButton);
      await tester.tap(approveButton);

      // Wait a bit but not full 500ms
      await tester.pump(const Duration(milliseconds: 100));

      // The button should be in submitting state (CircularProgressIndicator visible) and tapCount should be exactly 1
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tapCount, 1);

      // Wait for the simulated network delay to finish
      await tester.pumpAndSettle(const Duration(milliseconds: 500));

      // Button should be active again
      expect(approveButton, findsOneWidget);
      expect(tapCount, 1, reason: 'Debounce failed, tapped multiple times');
    });

    testWidgets('ToolApprovalCard isExpired disables actions (Phase 6)', (WidgetTester tester) async {
      int calls = 0;
      final request = ToolApprovalRequest(
        callId: 'expired_call',
        toolName: 'run_command',
        command: 'rm -rf /tmp/x',
        description: 'test',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ToolApprovalCard(
              request: request,
              isExpired: true,
              onDecision: (decision,
                  {ApprovalScope scope = ApprovalScope.once,
                  String denyReason = ''}) async {
                calls++;
              },
            ),
          ),
        ),
      );

      // Le bandeau d'auto-refus est visible.
      expect(find.textContaining('Approbation expirée'), findsOneWidget);

      // Les boutons sont désactivés → aucun appel de décision possible.
      final allowButton = tester.widget<ElevatedButton>(
        find.byKey(const Key('allow-btn')),
      );
      expect(allowButton.onPressed, isNull);

      await tester.tap(find.byKey(const Key('deny-btn')), warnIfMissed: false);
      await tester.tap(find.byKey(const Key('allow-btn')), warnIfMissed: false);
      await tester.pump();
      expect(calls, 0, reason: 'Expired card must not submit decisions');
    });
  });
}
