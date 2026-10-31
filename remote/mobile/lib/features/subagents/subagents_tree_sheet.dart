import 'package:flutter/material.dart';
import '../../core/protocol/daemon_api.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_theme.dart';
import '../../widgets/skeleton_loader.dart';
import 'models/subagent_item.dart';
import 'widgets/subagent_detail_modal.dart';

/// Modal bottom sheet presenting the active subagent DAG / tree for a session.
class SubagentsTreeSheet extends StatefulWidget {
  final DaemonApi? api;
  final String cascadeId;
  final String? projectName;
  final String? sessionTitle;
  final ValueChanged<SubagentItem>? onSelectSubagent;

  const SubagentsTreeSheet({
    super.key,
    this.api,
    required this.cascadeId,
    this.projectName,
    this.sessionTitle,
    this.onSelectSubagent,
  });

  static Future<void> show(
    BuildContext context, {
    DaemonApi? api,
    required String cascadeId,
    String? projectName,
    String? sessionTitle,
    ValueChanged<SubagentItem>? onSelectSubagent,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) => SubagentsTreeSheet(
        api: api,
        cascadeId: cascadeId,
        projectName: projectName,
        sessionTitle: sessionTitle,
        onSelectSubagent: onSelectSubagent,
      ),
    );
  }

  @override
  State<SubagentsTreeSheet> createState() => _SubagentsTreeSheetState();
}

class _SubagentsTreeSheetState extends State<SubagentsTreeSheet> {
  bool _loading = true;
  String? _error;
  List<SubagentItem> _subagents = [];

  @override
  void initState() {
    super.initState();
    _loadSubagents();
  }

  Future<void> _loadSubagents() async {
    if (widget.api == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Daemon non connecté';
        });
      }
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final raw = await widget.api!.getSubagents(widget.cascadeId);
      if (!mounted) return;
      setState(() {
        _subagents = raw.map((m) => SubagentItem.fromJson(m)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Impossible de charger les sous-agents ($e)';
        _loading = false;
      });
    }
  }

  Color _getStatusColor(String status, ColorScheme scheme) {
    switch (status.toLowerCase()) {
      case 'running':
        return scheme.primary;
      case 'waiting_for_input':
      case 'waiting_for_dependents':
      case 'waiting_for_message':
        return scheme.tertiary;
      case 'errored':
      case 'canceling':
        return scheme.error;
      case 'completed':
        return AppColors.positive;
      case 'killed':
        return scheme.outline;
      case 'idle':
      default:
        return scheme.outline;
    }
  }

  String _formatStatusLabel(String status) {
    switch (status.toLowerCase()) {
      case 'running':
        return 'En cours';
      case 'waiting_for_input':
        return 'En attente';
      case 'completed':
        return 'Terminé';
      case 'killed':
        return 'Killed';
      case 'errored':
        return 'Erreur';
      case 'idle':
        return 'Inactif';
      default:
        return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          ),
          child: Column(
            children: [
              // Drag Handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 6),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: scheme.outlineVariant.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: scheme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                      child: Icon(Icons.account_tree_outlined, size: 20, color: scheme.primary),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  'Hiérarchie des Sous-Agents',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: scheme.onSurface,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: scheme.surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  '${_subagents.length}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (widget.sessionTitle != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              widget.sessionTitle!,
                              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, size: 20),
                      tooltip: 'Rafraîchir',
                      onPressed: _loadSubagents,
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),

              // Content Body
              Expanded(
                child: _loading
                    ? SkeletonLoader(
                        child: ListView(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          physics: const NeverScrollableScrollPhysics(),
                          children: const [
                            SkeletonSubagentItem(),
                            Divider(height: 1, indent: 40),
                            SkeletonSubagentItem(),
                            Divider(height: 1, indent: 40),
                            SkeletonSubagentItem(),
                          ],
                        ),
                      )
                    : _error != null
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24.0),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.error_outline, size: 36, color: scheme.error),
                                  const SizedBox(height: 12),
                                  Text(
                                    _error!,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: scheme.error, fontSize: 13),
                                  ),
                                  const SizedBox(height: 16),
                                  ElevatedButton.icon(
                                    onPressed: _loadSubagents,
                                    icon: const Icon(Icons.refresh, size: 16),
                                    label: const Text('Réessayer'),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : _subagents.isEmpty
                            ? Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(32.0),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.account_tree_outlined,
                                        size: 48,
                                        color: scheme.onSurfaceVariant.withValues(alpha: 0.3),
                                      ),
                                      const SizedBox(height: 16),
                                      Text(
                                        'Aucun sous-agent actif',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 15,
                                          color: scheme.onSurface,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        'Les agents invoqués (invoke_subagent) apparaîtront ici avec leur progression en temps réel.',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                            : ListView.separated(
                                controller: scrollController,
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                itemCount: _subagents.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 8),
                                itemBuilder: (context, index) {
                                  final agent = _subagents[index];
                                  final statusColor = _getStatusColor(agent.status, scheme);
                                  final isChild = agent.parentId != null && agent.parentId!.isNotEmpty;
                                  final isRunning = agent.status.toLowerCase() == 'running';
                                  final currentTool = agent.stateDetail;

                                  return Padding(
                                    padding: EdgeInsets.only(left: isChild ? 20.0 : 0.0),
                                    child: Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        if (isChild)
                                          Padding(
                                            padding: const EdgeInsets.only(top: 14, right: 6),
                                            child: Icon(
                                              Icons.subdirectory_arrow_right_rounded,
                                              size: 14,
                                              color: scheme.outlineVariant,
                                            ),
                                          ),
                                        Expanded(
                                          child: Container(
                                            decoration: BoxDecoration(
                                              color: scheme.surfaceContainer,
                                              borderRadius: BorderRadius.circular(AppRadius.md),
                                              border: Border.all(
                                                color: isRunning
                                                    ? AppColors.accentBlue.withValues(alpha: 0.3)
                                                    : scheme.outlineVariant.withValues(alpha: 0.4),
                                                width: 1,
                                              ),
                                            ),
                                            child: InkWell(
                                              borderRadius: BorderRadius.circular(AppRadius.md),
                                              onTap: () {
                                                if (widget.onSelectSubagent != null) {
                                                  widget.onSelectSubagent!(agent);
                                                } else {
                                                  SubagentDetailModal.show(
                                                    context,
                                                    agent: agent,
                                                    api: widget.api,
                                                    cascadeId: widget.cascadeId,
                                                    projectName: widget.projectName,
                                                    sessionTitle: widget.sessionTitle,
                                                    onKill: () => _loadSubagents(),
                                                  );
                                                }
                                              },
                                              child: Padding(
                                                padding: const EdgeInsets.all(12),
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Row(
                                                      children: [
                                                        Container(
                                                          padding: const EdgeInsets.symmetric(
                                                            horizontal: 8,
                                                            vertical: 3,
                                                          ),
                                                          decoration: BoxDecoration(
                                                            color: scheme.primary.withValues(alpha: 0.1),
                                                            borderRadius: BorderRadius.circular(6),
                                                          ),
                                                          child: Text(
                                                            agent.typeName ?? 'agent',
                                                            style: TextStyle(
                                                              fontSize: 10,
                                                              fontWeight: FontWeight.w700,
                                                              fontFamily: 'monospace',
                                                              color: scheme.primary,
                                                            ),
                                                          ),
                                                        ),
                                                        const SizedBox(width: 8),
                                                        Expanded(
                                                          child: Text(
                                                            agent.role,
                                                            style: TextStyle(
                                                              fontWeight: FontWeight.w700,
                                                              fontSize: 13,
                                                              color: scheme.onSurface,
                                                            ),
                                                            maxLines: 1,
                                                            overflow: TextOverflow.ellipsis,
                                                          ),
                                                        ),
                                                        Container(
                                                          padding: const EdgeInsets.symmetric(
                                                            horizontal: 8,
                                                            vertical: 2,
                                                          ),
                                                          decoration: BoxDecoration(
                                                            color: statusColor.withValues(alpha: 0.15),
                                                            borderRadius: BorderRadius.circular(10),
                                                            border: Border.all(
                                                              color: statusColor.withValues(alpha: 0.3),
                                                              width: 1,
                                                            ),
                                                          ),
                                                          child: Row(
                                                            mainAxisSize: MainAxisSize.min,
                                                            children: [
                                                              Container(
                                                                width: 6,
                                                                height: 6,
                                                                decoration: BoxDecoration(
                                                                  color: statusColor,
                                                                  shape: BoxShape.circle,
                                                                ),
                                                              ),
                                                              const SizedBox(width: 5),
                                                              Text(
                                                                _formatStatusLabel(agent.status),
                                                                style: TextStyle(
                                                                  fontSize: 10,
                                                                  fontWeight: FontWeight.w600,
                                                                  color: statusColor,
                                                                ),
                                                              ),
                                                            ],
                                                          ),
                                                        ),
                                                        const SizedBox(width: 4),
                                                        Icon(
                                                          agent.status.toLowerCase() == 'killed'
                                                              ? Icons.block_outlined
                                                              : Icons.chevron_right_rounded,
                                                          size: 16,
                                                          color: scheme.onSurfaceVariant.withValues(alpha: 0.6),
                                                        ),
                                                      ],
                                                    ),
                                                    if (isRunning && currentTool != null && currentTool.isNotEmpty) ...[
                                                      const SizedBox(height: 6),
                                                      Row(
                                                        children: [
                                                          const Icon(
                                                            Icons.terminal_rounded,
                                                            size: 12,
                                                            color: AppColors.accentBlueBright,
                                                          ),
                                                          const SizedBox(width: 4),
                                                          Expanded(
                                                            child: Text(
                                                              currentTool,
                                                              style: const TextStyle(
                                                                fontSize: 11,
                                                                fontFamily: 'monospace',
                                                                color: AppColors.accentBlueBright,
                                                              ),
                                                              maxLines: 1,
                                                              overflow: TextOverflow.ellipsis,
                                                            ),
                                                          ),
                                                        ],
                                                      ),
                                                    ],
                                                    if (agent.prompt != null && agent.prompt!.isNotEmpty) ...[
                                                      const SizedBox(height: 8),
                                                      Text(
                                                        agent.prompt!,
                                                        style: TextStyle(
                                                          fontSize: 12,
                                                          color: scheme.onSurfaceVariant,
                                                        ),
                                                        maxLines: 2,
                                                        overflow: TextOverflow.ellipsis,
                                                      ),
                                                    ],
                                                    const SizedBox(height: 6),
                                                    Text(
                                                      agent.displayWorkedFor,
                                                      style: TextStyle(
                                                        fontSize: 10.5,
                                                        fontFamily: 'monospace',
                                                        color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
              ),
            ],
          ),
        );
      },
    );
  }
}
