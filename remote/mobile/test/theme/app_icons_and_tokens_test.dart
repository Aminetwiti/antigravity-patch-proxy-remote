import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/theme/app_theme.dart';

void main() {
  group('Antigravity 2.0 Master Design System Token & Icon Tests', () {
    test('AppIcons defines all canonical Material Symbols and sizes from ICON_INVENTORY.md', () {
      expect(AppIcons.search, equals(Icons.search_rounded));
      expect(AppIcons.settings, equals(Icons.settings_outlined));
      expect(AppIcons.chat, equals(Icons.chat_bubble_outline_rounded));
      expect(AppIcons.history, equals(Icons.history_rounded));
      expect(AppIcons.mcp, equals(Icons.construction_rounded));
      expect(AppIcons.folder, equals(Icons.folder_open_outlined));
      expect(AppIcons.terminal, equals(Icons.terminal_rounded));
      expect(AppIcons.running, equals(Icons.autorenew_rounded));
      expect(AppIcons.success, equals(Icons.check_circle_outline_rounded));
      expect(AppIcons.error, equals(Icons.error_outline_rounded));

      expect(AppIcons.sizeSm, equals(16.0));
      expect(AppIcons.sizeMd, equals(18.0));
      expect(AppIcons.sizeBase, equals(20.0));
      expect(AppIcons.sizeLg, equals(24.0));
    });

    test('AppBorders and AppBreakpoints adhere to borders.json and breakpoints.json', () {
      expect(AppBorders.hairline, equals(0.5));
      expect(AppBorders.standard, equals(1.0));
      expect(AppBorders.strong, equals(1.5));
      expect(AppBorders.focus, equals(2.0));

      expect(AppBreakpoints.mobile, equals(640.0));
      expect(AppBreakpoints.tablet, equals(768.0));
      expect(AppBreakpoints.desktop, equals(1024.0));
      expect(AppBreakpoints.wide, equals(1280.0));
    });

    test('Provider tinted backgrounds match COLOR_PALETTE.md 13% opacity (0x22)', () {
      expect(AppColors.providerOpenAIBg, equals(const Color(0x2210A37F)));
      expect(AppColors.providerAnthropicBg, equals(const Color(0x22D97757)));
      expect(AppColors.providerGoogleBg, equals(const Color(0x224285F4)));
      expect(AppColors.providerOllamaBg, equals(const Color(0x22F0F0F0)));
      expect(AppColors.providerOpenRouterBg, equals(const Color(0x22FF7A45)));
      expect(AppColors.providerCustomBg, equals(const Color(0x22A855F7)));
    });
  });
}
