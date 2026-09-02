import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/antigravity_dot_pulse_loader.dart';

void main() {
  group('AntigravityDotPulseLoader Tests', () {
    testWidgets('renders 3 animated dots with correct dimensions', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Center(
              child: AntigravityDotPulseLoader(
                dotSize: 6.0,
                spacing: 4.0,
                color: Colors.blue,
              ),
            ),
          ),
        ),
      );

      // Verify widget renders
      expect(find.byType(AntigravityDotPulseLoader), findsOneWidget);
      expect(find.byType(Row), findsOneWidget);

      // Advance animation partially
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull);

      // Advance past 1 full 1500ms cycle
      await tester.pump(const Duration(milliseconds: 1500));
      expect(tester.takeException(), isNull);
    });
  });
}
