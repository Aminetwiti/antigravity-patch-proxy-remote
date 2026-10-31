import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/protocol/daemon_api.dart';

/// Boîte de dialogue pour créer un commit Git avec génération automatique par IA.
class GitCommitDialog extends StatefulWidget {
  final DaemonApi? api;
  final String workspacePath;
  final ValueChanged<String>? onCommitted;

  const GitCommitDialog({
    super.key,
    required this.api,
    this.workspacePath = '.',
    this.onCommitted,
  });

  static Future<String?> show(
    BuildContext context, {
    required DaemonApi? api,
    String workspacePath = '.',
  }) {
    return showDialog<String>(
      context: context,
      builder: (ctx) => GitCommitDialog(
        api: api,
        workspacePath: workspacePath,
        onCommitted: (msg) => Navigator.of(ctx).pop(msg),
      ),
    );
  }

  @override
  State<GitCommitDialog> createState() => _GitCommitDialogState();
}

class _GitCommitDialogState extends State<GitCommitDialog> {
  final TextEditingController _controller = TextEditingController();
  bool _isGenerating = false;
  bool _isCommitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _generateMessage() async {
    if (widget.api == null) return;
    setState(() {
      _isGenerating = true;
      _errorMessage = null;
    });
    HapticFeedback.selectionClick();

    try {
      final msg = await widget.api!.generateCommitMessage();
      if (!mounted) return;
      if (msg.isNotEmpty) {
        setState(() {
          _controller.text = msg;
          _isGenerating = false;
        });
        HapticFeedback.mediumImpact();
      } else {
        setState(() {
          _errorMessage = 'Aucune modification indexée ou message vide.';
          _isGenerating = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');
        _isGenerating = false;
      });
    }
  }

  void _submit() {
    if (_isCommitting) return;
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _isCommitting = true);
    HapticFeedback.mediumImpact();
    widget.onCommitted?.call(text);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final hasTightKeyboard = MediaQuery.of(context).viewInsets.bottom > 150 && MediaQuery.of(context).size.height < 450;

    return AlertDialog(
      scrollable: true,
      insetPadding: EdgeInsets.symmetric(horizontal: 16, vertical: hasTightKeyboard ? 4 : 16),
      backgroundColor: scheme.surfaceContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant, width: 0.8),
      ),
      titlePadding: EdgeInsets.fromLTRB(16, hasTightKeyboard ? 8 : 18, 16, hasTightKeyboard ? 6 : 10),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      actionsPadding: EdgeInsets.fromLTRB(16, hasTightKeyboard ? 6 : 10, 16, hasTightKeyboard ? 8 : 16),
      actionsOverflowButtonSpacing: 8,
      actionsOverflowDirection: VerticalDirection.down,
      title: Row(
        children: [
          Icon(Icons.commit_outlined, size: 20, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Créer un commit Git',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: scheme.onSurface,
              ),
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Rédigez ou générez automatiquement un message de commit concis.',
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _controller,
              maxLines: 4,
              minLines: 2,
              style: const TextStyle(fontSize: 13),
              decoration: InputDecoration(
                hintText: 'feat: message de commit...',
                filled: true,
                fillColor: scheme.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: scheme.outlineVariant),
                ),
                contentPadding: const EdgeInsets.all(12),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              children: [
                OutlinedButton.icon(
                  onPressed: _isGenerating || _isCommitting ? null : _generateMessage,
                  icon: _isGenerating
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.auto_awesome_rounded, size: 16),
                  label: Text(_isGenerating ? 'Génération...' : 'Générer avec l\'IA'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: scheme.error.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, size: 14, color: scheme.error),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _errorMessage!,
                        style: TextStyle(fontSize: 11, color: scheme.error),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.end,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              onPressed: _isCommitting ? null : () => Navigator.of(context).pop(),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              onPressed: _isCommitting ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: scheme.primary,
                foregroundColor: scheme.onPrimary,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
              child: _isCommitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Valider le Commit'),
            ),
          ],
        ),
      ],
    );
  }
}
