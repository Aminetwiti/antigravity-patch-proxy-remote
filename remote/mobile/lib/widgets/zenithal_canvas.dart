import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Global atmospheric canvas providing a subtle top-centered studio glow
/// over deep dark zinc background, adhering to Antigravity 2.0 aesthetics.
///
/// In dark mode, overlays 2 blurred decorative orbs (blue top-right,
/// green bottom-left) inspired by the AGY logo's layered gradient ellipses.
/// In light mode, a clean surface with no orbs (matches the blog's light design).
class ZenithalCanvas extends StatelessWidget {
  final Widget child;

  const ZenithalCanvas({
    super.key,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (!isDark) {
      return SizedBox.expand(
        child: Container(
          color: Theme.of(context).colorScheme.surface,
          child: child,
        ),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surfaceBase,
        gradient: AppGradients.zenithal,
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // RepaintBoundary isolates background atmospheric rendering from active child rebuilds
          RepaintBoundary(
            child: Stack(
              children: [
                // Blue orb — top right (like the AGY logo's primary blue ellipse)
                Positioned(
                  top: -80,
                  right: -60,
                  width: 280,
                  height: 280,
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: AppGradients.orbBlue(isDark: true),
                      ),
                    ),
                  ),
                ),
                // Green orb — bottom left (like the AGY logo's green ellipse)
                Positioned(
                  bottom: -100,
                  left: -70,
                  width: 260,
                  height: 260,
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: AppGradients.orbGreen(isDark: true),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned.fill(child: child),
        ],
      ),
    );
  }
}
