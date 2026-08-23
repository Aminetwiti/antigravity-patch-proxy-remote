import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';

/// Carte d'erreur de l'agent Antigravity conforme 1:1 à l'interface Desktop.
/// Affiche le titre de l'erreur avec chevron dépliable, l'Error ID copiable
/// et les détails techniques de terminaison.
class AgentErrorCard extends StatefulWidget {
  final String errorText;
  final String? title;
  final VoidCallback? onRetry;

  const AgentErrorCard({
    super.key,
    required this.errorText,
    this.title,
    this.onRetry,
  });

  @override
  State<AgentErrorCard> createState() => _AgentErrorCardState();
}

class _AgentErrorCardState extends State<AgentErrorCard> {
  bool _expanded = true;
  bool _copied = false;

  String? _extractErrorId(String text) {
    final match = RegExp(r'(?:error\s*id|id):\s*([a-zA-Z0-9_-]+)', caseSensitive: false).firstMatch(text);
    return match?.group(1);
  }

  String _cleanErrorTitle(String text) {
    if (widget.title != null && widget.title!.isNotEmpty) {
      return widget.title!;
    }
    final lower = text.toLowerCase();
    if (lower.contains('individual quota reached')) {
      final resetMatch = RegExp(r'(?:resets in|refresh on)\s+([0-9a-zA-Z\s/:\-]+?)(?:\.|\n|$)', caseSensitive: false).firstMatch(text);
      if (resetMatch != null) {
        return 'Error Individual quota reached (Resets in ${resetMatch.group(1)?.trim()})';
      }
      return 'Error Individual quota reached';
    }
    if (lower.contains('baseline model quota reached')) {
      return 'Baseline model quota reached';
    }
    if (lower.contains('quota exceeded') || lower.contains('insufficient_quota')) {
      return 'Error: Quota exceeded';
    }
    final firstLine = text.trim().split('\n').first;
    if (firstLine.isNotEmpty && firstLine.length < 80) {
      return firstLine;
    }
    return 'Error: Agent execution terminated';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final errorId = _extractErrorId(widget.errorText);
    final title = _cleanErrorTitle(widget.errorText);

    final errorBg = isDark
        ? const Color(0xFF1E1414)
        : scheme.errorContainer.withValues(alpha: 0.25);
    final errorBorder = isDark
        ? const Color(0xFF442424)
        : scheme.error.withValues(alpha: 0.35);
    final errorTextColor = isDark
        ? const Color(0xFFF87171)
        : scheme.error;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: errorBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: errorBorder, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // En-tête dépliable
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _expanded = !_expanded);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(
                    Icons.error_outline_rounded,
                    size: 16,
                    color: errorTextColor,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: errorTextColor,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(
                    _expanded ? Icons.keyboard_arrow_down_rounded : Icons.chevron_right_rounded,
                    size: 18,
                    color: errorTextColor.withValues(alpha: 0.8),
                  ),
                ],
              ),
            ),
          ),

          // Contenu étendu : Error ID + Détails + Actions
          if (_expanded) ...[
            Divider(height: 1, color: errorBorder.withValues(alpha: 0.6)),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (errorId != null) ...[
                    Row(
                      children: [
                        Text(
                          'Error ID: ',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: isDark ? const Color(0xFF9E9E9E) : scheme.onSurfaceVariant,
                          ),
                        ),
                        SelectableText(
                          errorId,
                          style: TextStyle(
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: isDark ? const Color(0xFFE0E0E0) : scheme.onSurface,
                          ),
                        ),
                        const SizedBox(width: 6),
                        InkWell(
                          borderRadius: BorderRadius.circular(4),
                          onTap: () {
                            Clipboard.setData(ClipboardData(text: errorId));
                            HapticFeedback.lightImpact();
                            setState(() => _copied = true);
                            Future.delayed(const Duration(seconds: 2), () {
                              if (mounted) setState(() => _copied = false);
                            });
                          },
                          child: Padding(
                            padding: const EdgeInsets.all(3),
                            child: Icon(
                              _copied ? Icons.check_rounded : Icons.copy_rounded,
                              size: 13,
                              color: _copied ? AppColors.positive : (isDark ? const Color(0xFF888888) : scheme.outline),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                  ],
                  SelectableText(
                    widget.errorText.trim(),
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.4,
                      color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurface,
                    ),
                  ),
                  if (widget.onRetry != null) ...[
                    const SizedBox(height: 10),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: widget.onRetry,
                        icon: const Icon(Icons.refresh_rounded, size: 14),
                        label: const Text('Réessayer', style: TextStyle(fontSize: 12)),
                        style: TextButton.styleFrom(
                          foregroundColor: errorTextColor,
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
