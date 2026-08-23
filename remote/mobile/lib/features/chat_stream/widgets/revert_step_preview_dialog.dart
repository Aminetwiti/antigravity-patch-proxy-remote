import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';
import '../../../core/protocol/daemon_api.dart';

/// Modal de prévisualisation et confirmation de retour en arrière (Rollback / RevertToCascadeStep)
class RevertStepPreviewDialog extends StatefulWidget {
  final DaemonApi? api;
  final String cascadeId;
  final int stepIndex;
  final String stepDescription;
  final VoidCallback? onReverted;

  const RevertStepPreviewDialog({
    super.key,
    required this.api,
    required this.cascadeId,
    required this.stepIndex,
    this.stepDescription = '',
    this.onReverted,
  });

  static Future<bool?> show(
    BuildContext context, {
    required DaemonApi? api,
    required String cascadeId,
    required int stepIndex,
    String stepDescription = '',
  }) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => RevertStepPreviewDialog(
        api: api,
        cascadeId: cascadeId,
        stepIndex: stepIndex,
        stepDescription: stepDescription,
        onReverted: () => Navigator.of(ctx).pop(true),
      ),
    );
  }

  @override
  State<RevertStepPreviewDialog> createState() => _RevertStepPreviewDialogState();
}

class _RevertStepPreviewDialogState extends State<RevertStepPreviewDialog> {
  bool _isLoadingPreview = true;
  bool _isReverting = false;
  String? _previewDiff;
  List<String> _affectedFiles = [];
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  Future<void> _loadPreview() async {
    if (widget.api == null) {
      setState(() => _isLoadingPreview = false);
      return;
    }

    try {
      final res = await widget.api!.getRevertPreview(widget.cascadeId, widget.stepIndex);
      if (!mounted) return;

      final diff = res['diff'] ?? res['preview'] ?? (res['data'] is Map ? res['data']['diff'] : null);
      final files = res['affectedFiles'] ?? res['files'] ?? (res['data'] is Map ? res['data']['affectedFiles'] : null);

      setState(() {
        _isLoadingPreview = false;
        if (diff is String && diff.isNotEmpty) {
          _previewDiff = diff;
        }
        if (files is List) {
          _affectedFiles = files.map((f) => f.toString()).toList();
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingPreview = false;
        _errorMessage = 'Impossible de charger l\'aperçu: $e';
      });
    }
  }

  Future<void> _handleConfirmRevert() async {
    if (widget.api == null) {
      setState(() => _errorMessage = 'Rollback impossible en mode hors ligne.');
      return;
    }
    setState(() {
      _isReverting = true;
      _errorMessage = null;
    });
    HapticFeedback.mediumImpact();

    try {
      final success = await widget.api!.revertToStep(widget.cascadeId, widget.stepIndex);
      if (!mounted) return;

      if (success) {
        widget.onReverted?.call();
      } else {
        setState(() {
          _isReverting = false;
          _errorMessage = 'Échec du rollback. Veuillez réessayer.';
        });
      }
    } catch (e) {
      if (!mounted) return;
      final errStr = e.toString();
      String friendlyMsg = 'Erreur lors du rollback: $errStr';
      if (errStr.contains('run state not found')) {
        friendlyMsg = 'Impossible de revenir à cette étape : la session active a été réinitialisée ou a expiré de la mémoire de l\'IDE.';
      }
      setState(() {
        _isReverting = false;
        _errorMessage = friendlyMsg;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? const Color(0xFF1E2025) : Colors.white;
    final borderColor = isDark ? const Color(0xFF2E313A) : const Color(0xFFE2E4E9);
    final textPrimary = isDark ? Colors.white : const Color(0xFF18181B);
    final textSecondary = isDark ? const Color(0xFF8F909A) : const Color(0xFF71717A);

    return Dialog(
      backgroundColor: bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: BorderSide(color: borderColor, width: 1),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 520),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE5A93C).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: const Icon(
                      Icons.history_rounded,
                      color: Color(0xFFE5A93C),
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Revenir à cette étape',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: textPrimary,
                          ),
                        ),
                        Text(
                          'Étape #${widget.stepIndex + 1}${widget.stepDescription.isNotEmpty ? " • ${widget.stepDescription}" : ""}',
                          style: TextStyle(fontSize: 12, color: textSecondary),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.close, size: 18, color: textSecondary),
                    onPressed: () => Navigator.of(context).pop(false),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                'Toutes les actions, modifications de code et générations postérieures à cette étape seront annulées.',
                style: TextStyle(fontSize: 13, color: textSecondary, height: 1.4),
              ),
              const SizedBox(height: 14),
              if (_isLoadingPreview)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    ),
                  ),
                )
              else if (_errorMessage != null)
                Container(
                  padding: const EdgeInsets.all(10),
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5534B).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(color: const Color(0xFFE5534B).withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: const TextStyle(fontSize: 12, color: Color(0xFFE5534B)),
                  ),
                )
              else ...[
                if (_affectedFiles.isNotEmpty) ...[
                  Text(
                    'Fichiers impactés (${_affectedFiles.length}) :',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: textPrimary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    constraints: const BoxConstraints(maxHeight: 90),
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF141518) : const Color(0xFFF4F4F6),
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: _affectedFiles.length,
                      itemBuilder: (ctx, i) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: [
                            const Icon(Icons.description_outlined, size: 13, color: Color(0xFF8F909A)),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                _affectedFiles[i],
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: textPrimary,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                if (_previewDiff != null && _previewDiff!.isNotEmpty)
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF141518) : const Color(0xFFF4F4F6),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(color: borderColor),
                      ),
                      child: SingleChildScrollView(
                        child: _buildSyntaxHighlightedDiff(_previewDiff!, isDark),
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.end,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                runSpacing: 8,
                children: [
                  TextButton(
                    onPressed: _isReverting ? null : () => Navigator.of(context).pop(false),
                    child: Text(
                      'Annuler',
                      style: TextStyle(color: textSecondary, fontSize: 13),
                    ),
                  ),
                  ElevatedButton.icon(
                    autofocus: true,
                    onPressed: _isReverting ? null : _handleConfirmRevert,
                    icon: _isReverting
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Icon(Icons.undo_rounded, size: 16),
                    label: Text(
                      _isReverting ? 'Rollback en cours...' : 'Confirmer le rollback',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFD97706),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSyntaxHighlightedDiff(String diff, bool isDark) {
    final lines = diff.split('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: lines.map((line) {
        Color lineBg = Colors.transparent;
        Color textColor = isDark ? const Color(0xFFD4D4D8) : const Color(0xFF27272A);
        if (line.startsWith('+') && !line.startsWith('+++')) {
          textColor = isDark ? const Color(0xFF4ADE80) : const Color(0xFF16A34A);
          lineBg = (isDark ? const Color(0xFF4ADE80) : const Color(0xFF16A34A)).withValues(alpha: 0.12);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          textColor = isDark ? const Color(0xFFF87171) : const Color(0xFFDC2626);
          lineBg = (isDark ? const Color(0xFFF87171) : const Color(0xFFDC2626)).withValues(alpha: 0.12);
        } else if (line.startsWith('@@')) {
          textColor = isDark ? const Color(0xFF60A5FA) : const Color(0xFF2563EB);
          lineBg = (isDark ? const Color(0xFF60A5FA) : const Color(0xFF2563EB)).withValues(alpha: 0.08);
        }

        return Container(
          width: double.infinity,
          color: lineBg,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
          child: Text(
            line,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              height: 1.35,
              color: textColor,
            ),
          ),
        );
      }).toList(),
    );
  }
}
