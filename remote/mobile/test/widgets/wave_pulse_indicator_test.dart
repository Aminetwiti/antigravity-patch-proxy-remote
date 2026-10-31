import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/wave_pulse_indicator.dart';

void main() {
  group('WavePulseIndicator Widget Tests', () {
    testWidgets('renders WavePulseIndicator with default barCount', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: WavePulseIndicator(
              width: 20,
              height: 16,
              color: Colors.blue,
            ),
          ),
        ),
      );

      // Verify that WavePulseIndicator is mounted
      expect(find.byType(WavePulseIndicator), findsOneWidget);

      // Verify 3 wave bars are rendered (default barCount = 3)
      final containers = find.descendant(
        of: find.byType(WavePulseIndicator),
        matching: find.byType(Container),
      );
      expect(containers, findsNWidgets(3));

      // Advance animation
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.hasRunningAnimations, isTrue);

      await tester.pump(const Duration(milliseconds: 900));
      expect(find.byType(WavePulseIndicator), findsOneWidget);
    });

    testWidgets('renders WavePulseIndicator with custom barCount', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: WavePulseIndicator(
              width: 30,
              height: 20,
              barCount: 4,
            ),
          ),
        ),
      );

      final containers = find.descendant(
        of: find.byType(WavePulseIndicator),
        matching: find.byType(Container),
      );
      expect(containers, findsNWidgets(4));
    });
  });
}
