import 'package:flutter/material.dart';
import '../models/code_comment.dart';
import 'package:mobile/theme/app_colors.dart';

class AddCommentDialog extends StatefulWidget {
  final String filePath;
  final String selectedSnippet;
  final ValueChanged<CodeComment> onCommentAdded;
  final String? initialComment;
  final VoidCallback? onDelete;
  final int? lineNumber;

  const AddCommentDialog({
    super.key,
    required this.filePath,
    required this.selectedSnippet,
    required this.onCommentAdded,
    this.initialComment,
    this.onDelete,
    this.lineNumber,
  });

  @override
  State<AddCommentDialog> createState() => _AddCommentDialogState();
}

class _AddCommentDialogState extends State<AddCommentDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialComment ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;

    final comment = CodeComment(
      id: 'comment_${DateTime.now().millisecondsSinceEpoch}',
      filePath: widget.filePath,
      snippet: widget.selectedSnippet,
      commentText: text,
      lineNumber: widget.lineNumber,
    );

    widget.onCommentAdded(comment);
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDialog = ModalRoute.of(context) is DialogRoute || ModalRoute.of(context) is PopupRoute;

    final content = Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 480),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
          // Header
          Row(
            children: [
              Icon(Icons.mode_comment_outlined, size: 18, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Add Comment',
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (widget.lineNumber != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Text(
                    'Ligne ${widget.lineNumber}',
                    style: TextStyle(
                      color: scheme.onSurfaceVariant,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            widget.filePath,
            style: TextStyle(
              color: scheme.onSurfaceVariant,
              fontSize: 12,
              fontFamily: 'monospace',
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 12),

          // Code Snippet Preview
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Text(
              widget.selectedSnippet,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: scheme.onSurfaceVariant,
              ),
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: 12),

          // Comment Input
          TextField(
            controller: _controller,
            autofocus: true,
            maxLines: 3,
            minLines: 2,
            style: TextStyle(color: scheme.onSurface, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Ajouter une instruction ou remarque...',
              hintStyle: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
              filled: true,
              fillColor: scheme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.md),
                borderSide: BorderSide(color: scheme.outlineVariant),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.md),
                borderSide: BorderSide(color: scheme.primary),
              ),
              contentPadding: const EdgeInsets.all(12),
            ),
          ),
          const SizedBox(height: 16),

          // Actions
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 8,
            runSpacing: 8,
            children: [
              if (widget.initialComment != null && widget.initialComment!.isNotEmpty && widget.onDelete != null)
                TextButton.icon(
                  onPressed: () {
                    widget.onDelete!();
                    Navigator.of(context).pop();
                  },
                  icon: const Icon(Icons.delete_outline, size: 16, color: AppColors.danger),
                  label: const Text('Supprimer', style: TextStyle(color: AppColors.danger, fontSize: 12)),
                ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(
                  'Annuler',
                  style: TextStyle(
                    color: Theme.of(context).brightness == Brightness.dark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    fontSize: 12,
                  ),
                ),
              ),
              ElevatedButton(
                onPressed: _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.accentBlue,
                  foregroundColor: AppColors.onAccent,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                ),
                child: Text(
                  widget.initialComment != null && widget.initialComment!.isNotEmpty ? 'Mettre à jour' : 'Queue Comment',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );

    return isDialog
        ? Dialog(
            backgroundColor: Colors.transparent,
            insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
            child: content,
          )
        : content;
  }
}
