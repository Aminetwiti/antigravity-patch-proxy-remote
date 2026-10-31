import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/status_dot_badge.dart';

void main() {
  group('StatusDotBadge Widget Tests', () {
    testWidgets('renders status label and dot with given color', (tester) async {
      bool tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: StatusDotBadge(
                label: 'Connected',
                color: const Color(0xFF22C55E),
                onTap: () => tapped = true,
              ),
            ),
          ),
        ),
      );

      expect(find.text('CONNECTED'), findsOneWidget);

      await tester.tap(find.text('CONNECTED'));
      expect(tapped, isTrue);
    });
  });
}
