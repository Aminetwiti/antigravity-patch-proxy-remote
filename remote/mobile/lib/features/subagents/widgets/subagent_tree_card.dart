import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';
import '../../../widgets/antigravity_spinning_arc.dart';
import '../models/subagent_item.dart';
import 'subagent_detail_modal.dart';

/// Carte visuelle affichant les sous-agents en temps réel (dockée au-dessus de la saisie).
/// Reproduit fidèlement le design Antigravity IDE ("1 subagent running  v" avec spinning arc).
class SubagentTreeCard extends StatefulWidget {
  final List<SubagentItem> subagents;
  final String? title;
  final String? projectName;
  final String? sessionTitle;
  final VoidCallback? onOpenFullTree;
  final ValueChanged<SubagentItem>? onSelectSubagent;
  final bool initiallyExpanded;
  final bool onlyRunning;

  const SubagentTreeCard({
    super.key,
    required this.subagents,
    this.title,
    this.projectName,
    this.sessionTitle,
    this.onOpenFullTree,
    this.onSelectSubagent,
    this.initiallyExpanded = false,
    this.onlyRunning = false,
  });

  @override
  State<SubagentTreeCard> createState() => _SubagentTreeCardState();
}

class _SubagentTreeCardState extends State<SubagentTreeCard> {
  late bool _isExpanded;
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Si onlyRunning est activé, on ne conserve que les sous-agents en cours d'exécution
    final displaySubagents = widget.onlyRunning
        ? widget.subagents
            .where((s) => s.status.toLowerCase() == 'running')
            .toList()
        : widget.subagents;

    if (displaySubagents.isEmpty) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final count = displaySubagents.length;
    final runningCount = displaySubagents
        .where((s) => s.status.toLowerCase() == 'running')
        .length;
    final statusText = runningCount > 0
        ? (runningCount == 1 ? '1 running' : '$runningCount running')
        : (count == 1 ? '1 completed' : '$count subagents');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: isDark
              ? AppColors.borderSubtle
              : scheme.outlineVariant.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header Bar: "Subagents   2   1 running   v"
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _isExpanded = !_isExpanded);
            },
            borderRadius: BorderRadius.vertical(
              top: const Radius.circular(AppRadius.lg),
              bottom: _isExpanded
                  ? Radius.zero
                  : const Radius.circular(AppRadius.lg),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Text(
                    widget.title ?? 'Subagents',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: isDark
                          ? AppColors.surfaceHover
                          : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Text(
                      '$count',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: isDark
                            ? AppColors.inkSecondary
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  if (runningCount > 0) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: isDark
                            ? AppColors.accentBlue.withValues(alpha: 0.15)
                            : scheme.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        statusText,
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppColors.accentBlueBright
                              : scheme.primary,
                        ),
                      ),
                    ),
                  ],
                  const Spacer(),
                  if (widget.onOpenFullTree != null) ...[
                    IconButton(
                      icon: const Icon(Icons.open_in_new, size: 14),
                      onPressed: widget.onOpenFullTree,
                      tooltip: 'Ouvrir le DAG complet',
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 24, minHeight: 24),
                      color:
                          isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                  ],
                  Icon(
                    _isExpanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 16,
                    color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),

          // Subagents List - Collapsible & Scrollable
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            child: _isExpanded
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Divider(
                        height: 1,
                        thickness: 1,
                        color: isDark
                            ? AppColors.borderSubtle
                            : scheme.outlineVariant.withValues(alpha: 0.3),
                      ),
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: count > 2 ? 160 : 240,
                        ),
                        child: Scrollbar(
                          controller: _scrollController,
                          thumbVisibility: count > 2,
                          radius: const Radius.circular(4),
                          thickness: 3,
                          child: ListView.separated(
                            controller: _scrollController,
                            shrinkWrap: true,
                            physics: count > 2
                                ? const BouncingScrollPhysics(
                                    parent: AlwaysScrollableScrollPhysics(),
                                  )
                                : const NeverScrollableScrollPhysics(),
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            itemCount: displaySubagents.length,
                            separatorBuilder: (_, __) => Divider(
                              height: 1,
                              thickness: 1,
                              color: isDark
                                  ? AppColors.borderSubtle.withValues(alpha: 0.5)
                                  : scheme.outlineVariant.withValues(alpha: 0.2),
                            ),
                            itemBuilder: (context, index) {
                              final subagent = displaySubagents[index];
                              final isRunning =
                                  subagent.status.toLowerCase() == 'running';
                              final isErrored =
                                  subagent.status.toLowerCase() == 'errored' ||
                                      subagent.status.toLowerCase() == 'canceling';
                              final currentTool = subagent.stateDetail;

                              return InkWell(
                                onTap: () {
                                  HapticFeedback.selectionClick();
                                  if (widget.onSelectSubagent != null) {
                                    widget.onSelectSubagent!(subagent);
                                  } else {
                                    SubagentDetailModal.show(
                                      context,
                                      agent: subagent,
                                      projectName: widget.projectName,
                                      sessionTitle: widget.sessionTitle,
                                    );
                                  }
                                },
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 8),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      // Status icon (Spinning arc for running, check/error otherwise)
                                      if (isRunning)
                                        Container(
                                          width: 18,
                                          height: 18,
                                          alignment: Alignment.center,
                                          child: AntigravitySpinningArc(
                                            color: isDark
                                                ? AppColors.inkMuted
                                                : scheme.onSurfaceVariant,
                                            size: 13.5,
                                          ),
                                        )
                                      else if (isErrored)
                                        const Icon(
                                          Icons.error_outline_rounded,
                                          size: 16,
                                          color: AppColors.danger,
                                        )
                                      else
                                        const Icon(
                                          Icons.check_circle_outline_rounded,
                                          size: 16,
                                          color: AppColors.positive,
                                        ),

                                      const SizedBox(width: 10),

                                      // Role Title & Subtitle
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text(
                                              subagent.role,
                                              style: TextStyle(
                                                fontSize: 13,
                                                fontWeight: FontWeight.w500,
                                                color: isDark
                                                    ? AppColors.inkPrimary
                                                    : scheme.onSurface,
                                              ),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                            if (isRunning &&
                                                currentTool != null &&
                                                currentTool.isNotEmpty) ...[
                                              const SizedBox(height: 2),
                                              Text(
                                                currentTool,
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  fontFamily: 'monospace',
                                                  color:
                                                      AppColors.accentBlueBright,
                                                ),
                                                maxLines: 1,
                                                overflow:
                                                    TextOverflow.ellipsis,
                                              ),
                                            ] else if (!isRunning) ...[
                                              const SizedBox(height: 1.5),
                                              Text(
                                                subagent.displayWorkedFor,
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  color: isDark
                                                      ? AppColors.inkMuted
                                                      : scheme.onSurfaceVariant,
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),

                                      const SizedBox(width: 8),

                                      Icon(
                                        Icons.chevron_right_rounded,
                                        size: 16,
                                        color: isDark
                                            ? AppColors.inkMuted
                                            : scheme.outlineVariant,
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                    ],
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
