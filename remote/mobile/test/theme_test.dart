import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/theme/app_theme.dart';

void main() {
  group('Antigravity 2.0 Master Design Tokens Tests', () {
    test('AppColors matches Antigravity 2.0 specification exactly', () {
      expect(AppColors.surfaceBase, const Color(0xFF202020));
      expect(AppColors.surfaceRaised, const Color(0xFF242424));
      expect(AppColors.surfaceInput, const Color(0xFF282828));
      expect(AppColors.surfaceOverlay, const Color(0xFF2B2B2B));
      expect(AppColors.surfaceHover, const Color(0xFF2F2F2F));
      expect(AppColors.surfacePressed, const Color(0xFF353535));
      expect(AppColors.surfaceDisabled, const Color(0xFF222222));

      expect(AppColors.borderSubtle, const Color(0xFF303030));
      expect(AppColors.borderDefault, const Color(0xFF3A3A3A));
      expect(AppColors.borderStrong, const Color(0xFF4A4A4A));
      expect(AppColors.borderFocus, const Color(0xFF8AB4F8));

      expect(AppColors.inkPrimary, const Color(0xFFF1F1F1));
      expect(AppColors.inkSecondary, const Color(0xFFB8B8B8));
      expect(AppColors.inkTertiary, const Color(0xFF969696));
      expect(AppColors.inkMuted, const Color(0xFF858585));
      expect(AppColors.inkDisabled, const Color(0xFF606060));

      expect(AppColors.accentBlue, const Color(0xFF8AB4F8));
      expect(AppColors.accentBlueHover, const Color(0xFFAECBFA));
      expect(AppColors.accentBluePressed, const Color(0xFF669DF6));
      expect(AppColors.accentSubtle, const Color(0xFF263447));

      expect(AppColors.positive, const Color(0xFF81C995));
      expect(AppColors.successSubtle, const Color(0xFF20352A));
      expect(AppColors.warning, const Color(0xFFFDD663));
      expect(AppColors.warningSubtle, const Color(0xFF3A321A));
      expect(AppColors.danger, const Color(0xFFF28B82));
      expect(AppColors.dangerSubtle, const Color(0xFF3A2423));
      expect(AppColors.info, const Color(0xFF8AB4F8));
    });

    test('AppRadius matches Antigravity 2.0 radius scale', () {
      expect(AppRadius.none, 0.0);
      expect(AppRadius.xs, 4.0);
      expect(AppRadius.sm, 6.0);
      expect(AppRadius.md, 8.0);
      expect(AppRadius.lg, 12.0);
      expect(AppRadius.xl, 16.0);
      expect(AppRadius.xxl, 20.0);
      expect(AppRadius.pill, 999.0);
    });

    test('AppTheme generates valid Dark and Light ThemeData', () {
      final dark = AppTheme.darkTheme;
      expect(dark.brightness, Brightness.dark);
      expect(dark.scaffoldBackgroundColor, AppColors.surfaceBase);
      expect(dark.colorScheme.surface, AppColors.surfaceBase);
      expect(dark.colorScheme.primary, AppColors.accentBlue);

      final light = AppTheme.lightTheme;
      expect(light.brightness, Brightness.light);
      expect(light.useMaterial3, true);
    });

    test('AppColors matches ASAR confirmed wizard and window tokens', () {
      expect(AppColors.windowDark, const Color(0xFF131313));
      expect(AppColors.windowLight, const Color(0xFFFAFAFA));
      expect(AppColors.wizardWindowBg, const Color(0xFF0D0D0D));
      expect(AppColors.wizardBgPrimary, const Color(0xFF000000));
      expect(AppColors.wizardBgSecondary, const Color(0xFF1A1A1A));
      expect(AppColors.wizardBgTertiary, const Color(0xFF242424));
      expect(AppColors.wizardAccent, const Color(0xFF2F80ED));
      expect(AppColors.wizardAccentHover, const Color(0xFF2D74D7));
    });
  });
}
