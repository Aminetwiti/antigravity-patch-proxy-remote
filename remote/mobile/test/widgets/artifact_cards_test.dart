import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/artifact_cards.dart';

void main() {
  group('ImplementationPlanCard', () {
    testWidgets('renders title and Proceed button with high contrast in light mode', (tester) async {
      bool proceedCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.light(),
          home: Scaffold(
            body: ImplementationPlanCard(
              title: 'Implementation Plan',
              summary: 'Plan summary text',
              onProceed: () => proceedCalled = true,
              onViewPlan: () {},
            ),
          ),
        ),
      );

      expect(find.text('Implementation Plan'), findsOneWidget);
      expect(find.text('Proceed'), findsOneWidget);
      expect(find.byIcon(Icons.play_arrow_rounded), findsOneWidget);

      await tester.tap(find.text('Proceed'));
      await tester.pumpAndSettle();

      expect(proceedCalled, isTrue);
    });

    testWidgets('renders title and Proceed button in dark mode', (tester) async {
      bool proceedCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: Scaffold(
            body: ImplementationPlanCard(
              title: 'Implementation Plan',
              summary: 'Dark Plan summary',
              onProceed: () => proceedCalled = true,
              onViewPlan: () {},
            ),
          ),
        ),
      );

      expect(find.text('Proceed'), findsOneWidget);

      await tester.tap(find.text('Proceed'));
      await tester.pumpAndSettle();

      expect(proceedCalled, isTrue);
    });
  });
}
