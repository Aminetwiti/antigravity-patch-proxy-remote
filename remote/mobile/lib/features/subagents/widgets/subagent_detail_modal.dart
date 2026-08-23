import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/protocol/daemon_api.dart';
import '../../../core/protocol/messages.dart';
import '../../../theme/app_colors.dart';
import '../../../widgets/antigravity_spinning_arc.dart';
import '../../../widgets/markdown_bubble.dart';
import '../../../widgets/unified_diff_viewer.dart';
import '../../chat_stream/widgets/session_review_view.dart';
import '../models/subagent_item.dart';

/// Modal affichant la vue détaillée et la session d'un sous-agent.
/// Reproduit fidèlement le design Antigravity IDE (Screenshot 2) :
/// - Breadcrumb en en-tête : Project / Session / Status + Role
/// - Bulle de prompt mission initiale
/// - Chronologie de réflexion / "Worked for 20s >"
/// - Réponse Markdown de l'assistant
/// - Résumé des fichiers modifiés avec bouton [Review]
/// - Barre inférieure désactivée : "Cannot send message to subagent."
class SubagentDetailModal extends StatefulWidget {
  final SubagentItem agent;
  final DaemonApi? api;
  final String? cascadeId;
  final String? projectName;
  final String? sessionTitle;
  final VoidCallback? onKill;

  const SubagentDetailModal({
    super.key,
    required this.agent,
    this.api,
    this.cascadeId,
    this.projectName,
    this.sessionTitle,
    this.onKill,
  });

  static Future<void> show(
    BuildContext context, {
    required SubagentItem agent,
    DaemonApi? api,
    String? cascadeId,
    String? projectName,
    String? sessionTitle,
    VoidCallback? onKill,
  }) {
    HapticFeedback.selectionClick();
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SubagentDetailModal(
        agent: agent,
        api: api,
        cascadeId: cascadeId,
        projectName: projectName,
        sessionTitle: sessionTitle,
        onKill: onKill,
      ),
    );
  }

  @override
  State<SubagentDetailModal> createState() => _SubagentDetailModalState();
}

class _SubagentDetailModalState extends State<SubagentDetailModal> {
  List<ChatMessage> _messages = [];
  bool _isLoadingHistory = true;
  List<SessionModifiedFile> _modifiedFiles = [];
  bool _isTimelineExpanded = false;
  bool _feedbackGiven = false;

  @override
  void initState() {
    super.initState();
    _loadSubagentHistory();
    _loadModifiedFiles();
  }

  Future<void> _loadSubagentHistory() async {
    if (widget.api == null || widget.agent.id.isEmpty) {
      if (mounted) setState(() => _isLoadingHistory = false);
      return;
    }
    try {
      final history = await widget.api!.getSessionHistory(widget.agent.id);
      final rawMessages = history['messages'] as List?;
      if (rawMessages != null && rawMessages.isNotEmpty && mounted) {
        final parsed = <ChatMessage>[];
        for (final m in rawMessages) {
          if (m is Map) {
            parsed.add(ChatMessage(
              id: m['id']?.toString() ?? '',
              sender: m['sender']?.toString() ?? 'assistant',
              text: m['text']?.toString() ?? '',
              thought: m['thought']?.toString(),
              timestamp: m['timestamp']?.toString() ?? '',
              stepIndex: (m['stepIndex'] as num?)?.toInt(),
            ));
          }
        }
        setState(() {
          _messages = parsed;
          _isLoadingHistory = false;
        });
      } else if (mounted) {
        setState(() => _isLoadingHistory = false);
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingHistory = false);
    }
  }

  Future<void> _loadModifiedFiles() async {
    if (widget.api == null || widget.agent.id.isEmpty) return;
    try {
      final ctx = await widget.api!.getContext(cascadeId: widget.agent.id);
      final rawFiles = ctx['modifiedFiles'] as List?;
      if (rawFiles != null && mounted) {
        final list = <SessionModifiedFile>[];
        for (final item in rawFiles) {
          if (item is! String || item.isEmpty) continue;
          var clean = item.replaceAll('\\', '/');
          if (clean.startsWith('file:///')) clean = clean.substring(8);
          if (clean.startsWith('file://')) clean = clean.substring(7);
          list.add(SessionModifiedFile(
            path: clean,
            additions: 1,
            deletions: 0,
          ));
        }
        setState(() => _modifiedFiles = list);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isRunning = widget.agent.status.toLowerCase() == 'running';
    final isErrored = widget.agent.status.toLowerCase() == 'errored' ||
        widget.agent.status.toLowerCase() == 'canceling';

    final project = widget.projectName?.isNotEmpty == true
        ? widget.projectName!
        : 'antigravity-add-model-main';
    final session = widget.sessionTitle?.isNotEmpty == true
        ? widget.sessionTitle!
        : 'Session';

    // Trouver le prompt et les messages assistants
    final userPrompt = widget.agent.prompt?.isNotEmpty == true
        ? widget.agent.prompt!
        : (_messages.where((m) => m.sender == 'user').firstOrNull?.text ?? '');
    final assistantMessages = _messages.where((m) => m.sender == 'assistant').toList();
    final latestAssistant = assistantMessages.isNotEmpty ? assistantMessages.last : null;

    final thoughtText = latestAssistant?.thought ?? widget.agent.stateDetail ?? '';
    final assistantText = latestAssistant?.text ?? '';

    final totalAdditions = _modifiedFiles.fold<int>(0, (int sum, SessionModifiedFile f) => sum + f.additions);
    final totalDeletions = _modifiedFiles.fold<int>(0, (int sum, SessionModifiedFile f) => sum + f.deletions);

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.90,
      ),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceBase : scheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle bar
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10, bottom: 6),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: scheme.outlineVariant.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Top Breadcrumb Header (Screenshot 2: project / session / (icon) Subagent Role)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(),
                      child: Row(
                        children: [
                          Text(
                            project,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                            child: Text(
                              '/',
                              style: TextStyle(
                                fontSize: 12.5,
                                color: isDark ? AppColors.inkMuted.withValues(alpha: 0.5) : scheme.outlineVariant,
                              ),
                            ),
                          ),
                          Text(
                            session,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                            child: Text(
                              '/',
                              style: TextStyle(
                                fontSize: 12.5,
                                color: isDark ? AppColors.inkMuted.withValues(alpha: 0.5) : scheme.outlineVariant,
                              ),
                            ),
                          ),
                          if (isRunning)
                            Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: AntigravitySpinningArc(
                                color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                                size: 12.5,
                              ),
                            )
                          else if (isErrored)
                            const Padding(
                              padding: EdgeInsets.only(right: 6),
                              child: Icon(Icons.error_outline_rounded, size: 14, color: AppColors.danger),
                            )
                          else
                            const Padding(
                              padding: EdgeInsets.only(right: 6),
                              child: Icon(Icons.check_circle_outline_rounded, size: 14, color: AppColors.positive),
                            ),
                          Text(
                            widget.agent.role,
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    padding: EdgeInsets.zero,
                    color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            Divider(
              height: 1,
              thickness: 1,
              color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.3),
            ),

            // Scrollable conversation stream
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Conversation / Subagent ID Card
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.fingerprint_rounded, size: 16, color: scheme.onSurfaceVariant),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'ID DU SOUS-AGENT',
                                  style: TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.5,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  widget.agent.id.isNotEmpty ? widget.agent.id : '(Généré à l\'exécution)',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                    fontWeight: FontWeight.w600,
                                    color: scheme.onSurface,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          if (widget.agent.id.isNotEmpty)
                            IconButton(
                              icon: const Icon(Icons.copy_rounded, size: 16),
                              tooltip: 'Copier l\'ID',
                              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: widget.agent.id));
                                HapticFeedback.selectionClick();
                              },
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Flexible(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: widget.agent.inheritCustomizations
                                  ? (isDark ? const Color(0xFF16251E) : scheme.surfaceContainerHighest)
                                  : (isDark ? const Color(0xFF222630) : scheme.surfaceContainer),
                              borderRadius: BorderRadius.circular(AppRadius.pill),
                              border: Border.all(
                                color: widget.agent.inheritCustomizations
                                    ? AppColors.positive.withValues(alpha: 0.4)
                                    : scheme.outlineVariant,
                                width: 0.8,
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  widget.agent.inheritCustomizations
                                      ? Icons.auto_awesome_rounded
                                      : Icons.shield_outlined,
                                  size: 12,
                                  color: widget.agent.inheritCustomizations
                                      ? AppColors.positive
                                      : scheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 5),
                                Flexible(
                                  child: Text(
                                    widget.agent.inheritCustomizations
                                        ? 'inheritCustomizations: true (Skills & Rules héritées)'
                                        : 'inheritCustomizations: false (Isolé)',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                      color: widget.agent.inheritCustomizations
                                          ? AppColors.positive
                                          : scheme.onSurfaceVariant,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 14),

                    // 1. User Prompt Bubble (Mission from parent agent)
                    if (userPrompt.isNotEmpty) ...[
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Mission / Instructions',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          TextButton.icon(
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: userPrompt));
                              HapticFeedback.selectionClick();
                            },
                            icon: const Icon(Icons.copy_rounded, size: 13),
                            label: const Text('Copier Mission', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                          ),
                        ),
                        child: SelectableText(
                          userPrompt,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.45,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // 2. Timeline / "Worked for 20s >" Collapsible Badge
                    InkWell(
                      onTap: () {
                        HapticFeedback.selectionClick();
                        setState(() => _isTimelineExpanded = !_isTimelineExpanded);
                      },
                      borderRadius: BorderRadius.circular(6),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              widget.agent.displayWorkedFor,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                              _isTimelineExpanded
                                  ? Icons.keyboard_arrow_up_rounded
                                  : Icons.chevron_right_rounded,
                              size: 15,
                              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            ),
                          ],
                        ),
                      ),
                    ),

                    if (_isTimelineExpanded && thoughtText.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4),
                          ),
                        ),
                        child: SelectableText(
                          thoughtText,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontFamily: 'monospace',
                            height: 1.4,
                            color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: 12),

                    // 3. Assistant Output / Messages
                    if (_isLoadingHistory && assistantText.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      )
                    else if (assistantMessages.isNotEmpty)
                      for (final m in assistantMessages) ...[
                        if (m.text.isNotEmpty)
                          MarkdownBubble(
                            text: m.text,
                            api: widget.api,
                            workspacePath: project,
                          ),
                        const SizedBox(height: 12),
                      ]
                    else if (assistantText.isNotEmpty) ...[
                      MarkdownBubble(
                        text: assistantText,
                        api: widget.api,
                        workspacePath: project,
                      ),
                      const SizedBox(height: 12),
                    ] else ...[
                      Text(
                        isRunning ? 'En cours d\'exécution...' : 'Sous-agent terminé avec succès.',
                        style: TextStyle(
                          fontSize: 13,
                          color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],

                    // 4. File changes & Review Action (Screenshot 2: "1 file changed +14 -7 > [Review]")
                    if (_modifiedFiles.isNotEmpty) ...[
                      Container(
                        margin: const EdgeInsets.only(top: 8, bottom: 12),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                          ),
                        ),
                        child: Row(
                          children: [
                            Text(
                              '${_modifiedFiles.length} file${_modifiedFiles.length > 1 ? 's' : ''} changed',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              '+$totalAdditions',
                              style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF4ADE80),
                              ),
                            ),
                            Text(
                              ' -$totalDeletions',
                              style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFFF87171),
                              ),
                            ),
                            const Spacer(),
                            Semantics(
                              label: 'Ouvrir la revue du code',
                              button: true,
                              child: InkWell(
                                onTap: () {
                                  HapticFeedback.selectionClick();
                                  showModalBottomSheet(
                                    context: context,
                                    isScrollControlled: true,
                                    backgroundColor: Colors.transparent,
                                    builder: (ctx) => FractionallySizedBox(
                                      heightFactor: 0.9,
                                      child: UnifiedDiffViewer(
                                        diffContent: _modifiedFiles.map((SessionModifiedFile f) => f.diffContent ?? '').join('\n'),
                                        fileName: _modifiedFiles.first.path,
                                        onClose: () => Navigator.of(ctx).pop(),
                                      ),
                                    ),
                                  );
                                },
                                borderRadius: BorderRadius.circular(6),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: scheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.rate_review_outlined, size: 14, color: scheme.primary),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Review',
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          fontWeight: FontWeight.w600,
                                          color: scheme.primary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // 5. Feedback and Copy Actions
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.copy_rounded, size: 15),
                          tooltip: 'Copier la réponse',
                          color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          onPressed: () {
                            HapticFeedback.selectionClick();
                            Clipboard.setData(ClipboardData(text: assistantText.isNotEmpty ? assistantText : userPrompt));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Copié dans le presse-papiers'),
                                duration: Duration(seconds: 1),
                              ),
                            );
                          },
                        ),
                        const SizedBox(width: 4),
                        IconButton(
                          icon: Icon(
                            _feedbackGiven ? Icons.thumb_up_alt_rounded : Icons.thumb_up_alt_outlined,
                            size: 15,
                          ),
                          tooltip: 'Utile',
                          color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          onPressed: () {
                            HapticFeedback.lightImpact();
                            setState(() => _feedbackGiven = true);
                          },
                        ),
                        IconButton(
                          icon: const Icon(Icons.thumb_down_alt_outlined, size: 15),
                          tooltip: 'Pas utile',
                          color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          onPressed: () => HapticFeedback.lightImpact(),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // Bottom Input Area (Screenshot 2: Centered disabled "Cannot send message to subagent.")
            Container(
              margin: const EdgeInsets.fromLTRB(16, 6, 16, 12),
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(AppRadius.lg),
                border: Border.all(
                  color: isDark
                      ? AppColors.borderSubtle
                      : scheme.outlineVariant.withValues(alpha: 0.5),
                ),
              ),
              child: Center(
                child: Text(
                  'Cannot send message to subagent.',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant.withValues(alpha: 0.7),
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

