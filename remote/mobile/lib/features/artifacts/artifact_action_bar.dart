import 'package:flutter/material.dart';
import 'package:mobile/theme/app_colors.dart';

class ArtifactActionBar extends StatelessWidget {
  final bool requestFeedback;
  final VoidCallback onProceed;
  final VoidCallback onRequestFeedback;

  const ArtifactActionBar({
    super.key,
    required this.requestFeedback,
    required this.onProceed,
    required this.onRequestFeedback,
  });

  @override
  Widget build(BuildContext context) {
    if (!requestFeedback) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              icon: const Icon(Icons.edit_note, size: 18),
              label: const Text('Request Changes'),
              style: OutlinedButton.styleFrom(
                foregroundColor: scheme.onSurfaceVariant,
                side: BorderSide(color: scheme.outline),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
              ),
              onPressed: onRequestFeedback,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.icon(
              icon: const Icon(Icons.play_arrow, size: 18),
              label: const Text('Proceed'),
              style: FilledButton.styleFrom(
                backgroundColor: scheme.primary,
                foregroundColor: scheme.onPrimary,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
              ),
              onPressed: onProceed,
            ),
          ),
        ],
      ),
    );
  }
}
