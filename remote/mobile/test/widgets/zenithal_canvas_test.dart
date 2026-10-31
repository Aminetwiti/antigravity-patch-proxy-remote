import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/zenithal_canvas.dart';

void main() {
  group('ZenithalCanvas Widget Tests', () {
    testWidgets('renders child inside ZenithalCanvas in dark mode', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: const Scaffold(
            body: ZenithalCanvas(
              child: Text('Hello Zenithal'),
            ),
          ),
        ),
      );

      expect(find.text('Hello Zenithal'), findsOneWidget);
    });

    testWidgets('renders child inside ZenithalCanvas in light mode', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.light(),
          home: const Scaffold(
            body: ZenithalCanvas(
              child: Text('Hello Light'),
            ),
          ),
        ),
      );

      expect(find.text('Hello Light'), findsOneWidget);
    });
  });
}
