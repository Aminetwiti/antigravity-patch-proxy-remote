import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';

/// Carte interactive de Side Question (/btw) inspirée d'AG2R
class SideQuestionCard extends StatefulWidget {
  final String question;
  final String? answer;
  final bool isLoading;
  final VoidCallback onClose;

  const SideQuestionCard({
    super.key,
    required this.question,
    this.answer,
    this.isLoading = false,
    required this.onClose,
  });

  @override
  State<SideQuestionCard> createState() => _SideQuestionCardState();
}

class _SideQuestionCardState extends State<SideQuestionCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: scheme.primary.withValues(alpha: isDark ? 0.5 : 0.4),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.3)
                : Colors.black.withValues(alpha: 0.06),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _isExpanded = !_isExpanded);
            },
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Icon(Icons.help_outline, size: 14, color: scheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Side Question: ${widget.question}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (widget.isLoading) ...[
                    SizedBox(
                      width: 10,
                      height: 10,
                      child: CircularProgressIndicator(strokeWidth: 1.5, color: scheme.primary),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Icon(
                    _isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                    size: 16,
                    color: scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  GestureDetector(
                    onTap: widget.onClose,
                    child: Icon(Icons.close, size: 14, color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
                  ),
                ],
              ),
            ),
          ),

          // Answer section (when expanded)
          if (_isExpanded) ...[
            Divider(height: 1, color: scheme.outlineVariant),
            Padding(
              padding: const EdgeInsets.all(12),
              child: widget.answer != null && widget.answer!.isNotEmpty
                  ? Text(
                      widget.answer!,
                      style: TextStyle(
                        fontSize: 12.5,
                        color: scheme.onSurface,
                        height: 1.4,
                      ),
                    )
                  : Text(
                      'En attente de la réponse à la question parallèle...',
                      style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
            ),
          ],
        ],
      ),
    );
  }
}
