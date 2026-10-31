import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:mobile/theme/app_colors.dart';

/// Indicateur d'activité avec animation d'onde progressive (Wave Animation)
/// Conçu pour matérialiser l'attente active de l'agent (ex: tâche en arrière-plan en cours).
class WavePulseIndicator extends StatefulWidget {
  final double width;
  final double height;
  final Color? color;
  final int barCount;

  const WavePulseIndicator({
    super.key,
    this.width = 16,
    this.height = 14,
    this.color,
    this.barCount = 3,
  });

  @override
  State<WavePulseIndicator> createState() => _WavePulseIndicatorState();
}

class _WavePulseIndicatorState extends State<WavePulseIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final effectiveColor = widget.color ?? AppColors.accentBlueBright;
    final barWidth = (widget.width / (widget.barCount * 1.8)).clamp(1.5, 3.0);

    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: List.generate(widget.barCount, (index) {
              // Déphasage trigonométrique créant un effet de vague fluide
              final phase = (index / widget.barCount) * 2 * math.pi;
              final progress = (_controller.value * 2 * math.pi) + phase;
              final scale = 0.35 + (0.65 * (0.5 * (1 + math.sin(progress))));

              return Container(
                width: barWidth,
                height: (widget.height * scale).clamp(3.0, widget.height),
                decoration: BoxDecoration(
                  color: effectiveColor,
                  borderRadius: BorderRadius.circular(barWidth / 2),
                ),
              );
            }),
          );
        },
      ),
    );
  }
}
