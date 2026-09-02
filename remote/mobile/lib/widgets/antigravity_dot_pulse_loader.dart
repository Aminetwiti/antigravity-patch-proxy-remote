import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Exact Antigravity 2.0 native dot-pulse loading indicator.
/// Transposed from app.asar -> dist/loadingOverlay.js (L37-51):
/// @keyframes dot-pulse {
///   0%, 100% { opacity: 0.2; transform: scale(0.9); }
///   50% { opacity: 0.7; transform: scale(1.1); }
/// }
/// Animation duration: 1.5s
class AntigravityDotPulseLoader extends StatefulWidget {
  final Color? color;
  final double dotSize;
  final double spacing;

  const AntigravityDotPulseLoader({
    super.key,
    this.color,
    this.dotSize = 5.0,
    this.spacing = 4.0,
  });

  @override
  State<AntigravityDotPulseLoader> createState() => _AntigravityDotPulseLoaderState();
}

class _AntigravityDotPulseLoaderState extends State<AntigravityDotPulseLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double _evaluateProgress(double offset) {
    final raw = (_controller.value + offset) % 1.0;
    // Map 0..1 to 0..1..0 triangle wave
    return raw <= 0.5 ? raw * 2.0 : (1.0 - raw) * 2.0;
  }

  Widget _buildDot(double progress, Color color) {
    // 0.2 -> 0.7 opacity
    final opacity = 0.2 + (0.5 * progress);
    // 0.9 -> 1.1 scale
    final scale = 0.9 + (0.2 * progress);

    return Transform.scale(
      scale: scale,
      child: Opacity(
        opacity: opacity.clamp(0.0, 1.0),
        child: Container(
          width: widget.dotSize,
          height: widget.dotSize,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final effectiveColor = widget.color ??
        (Theme.of(context).brightness == Brightness.dark
            ? AppColors.inkPrimary
            : AppColors.surfaceBase);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildDot(_evaluateProgress(0.0), effectiveColor),
            SizedBox(width: widget.spacing),
            _buildDot(_evaluateProgress(0.18), effectiveColor),
            SizedBox(width: widget.spacing),
            _buildDot(_evaluateProgress(0.36), effectiveColor),
          ],
        );
      },
    );
  }
}
