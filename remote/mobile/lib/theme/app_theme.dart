import 'package:flutter/material.dart';
import 'app_colors.dart';
export 'app_colors.dart';
export 'app_spacing.dart';
export 'app_typography.dart';
export 'app_icons.dart';

/// Antigravity 2.0 ThemeData builder
/// Aligné sur le design system PC (ag-doctor-ui « The Quiet Console ») :
/// canvas Zinc-950, surfaces Zinc-900/800/700, typo 11–14px, radius 4/6/10.
class AppTheme {
  static ThemeData get darkTheme {
    final colorScheme = const ColorScheme.dark(
      surface: AppColors.surfaceBase,
      surfaceContainerHighest: AppColors.surfaceInput,
      surfaceContainer: AppColors.surfaceRaised,
      onSurface: AppColors.inkPrimary,
      onSurfaceVariant: AppColors.inkSecondary,
      outline: AppColors.borderStrong,
      outlineVariant: AppColors.borderSubtle,
      primary: AppColors.accentBlue,
      onPrimary: AppColors.onAccent,
      secondary: AppColors.inkSecondary,
      error: AppColors.danger,
      onError: AppColors.onDanger,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: colorScheme.surface,
      colorScheme: colorScheme,
      splashColor: Colors.transparent,
      highlightColor: Colors.transparent,
      splashFactory: NoSplash.splashFactory,
      // ── Typographie (PC --fs-xs … --fs-md, --fw-*) ──
      textTheme: const TextTheme(
        labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.inkFaint),
        labelMedium: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: AppColors.inkSecondary),
        bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: AppColors.inkSecondary),
        bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: AppColors.inkPrimary),
        titleMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.inkPrimary),
        titleLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.inkPrimary),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surfaceContainer,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: colorScheme.onSurface),
        titleTextStyle: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 14, // PC --fs-md
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        color: colorScheme.surfaceContainer,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg), // PC --r-lg
          side: BorderSide(color: colorScheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surfaceContainerHighest,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        hintStyle: TextStyle(color: AppColors.inkMuted, fontSize: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md), // PC --r-md
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: colorScheme.primary),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9), // PC .btn 9/16
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colorScheme.onSurface,
          side: BorderSide(color: colorScheme.primary),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: colorScheme.surfaceContainer,
        indicatorColor: colorScheme.primary.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        height: 64,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: colorScheme.onSurfaceVariant),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? colorScheme.primary
                : colorScheme.onSurfaceVariant,
          ),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant,
        thickness: 1,
        space: 1,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: colorScheme.onSurfaceVariant,
        textColor: colorScheme.onSurface,
        dense: true,
      ),
      iconTheme: IconThemeData(
        color: colorScheme.onSurfaceVariant,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: colorScheme.outlineVariant, width: 1),
        ),
        textStyle: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 11.5,
          fontWeight: FontWeight.w500,
        ),
        waitDuration: const Duration(milliseconds: 400),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStatePropertyAll(colorScheme.onSurfaceVariant.withValues(alpha: 0.3)),
        radius: const Radius.circular(3),
        thickness: const WidgetStatePropertyAll(4),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: colorScheme.surfaceContainerHighest,
        contentTextStyle: TextStyle(color: colorScheme.onSurface, fontSize: 12.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: colorScheme.outlineVariant),
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  // Light theme calqué sur les tokens GitHub Light PC (ag-doctor-ui).
  static ThemeData get lightTheme {
    final colorScheme = const ColorScheme.light(
      surface: Color(0xFFFFFFFF),      // PC --bg-0 #ffffff
      surfaceContainerHighest: Color(0xFFEAEEF2), // PC --bg-3 #eaeef2 (raised/hover)
      surfaceContainer: Color(0xFFF6F8FA),        // PC --bg-1 #f6f8fa (panels)
      onSurface: Color(0xFF1F2328),    // PC --text-0 #1f2328
      onSurfaceVariant: Color(0xFF57606A), // PC --text-2 #57606a
      outline: Color(0xFFAFB8C1),      // PC --border-strong
      outlineVariant: Color(0xFFD0D7DE), // PC --border #d0d7de
      primary: Color(0xFF0969DA),      // PC --accent-blue #0969da
      onPrimary: AppColors.onAccent,
      secondary: Color(0xFF57606A),
      error: Color(0xFFCF222E),        // PC --err
      onError: AppColors.onDanger,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.surface,
      splashColor: Colors.transparent,
      highlightColor: Colors.transparent,
      splashFactory: NoSplash.splashFactory,
      textTheme: const TextTheme(
        labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Color(0xFF57606A)),
        labelMedium: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFF57606A)),
        bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: Color(0xFF57606A)),
        bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: Color(0xFF1F2328)),
        titleMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF1F2328)),
        titleLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF1F2328)),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surfaceContainer,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: colorScheme.onSurface),
        titleTextStyle: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        color: colorScheme.surfaceContainer,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          side: BorderSide(color: colorScheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surfaceContainerHighest,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: colorScheme.primary),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colorScheme.onSurface,
          side: BorderSide(color: colorScheme.primary),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: colorScheme.surfaceContainer,
        indicatorColor: colorScheme.primary.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        height: 64,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: colorScheme.onSurfaceVariant),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? colorScheme.primary
                : colorScheme.onSurfaceVariant,
          ),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant,
        thickness: 1,
        space: 1,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: colorScheme.onSurfaceVariant,
        textColor: colorScheme.onSurface,
        dense: true,
      ),
      iconTheme: IconThemeData(color: colorScheme.onSurfaceVariant),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: colorScheme.outlineVariant, width: 1),
        ),
        textStyle: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 11.5,
          fontWeight: FontWeight.w500,
        ),
        waitDuration: const Duration(milliseconds: 400),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStatePropertyAll(colorScheme.onSurfaceVariant.withValues(alpha: 0.3)),
        radius: const Radius.circular(3),
        thickness: const WidgetStatePropertyAll(4),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: colorScheme.surfaceContainerHighest,
        contentTextStyle: TextStyle(color: colorScheme.onSurface, fontSize: 12.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: colorScheme.outlineVariant),
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
