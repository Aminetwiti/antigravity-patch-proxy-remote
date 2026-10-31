import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_colors.dart';

enum BouncingHapticType { selection, light, medium, heavy, none }

/// Micro-interaction container that applies a subtle physical compression (`scale: 0.975`)
/// on tap down and emits tactile haptic feedback.
class BouncingTap extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scaleFactor;
  final bool enableHaptics;
  final BouncingHapticType hapticType;

  const BouncingTap({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.scaleFactor = 0.975,
    this.enableHaptics = true,
    this.hapticType = BouncingHapticType.selection,
  });

  @override
  State<BouncingTap> createState() => _BouncingTapState();
}

class _BouncingTapState extends State<BouncingTap> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 90),
    );
    _animation = Tween<double>(
      begin: 1.0,
      end: widget.scaleFactor,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTapDown(TapDownDetails _) {
    if (widget.onTap != null || widget.onLongPress != null) {
      if (AppMotion.shouldAnimate(context)) {
        _controller.forward();
      }
    }
  }

  void _handleTapUp(TapUpDetails _) {
    if (widget.onTap != null) {
      if (AppMotion.shouldAnimate(context)) {
        _controller.reverse();
      }
      if (widget.enableHaptics) {
        switch (widget.hapticType) {
          case BouncingHapticType.selection:
            HapticFeedback.selectionClick();
            break;
          case BouncingHapticType.light:
            HapticFeedback.lightImpact();
            break;
          case BouncingHapticType.medium:
            HapticFeedback.mediumImpact();
            break;
          case BouncingHapticType.heavy:
            HapticFeedback.heavyImpact();
            break;
          case BouncingHapticType.none:
            break;
        }
      }
      widget.onTap?.call();
    }
  }

  void _handleTapCancel() {
    if (AppMotion.shouldAnimate(context)) {
      _controller.reverse();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.onTap == null && widget.onLongPress == null) {
      return widget.child;
    }

    return GestureDetector(
      onTapDown: _handleTapDown,
      onTapUp: _handleTapUp,
      onTapCancel: _handleTapCancel,
      onLongPress: widget.onLongPress != null
          ? () {
              if (widget.enableHaptics) {
                HapticFeedback.mediumImpact();
              }
              widget.onLongPress?.call();
            }
          : null,
      behavior: HitTestBehavior.opaque,
      child: ScaleTransition(
        scale: _animation,
        child: widget.child,
      ),
    );
  }
}
