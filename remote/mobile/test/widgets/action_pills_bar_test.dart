import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/action_pills_bar.dart';

void main() {
  testWidgets('ActionPillsBar renders slash actions and triggers callback', (tester) async {
    String? selectedAction;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ActionPillsBar(
            onActionSelected: (cmd) => selectedAction = cmd,
          ),
        ),
      ),
    );

    expect(find.text('/btw'), findsOneWidget);
    expect(find.text('/grill-me'), findsOneWidget);
    expect(find.text('/teamwork-preview'), findsOneWidget);

    await tester.tap(find.text('/btw'));
    await tester.pumpAndSettle();

    expect(selectedAction, equals('/btw'));
  });
}
