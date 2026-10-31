import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/antigravity_logo.dart';
import 'package:mobile/theme/app_theme.dart';

void main() {
  group('AntigravityLogo Suite Tests', () {
    testWidgets('renders basic AntigravityLogo with and without glow', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: const Scaffold(
            body: Column(
              children: [
                AntigravityLogo(size: 48, showGlow: true),
                AntigravityLogo(size: 32, showGlow: false),
              ],
            ),
          ),
        ),
      );

      expect(find.byType(AntigravityLogo), findsNWidgets(2));
    });

    testWidgets('renders AntigravityLogo.wordmark with title and subtitle', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            body: AntigravityLogo.wordmark(
              title: 'Antigravity',
              subtitle: 'REMOTE',
            ),
          ),
        ),
      );

      expect(find.text('Antigravity'), findsOneWidget);
      expect(find.text('REMOTE'), findsOneWidget);
    });

    testWidgets('renders AntigravityLogo.avatar and AntigravityLogo.banner', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            body: Column(
              children: [
                AntigravityLogo.avatar(radius: 20),
                AntigravityLogo.banner(height: 100),
              ],
            ),
          ),
        ),
      );

      expect(find.byType(AntigravityLogo), findsWidgets);
    });
  });
}
