import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/glass_container.dart';

void main() {
  group('GlassContainer Widget Tests', () {
    testWidgets('renders child content with backdrop blur and glass border', (tester) async {
      bool tapped = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: Scaffold(
            body: Center(
              child: GlassContainer(
                onTap: () => tapped = true,
                child: const Text('Antigravity Glass Card'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Antigravity Glass Card'), findsOneWidget);
      expect(find.byType(BackdropFilter), findsOneWidget);
      expect(find.byType(ClipRRect), findsOneWidget);

      await tester.tap(find.text('Antigravity Glass Card'));
      expect(tapped, isTrue);
    });

    testWidgets('AppShadows and AppGradients brand tokens are defined and valid', (tester) async {
      expect(AppShadows.glass, isNotEmpty);
      expect(AppShadows.glowBlue, isNotEmpty);
      expect(AppGradients.primaryLinear.colors.length, equals(2));
      expect(AppGradients.accentLinear.colors.length, equals(2));
      expect(AppColors.glassBg, equals(const Color(0xD918181B)));
      expect(AppColors.okBg, equals(const Color(0x1F22C55E)));
    });
  });
}
