import 'package:flutter/material.dart';
import 'models/subagent_item.dart';
import 'package:mobile/theme/app_colors.dart';
import 'widgets/subagent_detail_modal.dart';

class SubagentsDrawer extends StatelessWidget {
  final List<SubagentItem> subagents;
  final ValueChanged<String>? onKillAgent;
  final VoidCallback? onKillAll;
  final ValueChanged<String>? onSelectAgent;

  const SubagentsDrawer({
    super.key,
    required this.subagents,
    this.onKillAgent,
    this.onKillAll,
    this.onSelectAgent,
  });

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
      case 'waiting_for_dependents':
        return 'En attente (deps)';
      case 'waiting_for_message':
        return 'En attente (msg)';
      case 'errored':
        return 'Erreur';
      case 'canceling':
        return 'Annulation';
      case 'idle':
        return 'Inactif';
      default:
        return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final bgSurface = scheme.surface;
    final cardBg = scheme.surfaceContainer;
    final borderCol = scheme.outlineVariant;

    return Drawer(
      backgroundColor: bgSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drawer Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Icon(Icons.smart_toy_outlined, size: 18, color: scheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Subagents (${subagents.length})',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.onSurface,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (onKillAll != null && subagents.isNotEmpty) ...[
                    const SizedBox(width: 4),
                    TextButton(
                      onPressed: onKillAll,
                      style: TextButton.styleFrom(
                        foregroundColor: scheme.error,
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity: VisualDensity.compact,
                      ),
                      child: const Text(
                        'Terminer tout',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                  const SizedBox(width: 4),
                  IconButton(
                    icon: Icon(Icons.close, size: 18, color: theme.colorScheme.onSurfaceVariant),
                    onPressed: () => Navigator.of(context).maybePop(),
                    tooltip: 'Fermer',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: borderCol),

            // Content: Empty state or subagent list
            Expanded(
              child: subagents.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24.0),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.hub_outlined, size: 40, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.4)),
                            const SizedBox(height: 12),
                            Text(
                              'Aucun sous-agent actif',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Les sous-agents invoqués apparaîtront ici.',
                              style: TextStyle(
                                fontSize: 11,
                                color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: subagents.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final agent = subagents[index];
                        final statusColor = _getStatusColor(agent.status, scheme);
                        final statusText = _formatStatusLabel(agent.status);

                        return Material(
                          color: cardBg,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(AppRadius.md),
                            side: BorderSide(color: borderCol, width: 1),
                          ),
                          child: InkWell(
                            onTap: () {
                              if (onSelectAgent != null) {
                                onSelectAgent!(agent.id);
                              } else {
                                SubagentDetailModal.show(context, agent: agent);
                              }
                            },
                            borderRadius: BorderRadius.circular(AppRadius.md),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      // Status Dot
                                      Container(
                                        width: 8,
                                        height: 8,
                                        decoration: BoxDecoration(
                                          color: statusColor,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      // Role title
                                      Expanded(
                                        child: Text(
                                          agent.role,
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: theme.colorScheme.onSurface,
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      // Status pill
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: statusColor.withValues(alpha: 0.15),
                                          borderRadius: BorderRadius.circular(AppRadius.pill),
                                          border: Border.all(color: statusColor.withValues(alpha: 0.3), width: 0.8),
                                        ),
                                        child: Text(
                                          statusText,
                                          style: TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.w600,
                                            color: statusColor,
                                          ),
                                        ),
                                      ),
                                      if (onKillAgent != null) ...[
                                        const SizedBox(width: 4),
                                        IconButton(
                                          icon: Icon(Icons.cancel_outlined, size: 16, color: scheme.error),
                                          tooltip: 'Terminer le sous-agent',
                                          onPressed: () => onKillAgent!(agent.id),
                                          padding: EdgeInsets.zero,
                                          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                                          visualDensity: VisualDensity.compact,
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  // Agent ID / details
                                  Row(
                                    children: [
                                      Icon(Icons.tag, size: 11, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.6)),
                                      const SizedBox(width: 2),
                                      Flexible(
                                        child: Text(
                                          agent.id,
                                          style: TextStyle(
                                            fontSize: 11,
                                            fontFamily: 'monospace',
                                            color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      if (agent.typeName != null && agent.typeName!.isNotEmpty) ...[
                                        const SizedBox(width: 8),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                                          decoration: BoxDecoration(
                                            color: theme.colorScheme.surfaceContainerHighest,
                                            borderRadius: BorderRadius.circular(AppRadius.sm),
                                          ),
                                          child: Text(
                                            agent.typeName!,
                                            style: TextStyle(
                                              fontSize: 10,
                                              color: theme.colorScheme.onSurfaceVariant,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  if (agent.stateDetail != null && agent.stateDetail!.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    Container(
                                      width: double.infinity,
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: scheme.surfaceContainerHighest,
                                        borderRadius: BorderRadius.circular(AppRadius.sm),
                                      ),
                                      child: Text(
                                        agent.stateDetail!,
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: scheme.onSurfaceVariant,
                                          fontStyle: FontStyle.italic,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
