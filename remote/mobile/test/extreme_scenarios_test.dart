import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

void main() {
  group('Extreme Scenarios Tests (Phase 4)', () {
    testWidgets('Scenario 6: Silent Override Race Condition (Widget Recycling)', (tester) async {
      // 1. Initial request (Safe)
      final req1 = ToolApprovalRequest(
        callId: 'call-1',
        toolName: 'view_file',
        command: 'view_file foo.txt',
        description: 'Viewing a file',
        cascadeId: 'c1',
      );

      final ValueNotifier<ToolApprovalRequest> requestNotifier = ValueNotifier(req1);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ValueListenableBuilder<ToolApprovalRequest>(
              valueListenable: requestNotifier,
              builder: (context, request, _) {
                // By keeping the SAME Key or no key, Flutter reuses the State object.
                return ToolApprovalCard(
                  request: request,
                  onDecision: (decision,
                      {scope = ApprovalScope.once, String denyReason = ''}) {},
                );
              },
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // 2. User selects 'Always allow in conversation' (option 2) or toggles switch
      final opt2Finder = find.byKey(const Key('approval-option-2'));
      if (opt2Finder.evaluate().isNotEmpty) {
        await tester.tap(opt2Finder);
        await tester.pumpAndSettle();
      } else {
        final switchFinder = find.byType(Switch);
        if (switchFinder.evaluate().isNotEmpty) {
          await tester.tap(switchFinder);
          await tester.pumpAndSettle();
        }
      }

      // 3. User taps "Submit" - simulate a race condition where the request changes immediately
      final allowBtn = find.byKey(const Key('allow-btn'));
      await tester.tap(allowBtn);
      await tester.pump(); // We are now _isSubmitting = true for call-1

      // 4. BOOM: A new dangerous request replaces the old one BEFORE the widget unmounts (Widget Recycling)
      final req2 = ToolApprovalRequest(
        callId: 'call-2',
        toolName: 'run_command',
        command: 'rm -rf /',
        description: 'Destroying system',
        cascadeId: 'c1',
      );
      requestNotifier.value = req2;
      
      await tester.pumpAndSettle();

      // 5. Check if the widget correctly reset its internal state (option 1 default / switch off)!
      final switchFinder = find.byType(Switch);
      if (switchFinder.evaluate().isNotEmpty) {
        final newSwitchWidget = tester.widget<Switch>(switchFinder);
        expect(newSwitchWidget.value, false, reason: 'Switch MUST be reset to OFF for a new callId to prevent silent override!');
      }

      // Destructive command safety: confirmation checkbox is shown and unchecked by default
      final checkboxFinder = find.byType(Checkbox);
      if (checkboxFinder.evaluate().isNotEmpty) {
        expect(tester.widget<Checkbox>(checkboxFinder).value, false, reason: 'Destructive confirmation must be unchecked');
        await tester.tap(checkboxFinder);
        await tester.pumpAndSettle();
      }

      // Check if buttons are enabled (not stuck in _isSubmitting)
      final allowButton = tester.widget<ElevatedButton>(find.byKey(const Key('allow-btn')));
      expect(allowButton.onPressed, isNotNull, reason: 'Submit button must be clickable for the new request once confirmed');
    });
  });
}
