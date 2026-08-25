import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Antigravity 2.0 Official Logo & Icon Component Suite
/// Provides high-fidelity branded icons, wordmarks, banners and avatar badges
/// using the official Google Antigravity gradient aesthetics.
class AntigravityLogo extends StatelessWidget {
  /// Size of the logo icon.
  final double size;

  /// Whether to render a soft atmospheric gradient glow behind the icon.
  final bool showGlow;

  /// Optional custom hero tag if used in hero transitions.
  final String? heroTag;

  /// Optional border radius. Defaults to smooth squircle/rounded circle.
  final BorderRadius? borderRadius;

  const AntigravityLogo({
    super.key,
    this.size = 40,
    this.showGlow = true,
    this.heroTag,
    this.borderRadius,
  });

  /// Compact circular avatar badge for AI agents, system messages or chat headers.
  static Widget avatar({
    Key? key,
    double radius = 16,
    bool showGlow = false,
  }) {
    return AntigravityLogo(
      key: key,
      size: radius * 2,
      showGlow: showGlow,
      borderRadius: BorderRadius.circular(radius),
    );
  }

  /// Horizontal brand lockup featuring the glowing Antigravity icon + modern typography.
  static Widget wordmark({
    Key? key,
    double iconSize = 28,
    String title = 'Antigravity',
    String subtitle = 'REMOTE',
    bool showGlow = true,
    bool? isDaemonConnected,
    bool? isIdeConnected,
    bool showDualStatus = false,
    TextStyle? titleStyle,
    TextStyle? subtitleStyle,
    VoidCallback? onTap,
  }) {
    return _AntigravityWordmark(
      key: key,
      iconSize: iconSize,
      title: title,
      subtitle: subtitle,
      showGlow: showGlow,
      isDaemonConnected: isDaemonConnected,
      isIdeConnected: isIdeConnected,
      showDualStatus: showDualStatus,
      titleStyle: titleStyle,
      subtitleStyle: subtitleStyle,
      onTap: onTap,
    );
  }

  /// Full branding splash/drawer header banner.
  static Widget banner({
    Key? key,
    double? width,
    double height = 140,
    EdgeInsetsGeometry margin = EdgeInsets.zero,
    BorderRadius? borderRadius,
  }) {
    return Container(
      key: key,
      width: width ?? double.infinity,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        color: AppColors.surfaceBase,
        borderRadius: borderRadius ?? BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.borderSubtle, width: 0.8),
        image: const DecorationImage(
          image: AssetImage('assets/logo_banner.png'),
          fit: BoxFit.cover,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final r = borderRadius ?? BorderRadius.circular(size * 0.28);

    Widget imageWidget = ClipRRect(
      borderRadius: r,
      child: Image.asset(
        isDark ? 'assets/logo.png' : 'assets/logo_light.png',
        width: size,
        height: size,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => Image.asset(
          'assets/logo.png',
          width: size,
          height: size,
          fit: BoxFit.contain,
        ),
      ),
    );

    if (heroTag != null) {
      imageWidget = Hero(tag: heroTag!, child: imageWidget);
    }

    if (!showGlow) {
      return SizedBox(
        width: size,
        height: size,
        child: imageWidget,
      );
    }

    // Atmospheric multi-color glow matching AGY logo palette
    return Stack(
      alignment: Alignment.center,
      children: [
        // Ambient soft radial glow
        IgnorePointer(
          child: Container(
            width: size * 1.35,
            height: size * 1.35,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                center: Alignment.center,
                radius: 0.75,
                colors: [
                  const Color(0xFF3186FF).withValues(alpha: isDark ? 0.28 : 0.18),
                  const Color(0xFF00B95C).withValues(alpha: isDark ? 0.16 : 0.08),
                  Colors.transparent,
                ],
                stops: const [0.0, 0.55, 1.0],
              ),
            ),
          ),
        ),
        imageWidget,
      ],
    );
  }
}

class _AntigravityWordmark extends StatelessWidget {
  final double iconSize;
  final String title;
  final String subtitle;
  final bool showGlow;
  final bool? isDaemonConnected;
  final bool? isIdeConnected;
  final bool showDualStatus;
  final TextStyle? titleStyle;
  final TextStyle? subtitleStyle;
  final VoidCallback? onTap;

  const _AntigravityWordmark({
    super.key,
    required this.iconSize,
    required this.title,
    required this.subtitle,
    required this.showGlow,
    this.isDaemonConnected,
    this.isIdeConnected,
    this.showDualStatus = false,
    this.titleStyle,
    this.subtitleStyle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        AntigravityLogo(
          size: iconSize,
          showGlow: showGlow,
        ),
        const SizedBox(width: 10),
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: titleStyle ??
                  TextStyle(
                    fontSize: iconSize * 0.58,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
            ),
            if (showDualStatus)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Badge 2.0
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4.5, vertical: 0.8),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1E222A) : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(3.5),
                        border: Border.all(
                          color: isDark ? const Color(0xFF323846) : scheme.outlineVariant.withValues(alpha: 0.5),
                          width: 0.6,
                        ),
                      ),
                      child: Text(
                        '2.0',
                        style: TextStyle(
                          fontSize: (iconSize * 0.28).clamp(8.5, 10.5),
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.4,
                          color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        ),
                      ),
                    ),
                    const SizedBox(width: 3.5),
                    // Point coloré 2.0
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: (isDaemonConnected ?? true) ? AppColors.positive : AppColors.danger,
                        boxShadow: [
                          BoxShadow(
                            color: ((isDaemonConnected ?? true) ? AppColors.positive : AppColors.danger).withValues(alpha: 0.55),
                            blurRadius: 3,
                            spreadRadius: 0.5,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Badge IDE
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4.5, vertical: 0.8),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1E222A) : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(3.5),
                        border: Border.all(
                          color: isDark ? const Color(0xFF323846) : scheme.outlineVariant.withValues(alpha: 0.5),
                          width: 0.6,
                        ),
                      ),
                      child: Text(
                        'IDE',
                        style: TextStyle(
                          fontSize: (iconSize * 0.28).clamp(8.5, 10.5),
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.4,
                          color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        ),
                      ),
                    ),
                    const SizedBox(width: 3.5),
                    // Point coloré IDE
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: (isIdeConnected ?? true) ? AppColors.positive : AppColors.danger,
                        boxShadow: [
                          BoxShadow(
                            color: ((isIdeConnected ?? true) ? AppColors.positive : AppColors.danger).withValues(alpha: 0.55),
                            blurRadius: 3,
                            spreadRadius: 0.5,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              )
            else if (subtitle.isNotEmpty)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      gradient: AppGradients.cardCool(isDark: isDark),
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(
                        color: const Color(0xFF3186FF).withValues(alpha: isDark ? 0.35 : 0.25),
                        width: 0.6,
                      ),
                    ),
                    child: Text(
                      subtitle,
                      style: subtitleStyle ??
                          TextStyle(
                            fontSize: (iconSize * 0.3).clamp(9.0, 11.0),
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8,
                            color: const Color(0xFF3186FF),
                          ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: content,
        ),
      );
    }

    return content;
  }
}
