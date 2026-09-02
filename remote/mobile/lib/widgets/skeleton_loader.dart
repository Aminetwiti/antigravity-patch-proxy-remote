import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Composant d'animation d'attente Shimmer / Skeleton hautement optimisé (Antigravity 2.0).
/// Masque la latence des requêtes et du polling réseau avec un balayage fluide.
class SkeletonLoader extends StatefulWidget {
  final Widget child;
  final bool enabled;
  final Duration duration;
  final Color? baseColor;
  final Color? highlightColor;

  const SkeletonLoader({
    super.key,
    required this.child,
    this.enabled = true,
    this.duration = const Duration(milliseconds: 950),
    this.baseColor,
    this.highlightColor,
  });

  @override
  State<SkeletonLoader> createState() => _SkeletonLoaderState();
}

class _SkeletonLoaderState extends State<SkeletonLoader> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (widget.enabled && !reduceMotion) {
      if (!_controller.isAnimating) {
        _controller.repeat();
      }
    } else {
      if (_controller.isAnimating) {
        _controller.stop();
      }
    }
  }

  @override
  void didUpdateWidget(covariant SkeletonLoader oldWidget) {
    super.didUpdateWidget(oldWidget);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (widget.enabled && !reduceMotion && !_controller.isAnimating) {
      _controller.repeat();
    } else if ((!widget.enabled || reduceMotion) && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;

    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (reduceMotion) {
      return widget.child;
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final List<Color> shimmer;
    if (widget.baseColor != null || widget.highlightColor != null) {
      // Respect caller overrides (backward compat)
      final base = widget.baseColor ?? (isDark ? AppColors.surfaceInput : const Color(0xFFEAEEF2));
      final hl = widget.highlightColor ?? (isDark ? AppColors.surfaceHover : const Color(0xFFF6F8FA));
      shimmer = [base, hl, base];
    } else {
      shimmer = AppGradients.shimmerColors(isDark: isDark);
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: shimmer,
              stops: const [0.0, 0.5, 1.0],
              transform: _SlidingGradientTransform(slidePercent: _controller.value),
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

class _SlidingGradientTransform extends GradientTransform {
  final double slidePercent;
  const _SlidingGradientTransform({required this.slidePercent});

  @override
  Matrix4? transform(Rect bounds, {TextDirection? textDirection}) {
    return Matrix4.translationValues(bounds.width * (slidePercent * 2 - 1), 0.0, 0.0);
  }
}

/// Ligne squelette avec coins arrondis
class SkeletonLine extends StatelessWidget {
  final double? width;
  final double height;
  final double borderRadius;
  final Color? color;

  const SkeletonLine({
    super.key,
    this.width,
    this.height = 12,
    this.borderRadius = 2,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final defaultColor = isDark ? AppColors.surfaceInput : const Color(0xFFE5E7EB);

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: color ?? defaultColor,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// Squelette pour une bulle de message ou étape en cours de chargement
class SkeletonChatMessage extends StatelessWidget {
  final bool isUser;
  const SkeletonChatMessage({super.key, this.isUser = false});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bubbleColor = isUser
        ? (isDark ? AppColors.surfaceHover : const Color(0xFFE3EDFA))
        : (isDark ? AppColors.surfaceInput : const Color(0xFFF6F8FA));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isDark ? AppColors.surfaceHover : const Color(0xFFE0E3E8),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: bubbleColor,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: isDark ? AppColors.borderSubtle : const Color(0xFFD0D7DE),
                  width: 0.8,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SkeletonLine(width: 140, height: 11),
                  const SizedBox(height: 8),
                  const SkeletonLine(width: 100, height: 11),
                  if (!isUser) ...[
                    const SizedBox(height: 8),
                    const SkeletonLine(width: 120, height: 11),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Squelette pour la liste de fichiers modifiés (Session Review)
class SkeletonDiffFileItem extends StatelessWidget {
  const SkeletonDiffFileItem({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Container(
            width: 18,
            height: 18,
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceHover : const Color(0xFFE1E4E8),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                SkeletonLine(width: 140, height: 12),
                SizedBox(height: 4),
                SkeletonLine(width: 90, height: 9),
              ],
            ),
          ),
          const SizedBox(width: 12),
          const SkeletonLine(width: 45, height: 14, borderRadius: 999),
        ],
      ),
    );
  }
}

/// Squelette pour un élément de la hiérarchie des sous-agents
class SkeletonSubagentItem extends StatelessWidget {
  const SkeletonSubagentItem({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isDark ? AppColors.surfaceHover : const Color(0xFFE1E4E8),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                SkeletonLine(width: 160, height: 12),
                SizedBox(height: 4),
                SkeletonLine(width: 100, height: 10),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const SkeletonLine(width: 50, height: 16, borderRadius: 2),
        ],
      ),
    );
  }
}

/// Squelette pour une ligne de tâche planifiée
class SkeletonScheduledTaskRow extends StatelessWidget {
  const SkeletonScheduledTaskRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          const SkeletonLine(width: 18, height: 18, borderRadius: 2),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                SkeletonLine(width: 180, height: 13),
                SizedBox(height: 5),
                SkeletonLine(width: 110, height: 10),
              ],
            ),
          ),
          const SizedBox(width: 12),
          const SkeletonLine(width: 36, height: 20, borderRadius: 999),
        ],
      ),
    );
  }
}
