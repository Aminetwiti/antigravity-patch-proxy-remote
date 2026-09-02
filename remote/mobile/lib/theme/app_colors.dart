import 'package:flutter/material.dart';

/// Antigravity 2.0 Color Palette ("The Quiet Console")
/// Extracted from Antigravity IDE computed tokens (htmlcss.log) + DESIGN.md
abstract class AppColors {
  // ── Backgrounds & Surfaces (Antigravity 2.0 Quiet Console)
  static const Color surfaceBase = Color(0xFF202020);   // #202020 (background.default)
  static const Color surfaceRaised = Color(0xFF242424); // #242424 (surface.default / background.elevated)
  static const Color surfaceInput = Color(0xFF282828);  // #282828 (surface.raised / background.subtle)
  static const Color surfaceOverlay = Color(0xFF2B2B2B);// #2b2b2b (surface.overlay)
  static const Color surfaceHover = Color(0xFF2F2F2F);  // #2f2f2f (surface.hover)
  static const Color surfacePressed = Color(0xFF353535);// #353535 (surface.pressed)
  static const Color surfaceDisabled = Color(0xFF222222);// #222222 (surface.disabled)
  static const Color sidebarBackground = Color(0xFF202020); // #202020
  static const Color editorBackground = Color(0xFF1A1A1A);  // #1a1a1a
  static const Color listSelectionBg = Color(0xFF3C4043);   // #3c4043 (interactive.selection)

  // ── Borders (Antigravity 2.0 Border Scale)
  static const Color borderSubtle = Color(0xFF303030);  // #303030 (border.subtle)
  static const Color borderDefault = Color(0xFF3A3A3A); // #3a3a3a (border.default)
  static const Color borderStrong = Color(0xFF4A4A4A);  // #4a4a4a (border.strong)
  static const Color borderFocus = Color(0xFF8AB4F8);   // #8ab4f8 (border.focus)

  // ── Ink / Text (Antigravity 2.0 Typography Foregrounds)
  static const Color inkPrimary = Color(0xFFF1F1F1);   // #f1f1f1 (text.primary)
  static const Color inkSecondary = Color(0xFFB8B8B8); // #b8b8b8 (text.secondary)
  static const Color inkTertiary = Color(0xFF969696);  // #969696 (text.tertiary)
  static const Color inkMuted = Color(0xFF858585);     // #858585 (text.muted)
  static const Color inkDisabled = Color(0xFF606060);  // #606060 (text.disabled)
  static const Color inkFaint = Color(0xFF969696);     // #969696 (labels)
  static const Color codeGold = Color(0xFFC7E1A3);     // #c7e1a3 (code.string)

  // ── Accents & Actions (Antigravity 2.0 Google Blue Accent)
  static const Color accentBlue = Color(0xFF8AB4F8);     // #8ab4f8 (accent.primary)
  static const Color accentBlueHover = Color(0xFFAECBFA);// #aecbfa (accent.primaryHover)
  static const Color accentBlueBright = Color(0xFFAECBFA);// #aecbfa
  static const Color accentBluePressed = Color(0xFF669DF6);// #669df6 (accent.primaryPressed)
  static const Color accentBlueDeep = Color(0xFF669DF6); // #669df6
  static const Color accentSubtle = Color(0xFF263447);   // #263447 (accent.subtle)
  static const Color buttonBackground = Color(0xFF8AB4F8); // #8ab4f8

  // ── Status (Antigravity 2.0 States: Success / Warning / Error / Info)
  static const Color positive = Color(0xFF81C995);       // #81c995 (status.success)
  static const Color success = positive;
  static const Color successSubtle = Color(0xFF20352A);  // #20352a (status.successSubtle)
  static const Color warning = Color(0xFFFDD663);        // #fdd663 (status.warning)
  static const Color warningSubtle = Color(0xFF3A321A);  // #3a321a (status.warningSubtle)
  static const Color danger = Color(0xFFF28B82);         // #f28b82 (status.error)
  static const Color error = danger;
  static const Color dangerSubtle = Color(0xFF3A2423);   // #3a2423 (status.errorSubtle)
  static const Color dangerDeep = Color(0xFFD93025);     // #d93025
  static const Color info = Color(0xFF8AB4F8);           // #8ab4f8 (status.info)
  static const Color infoSubtle = Color(0xFF263447);     // #263447 (status.infoSubtle)
  static const Color accent = accentBlue;

  // ── Code Syntax Colors
  static const Color codeBackground = Color(0xFF1A1A1A); // #1a1a1a
  static const Color codeForeground = Color(0xFFE8EAED); // #e8eaed
  static const Color codeComment = Color(0xFF80868B);    // #80868b
  static const Color codeKeyword = Color(0xFFA8C7FA);    // #a8c7fa
  static const Color codeString = Color(0xFFC7E1A3);     // #c7e1a3
  static const Color codeNumber = Color(0xFFF8C8DC);     // #f8c8dc

  // ── Diff Editor Tokens
  static const Color diffInsertedLine = Color(0x3381C995); // rgba(129, 201, 149, 0.2)
  static const Color diffRemovedLine = Color(0x33F28B82);  // rgba(242, 139, 130, 0.2)
  static const Color diffInsertedText = Color(0x4D81C995); // rgba(129, 201, 149, 0.3)
  static const Color diffRemovedText = Color(0x66F28B82);  // rgba(242, 139, 130, 0.4)

  // ── Neutrals (scrims, shadows, camera overlay)
  static const Color overlayScrim = Color(0xFF000000);   // full-black scrim (camera, modal backdrop)
  static const Color shadowNeutral = Color(0xFF000000);  // drop shadows, elevation

  // ── On-fill ink (text/icons over accent & danger fills)
  static const Color onAccent = Color(0xFF202020);       // #202020 (dark text over light blue accent)
  static const Color onDanger = Color(0xFF202020);       // #202020

  // ── Provider Accent Badges
  static const Color providerOpenAI = Color(0xFF10A37F);
  static const Color providerAnthropic = Color(0xFFD97757);
  static const Color providerGoogle = Color(0xFF4285F4);
  static const Color providerOllama = Color(0xFFF0F0F0);
  static const Color providerOpenRouter = Color(0xFFFF7A45);
  static const Color providerCustom = Color(0xFFA855F7);

  // ── Dynamic Contextual Accessors (prevents Light/Dark mode conflicts)
  static Color canvas(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? surfaceBase : const Color(0xFFFFFFFF);

  static Color panel(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? surfaceRaised : const Color(0xFFF6F8FA);

  static Color input(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? surfaceInput : const Color(0xFFEAEEF2);

  static Color text(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? inkPrimary : const Color(0xFF1F2328);

  static Color textSecondary(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? inkSecondary : const Color(0xFF57606A);

  static Color textMuted(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? inkMuted : const Color(0xFF6E7781);

  static Color border(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? borderSubtle : const Color(0xFFD0D7DE);

  static Color borderStrongContext(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? borderStrong : const Color(0xFFAFB8C1);

  static Color accentContext(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? accentBlue : const Color(0xFF0969DA);
}

/// Ergonomic syntax sugar for accessing theme colors and animation preference on any BuildContext
extension ThemeContextExtension on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;
  bool get isDarkMode => Theme.of(this).brightness == Brightness.dark;
  bool get shouldAnimate => AppMotion.shouldAnimate(this);
}

/// Radius scale (Antigravity 2.0 radius.json)
abstract class AppRadius {
  static const double none = 0;   // rect
  static const double xs = 4;     // tags, small chips
  static const double sm = 6;     // buttons sm, micro cards
  static const double md = 8;     // buttons, inputs, dropdowns
  static const double lg = 12;    // cards, panels, bottom sheets
  static const double xl = 16;    // modals, composers
  static const double xxl = 20;   // hero containers
  static const double pill = 999; // status pills, badges
}

/// Motion tokens (PC --t-fast/base/slow + --ease-out)
abstract class AppMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 180);
  static const Duration slow = Duration(milliseconds: 320);

  static const Curve easeOut = Curves.easeOutCubic;
  static const Curve easeStandard = Curves.easeInOut;
  /// Google Antigravity Remote official exponential easing curve
  static const Curve expoOut = Cubic(0.16, 1.0, 0.3, 1.0);
  /// Google Antigravity Remote official cubic easing curve
  static const Curve cubicOut = Cubic(0.23, 1.0, 0.32, 1.0);

  /// Vérifie si les animations système sont actives (support Reduce Motion / Accessibility).
  static bool shouldAnimate(BuildContext context) {
    return !MediaQuery.disableAnimationsOf(context);
  }
}

/// Layout and dimension constraints (Antigravity Remote official metrics)
abstract class AppDimensions {
  /// Maximum width for trajectory/chat conversation reading area (48rem / 768px)
  static const double maxConversationWidth = 768.0;
  /// Narrow reading width
  static const double narrowConversationWidth = 600.0;
  /// Composer floating box max width
  static const double composerMaxWidth = 768.0;
}

/// Atmospheric background gradients — Antigravity 2.0 logo palette
///
/// Official AGY logo colors (extracted from blog SVG):
///   Blue  #3186FF   Green #00B95C   Yellow #FBBC04 / #FFE432   Red #FC413D
///   Accent #749BFF
abstract class AppGradients {
  // ── AGY Logo Palette (source of truth for all gradient tints) ──
  static const Color _agyBlue   = Color(0xFF3186FF);
  static const Color _agyGreen  = Color(0xFF00B95C);
  static const Color _agyYellow = Color(0xFFFBBC04);
  static const Color _agyRed    = Color(0xFFFC413D);
  static const Color _agyAccent = Color(0xFF749BFF);

  /// Subtle studio-lit radial glow from top center into deep dark canvas
  static const RadialGradient zenithal = RadialGradient(
    center: Alignment(0.0, -1.25),
    radius: 1.45,
    colors: [
      Color(0xFF202028),
      Color(0xFF09090B),
    ],
    stops: [0.0, 0.65],
  );

  // ── Decorative atmospheric orbs (blurred circles behind content) ──

  /// Blue orb — top-right placement, 5% opacity dark / 3% light
  static RadialGradient orbBlue({bool isDark = true}) => RadialGradient(
    center: Alignment.center,
    radius: 0.8,
    colors: [
      _agyBlue.withValues(alpha: isDark ? 0.06 : 0.035),
      _agyBlue.withValues(alpha: 0.0),
    ],
  );

  /// Green orb — bottom-left placement
  static RadialGradient orbGreen({bool isDark = true}) => RadialGradient(
    center: Alignment.center,
    radius: 0.8,
    colors: [
      _agyGreen.withValues(alpha: isDark ? 0.05 : 0.03),
      _agyGreen.withValues(alpha: 0.0),
    ],
  );

  /// Yellow orb — top-left placement (optional warmth)
  static RadialGradient orbYellow({bool isDark = true}) => RadialGradient(
    center: Alignment.center,
    radius: 0.7,
    colors: [
      _agyYellow.withValues(alpha: isDark ? 0.04 : 0.025),
      _agyYellow.withValues(alpha: 0.0),
    ],
  );

  // ── Card surface washes (barely-visible tint on card backgrounds) ──

  /// Cool card wash: blue→green at 5% opacity (info / neutral cards)
  static LinearGradient cardCool({bool isDark = true}) => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      _agyBlue.withValues(alpha: isDark ? 0.05 : 0.04),
      _agyGreen.withValues(alpha: isDark ? 0.04 : 0.03),
    ],
  );

  /// Warm card wash: yellow→red at 5% opacity (attention / action cards)
  static LinearGradient cardWarm({bool isDark = true}) => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      _agyYellow.withValues(alpha: isDark ? 0.06 : 0.04),
      _agyRed.withValues(alpha: isDark ? 0.05 : 0.03),
    ],
  );

  // ── Full-color CTA gradient (the only surface with visible gradient) ──

  /// Primary action button gradient: AGY blue → lighter accent
  static const LinearGradient accentCta = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [_agyBlue, _agyAccent],
  );

  // ── Branded shimmer sweep for skeleton loaders ──

  /// Shimmer with subtle AGY blue tint instead of neutral grey
  static List<Color> shimmerColors({bool isDark = true}) => isDark
      ? [
          const Color(0xFF1B1F27),
          _agyBlue.withValues(alpha: 0.08),
          const Color(0xFF1B1F27),
        ]
      : [
          const Color(0xFFEAEEF2),
          _agyBlue.withValues(alpha: 0.06),
          const Color(0xFFEAEEF2),
        ];
}
