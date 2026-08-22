import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';
import '../../../widgets/skeleton_loader.dart';

class OverviewPanelView extends StatelessWidget {
  final String sessionTitle;
  final String workspacePath;
  final List<String> modifiedFiles;
  final List<String> artifacts;
  final List<String> backgroundTasks;
  final int subagentsCount;
  final bool isLoading;
  final VoidCallback onOpenReview;
  final VoidCallback onOpenPlan;
  final VoidCallback onOpenSubagents;

  const OverviewPanelView({
    super.key,
    required this.sessionTitle,
    required this.workspacePath,
    this.modifiedFiles = const [],
    this.artifacts = const [],
    this.backgroundTasks = const [],
    this.subagentsCount = 0,
    this.isLoading = false,
    required this.onOpenReview,
    required this.onOpenPlan,
    required this.onOpenSubagents,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final content = ListView(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      children: [
        // Session info card
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: scheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                sessionTitle.isNotEmpty ? sessionTitle : 'Nouvelle session',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                  letterSpacing: -0.2,
                ),
              ),
              if (workspacePath.isNotEmpty) ...[
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.folder_outlined, size: 12, color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        workspacePath,
                        style: TextStyle(
                          fontSize: 11,
                          color: scheme.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),

        const SizedBox(height: 14),

        // Subagents Section
        _SectionCard(
          title: 'Subagents ($subagentsCount)',
          icon: Icons.hub_outlined,
          iconColor: isDark ? AppColors.warning : const Color(0xFF9A6700),
          actionText: 'Voir',
          onAction: onOpenSubagents,
          child: isLoading
              ? const SkeletonSubagentItem()
              : subagentsCount == 0
                  ? Text(
                      'Aucun sous-agent actif dans cette session.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    )
                  : Text(
                      '$subagentsCount sous-agent(s) en cours ou terminés.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurface),
                    ),
        ),

        const SizedBox(height: 12),

        // Files Changed Section
        _SectionCard(
          title: 'Fichiers modifiés (${modifiedFiles.length})',
          icon: Icons.rate_review_outlined,
          iconColor: isDark ? AppColors.positive : const Color(0xFF1A7F37),
          actionText: modifiedFiles.isNotEmpty ? 'Revoir' : null,
          onAction: onOpenReview,
          child: isLoading
              ? const SkeletonDiffFileItem()
              : modifiedFiles.isEmpty
                  ? Text(
                      'Aucun fichier modifié pour le moment.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    )
                  : Column(
                      children: modifiedFiles.take(5).map((f) {
                        final name = f.split(RegExp(r'[\\/]')).last;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              Icon(Icons.insert_drive_file_outlined, size: 12, color: scheme.onSurfaceVariant),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  name,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: scheme.onSurface,
                                    fontFamily: 'monospace',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
        ),

        const SizedBox(height: 12),

        // Artifacts Section
        _SectionCard(
          title: 'Artéfacts (${artifacts.length})',
          icon: Icons.article_outlined,
          iconColor: scheme.primary,
          actionText: artifacts.isNotEmpty ? 'Plan' : null,
          onAction: onOpenPlan,
          child: isLoading
              ? const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: SkeletonLine(width: 150, height: 12),
                )
              : artifacts.isEmpty
                  ? Text(
                      'Aucun artéfact généré.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    )
                  : Column(
                      children: artifacts.take(4).map((a) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              Icon(Icons.description_outlined, size: 12, color: scheme.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  a,
                                  style: TextStyle(fontSize: 12, color: scheme.onSurface),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
        ),

        const SizedBox(height: 12),

        // Background Tasks Section
        _SectionCard(
          title: 'Tâches d\'arrière-plan (${backgroundTasks.length})',
          icon: Icons.terminal_outlined,
          iconColor: scheme.secondary,
          child: isLoading
              ? const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: SkeletonLine(width: 150, height: 12),
                )
              : backgroundTasks.isEmpty
                  ? Text(
                      'Aucun processus ou serveur actif.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    )
                  : Column(
                      children: backgroundTasks.map((t) {
                        return Container(
                          margin: const EdgeInsets.symmetric(vertical: 3),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                          ),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(strokeWidth: 1.5, color: scheme.primary),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  t,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    color: scheme.onSurface,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
        ),

        const SizedBox(height: 24),
      ],
    );

    if (isLoading) {
      return SkeletonLoader(child: content);
    }
    return content;
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color iconColor;
  final String? actionText;
  final VoidCallback? onAction;
  final Widget child;

  const _SectionCard({
    required this.title,
    required this.icon,
    required this.iconColor,
    this.actionText,
    this.onAction,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: iconColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              if (actionText != null && onAction != null)
                GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onAction!();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      border: Border.all(color: scheme.outlineVariant),
                    ),
                    child: Text(
                      actionText!,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: scheme.primary,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}
