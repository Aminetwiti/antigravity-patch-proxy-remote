import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_colors.dart';

class ConflictDialog extends StatelessWidget {
  final String title;
  final String message;
  final String? conflictDetails;
  final String primaryButtonText;
  final VoidCallback onPrimaryAction;
  final String secondaryButtonText;
  final VoidCallback onSecondaryAction;

  const ConflictDialog({
    super.key,
    required this.title,
    required this.message,
    this.conflictDetails,
    required this.primaryButtonText,
    required this.onPrimaryAction,
    this.secondaryButtonText = 'Annuler',
    required this.onSecondaryAction,
  });

  static Future<bool?> show(
    BuildContext context, {
    required String title,
    required String message,
    String? conflictDetails,
    String primaryButtonText = 'Forcer',
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => ConflictDialog(
        title: title,
        message: message,
        conflictDetails: conflictDetails,
        primaryButtonText: primaryButtonText,
        onPrimaryAction: () => Navigator.of(context).pop(true),
        onSecondaryAction: () => Navigator.of(context).pop(false),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Dialog(
      backgroundColor: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: BorderSide(color: scheme.outlineVariant, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.warning_amber_rounded, color: scheme.error, size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              message,
              style: TextStyle(
                fontSize: 14,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            if (conflictDetails != null) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: scheme.outlineVariant),
                ),
                child: SingleChildScrollView(
                  child: Text(
                    conflictDetails!,
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    onSecondaryAction();
                  },
                  child: Text(
                    secondaryButtonText,
                    style: TextStyle(
                      color: scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: () {
                    HapticFeedback.mediumImpact();
                    onPrimaryAction();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: scheme.error,
                    foregroundColor: scheme.onError,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                  ),
                  child: Text(
                    primaryButtonText,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
