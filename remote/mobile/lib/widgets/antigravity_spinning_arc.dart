import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Exact Antigravity 2.0 spinning arc activity indicator.
class AntigravitySpinningArc extends StatefulWidget {
  final Color color;
  final double size;

  const AntigravitySpinningArc({
    super.key,
    this.color = const Color(0xFF9AA0AD),
    this.size = 13.5,
  });

  @override
  State<AntigravitySpinningArc> createState() => _AntigravitySpinningArcState();
}

class _AntigravitySpinningArcState extends State<AntigravitySpinningArc>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

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
    if (!AppMotion.shouldAnimate(context)) {
      return SizedBox(
        width: widget.size,
        height: widget.size,
        child: CustomPaint(
          painter: _ArcPainter(color: widget.color),
        ),
      );
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, __) => Transform.rotate(
        angle: _controller.value * 2 * math.pi,
        child: SizedBox(
          width: widget.size,
          height: widget.size,
          child: CustomPaint(
            painter: _ArcPainter(color: widget.color),
          ),
        ),
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  final Color color;
  const _ArcPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - 1.3) / 2;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      1.5 * math.pi,
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _ArcPainter oldDelegate) =>
      oldDelegate.color != color;
}
