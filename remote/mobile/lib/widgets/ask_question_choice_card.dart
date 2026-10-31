import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/protocol/messages.dart';
import '../features/chat_stream/models/question_choice.dart';
import '../theme/app_spacing.dart';

/// Carte interactive permettant de répondre aux questions posées par l'agent (AskQuestion).
/// Inspiré des fonctionnalités de choix interactifs d'AG2R.
class AskQuestionChoiceCard extends StatefulWidget {
  final QuestionChoicePayload? payload;
  final AskQuestionChoiceRequest? request;
  final Function? onSubmit;
  final VoidCallback? onDismiss;
  final Function(String reason)? onReject;
  final String? submitButtonText;

  const AskQuestionChoiceCard({
    super.key,
    this.payload,
    this.request,
    this.onSubmit,
    this.onDismiss,
    this.onReject,
    this.submitButtonText,
  }) : assert(payload != null || request != null,
            'Either payload or request must be provided');

  @override
  State<AskQuestionChoiceCard> createState() => _AskQuestionChoiceCardState();
}

class _AskQuestionChoiceCardState extends State<AskQuestionChoiceCard> {
  final Set<String> _selectedOptions = {};
  final TextEditingController _customController = TextEditingController();
  bool _isSubmitting = false;

  String get _question =>
      widget.payload?.question ?? widget.request?.question ?? '';

  List<String> get _options =>
      widget.payload?.options ?? widget.request?.options ?? const [];

  bool get _isMultiSelect =>
      widget.payload?.isMultiSelect ?? widget.request?.isMultiSelect ?? false;

  bool get _allowCustom => widget.request?.allowCustom ?? true;

  String get _submitLabel {
    if (_isSubmitting) return 'Sending...';
    if (widget.submitButtonText != null) return widget.submitButtonText!;
    if (widget.payload != null) return 'Submit Answer';
    return 'Submit Choice';
  }

  @override
  void initState() {
    super.initState();
    if (widget.payload != null && widget.payload!.selectedOptions.isNotEmpty) {
      _selectedOptions.addAll(widget.payload!.selectedOptions);
    } else if (!_isMultiSelect && _options.isNotEmpty) {
      final first = _options.first;
      if (first.toLowerCase().contains('recommended')) {
        _selectedOptions.add(first);
      }
    }
  }

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

  void _toggleOption(String option) {
    HapticFeedback.selectionClick();
    setState(() {
      if (_isMultiSelect) {
        if (_selectedOptions.contains(option)) {
          _selectedOptions.remove(option);
        } else {
          _selectedOptions.add(option);
        }
      } else {
        _selectedOptions.clear();
        _selectedOptions.add(option);
      }
    });
  }

  bool get _canSubmit {
    return _selectedOptions.isNotEmpty ||
        _customController.text.trim().isNotEmpty;
  }

  void _handleSubmit() async {
    if (!_canSubmit || _isSubmitting) return;
    HapticFeedback.lightImpact();
    setState(() => _isSubmitting = true);

    try {
      final custom = _customController.text.trim();
      final selectedList = _selectedOptions.toList();
      final customOrNull = custom.isNotEmpty ? custom : null;

      if (widget.onSubmit != null) {
        if (widget.onSubmit is void Function(QuestionChoicePayload)) {
          final resultPayload = (widget.payload ??
                  QuestionChoicePayload(
                    toolCallId: widget.request?.requestId ?? '',
                    question: widget.request?.question ?? '',
                    options: widget.request?.options ?? [],
                    isMultiSelect: widget.request?.isMultiSelect ?? false,
                  ))
              .copyWith(
            selectedOptions: selectedList,
            customResponse: custom,
          );
          (widget.onSubmit as void Function(QuestionChoicePayload))(
              resultPayload);
        } else if (widget.onSubmit is void Function(
            List<String>, String?)) {
          (widget.onSubmit as void Function(List<String>, String?))(
            selectedList,
            customOrNull,
          );
        } else {
          try {
            if (widget.payload != null) {
              final resultPayload = widget.payload!.copyWith(
                selectedOptions: selectedList,
                customResponse: custom,
              );
              Function.apply(widget.onSubmit!, [resultPayload]);
            } else {
              Function.apply(widget.onSubmit!, [selectedList, customOrNull]);
            }
          } catch (_) {
            try {
              final resultPayload = (widget.payload ??
                      QuestionChoicePayload(
                        toolCallId: widget.request?.requestId ?? '',
                        question: widget.request?.question ?? '',
                        options: widget.request?.options ?? [],
                        isMultiSelect:
                            widget.request?.isMultiSelect ?? false,
                      ))
                  .copyWith(
                selectedOptions: selectedList,
                customResponse: custom,
              );
              Function.apply(widget.onSubmit!, [resultPayload]);
            } catch (_) {
              Function.apply(widget.onSubmit!, [selectedList, customOrNull]);
            }
          }
        }
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
      padding: AppSpacing.edgeInsetsA16,
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: AppSpacing.borderRadiusLg,
        border: Border.all(
          color: scheme.primary.withValues(alpha: 0.4),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // En-tête avec icône d'interrogation
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: AppSpacing.edgeInsetsA4,
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.15),
                  borderRadius: AppSpacing.borderRadiusMd,
                ),
                child: Icon(
                  Icons.help_outline_rounded,
                  color: scheme.primary,
                  size: 20,
                ),
              ),
              AppSpacing.hGap10,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AGENT CLARIFICATION',
                      style: TextStyle(
                        color: scheme.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                      ),
                    ),
                    AppSpacing.vGap4,
                    Text(
                      _question,
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          AppSpacing.vGap14,

          // Liste des options sous forme de cartes/chips cliquables
          if (_options.isNotEmpty) ...[
            ..._options.asMap().entries.map((entry) {
              final index = entry.key + 1;
              final option = entry.value;
              final isSelected = _selectedOptions.contains(option);
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: InkWell(
                  onTap: () => _toggleOption(option),
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? scheme.primary.withValues(alpha: 0.15)
                          : scheme.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isSelected
                            ? scheme.primary
                            : scheme.outlineVariant,
                        width: isSelected ? 1.4 : 1.0,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 20,
                          height: 20,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: isSelected
                                ? scheme.primary
                                : scheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            '$index',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: isSelected ? scheme.onPrimary : scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            option,
                            style: TextStyle(
                              color: isSelected
                                  ? scheme.onSurface
                                  : scheme.onSurfaceVariant,
                              fontSize: 13,
                              fontWeight: isSelected
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                          ),
                        ),
                        if (_isMultiSelect)
                          Icon(
                            isSelected
                                ? Icons.check_box_rounded
                                : Icons.check_box_outline_blank_rounded,
                            color: isSelected
                                ? scheme.primary
                                : scheme.outline,
                            size: 18,
                          ),
                      ],
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: 4),
          ],

          // Champ de réponse personnalisée (write-in)
          if (_allowCustom) ...[
            TextField(
              controller: _customController,
              onChanged: (_) => setState(() {}),
              style: TextStyle(color: scheme.onSurface, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Autre (écrire votre réponse)...',
                hintStyle: TextStyle(color: scheme.outline, fontSize: 12),
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 10),
                filled: true,
                fillColor: scheme.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: scheme.outlineVariant),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: scheme.outlineVariant),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: scheme.primary),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Boutons d'action (Skip & Submit)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.end,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton(
                onPressed: !_isSubmitting
                    ? () {
                        HapticFeedback.selectionClick();
                        _customController.text = 'skip';
                        _handleSubmit();
                      }
                    : null,
                style: TextButton.styleFrom(
                  foregroundColor: scheme.outline,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                ),
                child: const Text(
                  'Skip',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                ),
              ),
              ElevatedButton.icon(
                key: const Key('submit-question-response'),
                onPressed:
                    _canSubmit && !_isSubmitting ? _handleSubmit : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: scheme.primary,
                  foregroundColor: scheme.onPrimary,
                  disabledBackgroundColor: scheme.surfaceContainerHighest,
                  disabledForegroundColor: scheme.outline,
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  elevation: 0,
                ),
                icon: _isSubmitting
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_rounded, size: 14),
                label: Text(
                  _submitLabel,
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
