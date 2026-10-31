import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Spinner Material Design 3 à double piste (Double-Track Spinner) fidèle au Web BOQ Antigravity.
/// Comporte un anneau d'arrière-plan discret (track) et une tête rotative fluide (head).
class Md3DoubleTrackSpinner extends StatefulWidget {
  final double size;
  final double strokeWidth;
  final Color? color;
  final Color? trackColor;

  const Md3DoubleTrackSpinner({
    super.key,
    this.size = 14,
    this.strokeWidth = 1.8,
    this.color,
    this.trackColor,
  });

  @override
  State<Md3DoubleTrackSpinner> createState() => _Md3DoubleTrackSpinnerState();
}

class _Md3DoubleTrackSpinnerState extends State<Md3DoubleTrackSpinner>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 950),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final effectiveColor = widget.color ?? (isDark ? const Color(0xFFA8C7FA) : scheme.primary);
    final effectiveTrackColor = widget.trackColor ?? effectiveColor.withValues(alpha: 0.18);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return CustomPaint(
          size: Size(widget.size, widget.size),
          painter: _Md3DoubleTrackPainter(
            progress: _controller.value,
            color: effectiveColor,
            trackColor: effectiveTrackColor,
            strokeWidth: widget.strokeWidth,
          ),
        );
      },
    );
  }
}

class _Md3DoubleTrackPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color trackColor;
  final double strokeWidth;

  _Md3DoubleTrackPainter({
    required this.progress,
    required this.color,
    required this.trackColor,
    required this.strokeWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;
    if (radius <= 0) return;

    // 1. Piste de fond (Background Track - 360°)
    final trackPaint = Paint()
      ..color = trackColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawCircle(center, radius, trackPaint);

    // 2. Tête rotative (Rotating Head - Arc avec embout arrondi)
    final headPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    final startAngle = progress * 2 * math.pi;
    const sweepAngle = 1.2 * math.pi; // ~216 deg arc

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      sweepAngle,
      false,
      headPaint,
    );
  }

  @override
  bool shouldRepaint(_Md3DoubleTrackPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.color != color ||
        oldDelegate.trackColor != trackColor ||
        oldDelegate.strokeWidth != strokeWidth;
  }
}
