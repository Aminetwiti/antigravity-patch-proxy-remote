import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Floating turn navigation control inspired by agy-enhancer.
/// Provides turn-by-turn jumps (prompt ↔ answer) and fast scroll-to-bottom.
class TurnNavigationFab extends StatelessWidget {
  final VoidCallback onNavigateUp;
  final VoidCallback onNavigateDown;
  final VoidCallback? onScrollToBottom;
  final bool isAtBottom;

  const TurnNavigationFab({
    super.key,
    required this.onNavigateUp,
    required this.onNavigateDown,
    this.onScrollToBottom,
    this.isAtBottom = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.6),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Bouton Page / Turn Précédent (↑)
          InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () {
              HapticFeedback.lightImpact();
              onNavigateUp();
            },
            child: Semantics(
              label: 'Turn précédent / Début prompt',
              button: true,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: Icon(
                    Icons.keyboard_arrow_up_rounded,
                    size: 22,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
          Container(
            width: 20,
            height: 1,
            color: scheme.outlineVariant.withValues(alpha: 0.4),
          ),
          // Bouton Page / Turn Suivant (↓) avec support LongPress / DoubleTap pour le fond absolu
          InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () {
              HapticFeedback.lightImpact();
              onNavigateDown();
            },
            onDoubleTap: () {
              HapticFeedback.mediumImpact();
              if (onScrollToBottom != null) {
                onScrollToBottom!();
              } else {
                onNavigateDown();
              }
            },
            onLongPress: () {
              HapticFeedback.mediumImpact();
              if (onScrollToBottom != null) {
                onScrollToBottom!();
              } else {
                onNavigateDown();
              }
            },
            child: Semantics(
              label: 'Turn suivant (Long-press / Double-tap: Tout en bas)',
              button: true,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: Icon(
                    isAtBottom ? Icons.vertical_align_bottom_rounded : Icons.keyboard_arrow_down_rounded,
                    size: 22,
                    color: isAtBottom ? scheme.primary : scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
