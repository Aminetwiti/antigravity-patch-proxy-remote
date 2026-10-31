import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Reusable signature status badge with a live glowing dot and translucent pill,
/// adhering to Antigravity 2.0 and Quiet Console design principles.
class StatusDotBadge extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;
  final VoidCallback? onTap;
  final bool isPulsing;

  const StatusDotBadge({
    super.key,
    required this.label,
    required this.color,
    this.icon,
    this.onTap,
    this.isPulsing = false,
  });

  @override
  Widget build(BuildContext context) {
    final badge = Container(
      padding: const EdgeInsets.symmetric(horizontal: 7.5, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.3), width: 0.75),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 10, color: color),
            const SizedBox(width: 4),
          ] else ...[
            Container(
              width: 5.5,
              height: 5.5,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: color.withValues(alpha: 0.55),
                    blurRadius: 3.5,
                    spreadRadius: 0.8,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 5.5),
          ],
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
              color: color,
            ),
          ),
        ],
      ),
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: badge,
      );
    }

    return badge;
  }
}

/// Animated 3-dots indicator representing an agent waiting / background task running / pending user action.
class ThreeDotsWaiting extends StatefulWidget {
  final Color? color;
  final double size;
  final double spacing;

  const ThreeDotsWaiting({
    super.key,
    this.color,
    this.size = 3.5,
    this.spacing = 2.0,
  });

  @override
  State<ThreeDotsWaiting> createState() => _ThreeDotsWaitingState();
}

class _ThreeDotsWaitingState extends State<ThreeDotsWaiting>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dotColor = widget.color ?? const Color(0xFFE5A93C);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(3, (index) {
        return AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            final progress = (_controller.value - (index * 0.18)) % 1.0;
            final normalized = (progress < 0 ? progress + 1.0 : progress);
            final wave = (0.5 - (normalized - 0.5).abs()) * 2; // 0.0 -> 1.0 -> 0.0
            final alpha = 0.35 + 0.65 * wave;
            final scale = 0.75 + 0.35 * wave;

            return Container(
              margin: EdgeInsets.symmetric(horizontal: widget.spacing / 2),
              child: Transform.scale(
                scale: scale,
                child: Container(
                  width: widget.size,
                  height: widget.size,
                  decoration: BoxDecoration(
                    color: dotColor.withValues(alpha: alpha.clamp(0.2, 1.0)),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: dotColor.withValues(alpha: (alpha * 0.4).clamp(0.0, 0.6)),
                        blurRadius: 2,
                        spreadRadius: 0.2,
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      }),
    );
  }
}
