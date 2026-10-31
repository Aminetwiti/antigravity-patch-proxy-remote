import 'dart:ui';
import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// GlassContainer : Composant conteneur glassmorphism fidèle au Design System CSS Antigravity 2.0.
///
/// Implémente :
/// - Fond translucide --glass-bg-tier-2 (rgba(39, 39, 42, 0.75))
/// - Flou d'arrière-plan BackdropFilter (sigma: 12.0)
/// - Liseré de réfraction --glass-border (rgba(255, 255, 255, 0.08))
/// - Ombre portée profonde --shadow-glass
class GlassContainer extends StatelessWidget {
  final Widget child;
  final double? width;
  final double? height;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadius? borderRadius;
  final double blur;
  final Color? backgroundColor;
  final Border? border;
  final List<BoxShadow>? boxShadow;
  final VoidCallback? onTap;

  const GlassContainer({
    super.key,
    required this.child,
    this.width,
    this.height,
    this.padding,
    this.margin,
    this.borderRadius,
    this.blur = 12.0,
    this.backgroundColor,
    this.border,
    this.boxShadow,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final r = borderRadius ?? BorderRadius.circular(AppRadius.lg);

    final bg = backgroundColor ??
        (isDark
            ? AppColors.glassBgTier2
            : Theme.of(context).colorScheme.surface.withValues(alpha: 0.85));

    final effectiveBorder = border ??
        Border.all(
          color: isDark ? AppColors.glassBorder : Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.4),
          width: 1.0,
        );

    final effectiveShadows = boxShadow ?? (isDark ? AppShadows.glass : null);

    Widget content = Container(
      width: width,
      height: height,
      padding: padding,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: r,
        border: effectiveBorder,
      ),
      child: child,
    );

    if (onTap != null) {
      content = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: content,
        ),
      );
    }

    return Container(
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: r,
        boxShadow: effectiveShadows,
      ),
      child: ClipRRect(
        borderRadius: r,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
          child: content,
        ),
      ),
    );
  }
}
