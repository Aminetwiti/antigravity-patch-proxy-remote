import 'package:flutter/material.dart';
import '../core/protocol/messages.dart';
import '../theme/app_colors.dart';
import 'antigravity_spinning_arc.dart';

/// Barre de fil d'Ariane (Breadcrumb) élégante et compacte affichée entre
/// le Header (AppBar) et la barre d'onglets (Nav : Chat, Review, Overview...).
/// Format : `[nom-du-projet] / [titre-de-la-session-ou-contexte]`
class SessionBreadcrumb extends StatelessWidget {
  final String projectName;
  final String sessionTitle;
  final VoidCallback? onSelectProject;
  final VoidCallback? onSelectSession;
  final VoidCallback? onOpenIde;
  final VoidCallback? onToggleFullscreen;
  final bool isFullscreen;
  final VoidCallback? onToggleSearch;
  final bool isSearching;
  final List<ProjectItem>? projects;
  final bool isStreaming;
  final bool hasRunningTasks;
  final bool hasWaitingApproval;
  final bool isError;

  const SessionBreadcrumb({
    super.key,
    required this.projectName,
    this.sessionTitle = '',
    this.onSelectProject,
    this.onSelectSession,
    this.onOpenIde,
    this.onToggleFullscreen,
    this.isFullscreen = false,
    this.onToggleSearch,
    this.isSearching = false,
    this.projects,
    this.isStreaming = false,
    this.hasRunningTasks = false,
    this.hasWaitingApproval = false,
    this.isError = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final displayProject = projectName.trim().isNotEmpty
        ? projectName.trim()
        : 'Workspace';

    final displayTitle = sessionTitle.trim().isNotEmpty
        ? sessionTitle.trim()
        : 'Nouvelle conversation';

    final canSwitchProject = onSelectProject != null && (projects == null || projects!.length > 1);
    final isCompact = MediaQuery.of(context).size.width < 380;

    return Container(
      height: 30,
      width: double.infinity,
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLowest,
        border: Border(
          bottom: BorderSide(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
            width: 1,
          ),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      alignment: Alignment.centerLeft,
      child: Row(
        mainAxisSize: MainAxisSize.max,
        children: [
          // Segments projet et session
          Expanded(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Segment 1 : Nom du projet / workspace
                Flexible(
                  flex: displayTitle.isNotEmpty ? 1 : 2,
                  fit: FlexFit.loose,
                  child: InkWell(
                    onTap: canSwitchProject ? onSelectProject : null,
                    borderRadius: BorderRadius.circular(4),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              displayProject,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w400,
                                color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                                letterSpacing: -0.1,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (canSwitchProject) ...[
                            const SizedBox(width: 2),
                            Icon(
                              Icons.arrow_drop_down,
                              size: 14,
                              color: isDark ? AppColors.inkMuted : scheme.outline,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),

                // Séparateur ' / ' et Segment 2 : Titre de la session / Contexte
                if (displayTitle.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Text(
                      '/',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                        color: isDark ? AppColors.inkMuted : scheme.outline,
                      ),
                    ),
                  ),
                  Flexible(
                    flex: 2,
                    fit: FlexFit.loose,
                    child: InkWell(
                      onTap: onSelectSession,
                      borderRadius: BorderRadius.circular(4),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (isStreaming) ...[
                              AntigravitySpinningArc(
                                size: 10.5,
                                color: isDark ? AppColors.accentBlueBright : scheme.primary,
                              ),
                              const SizedBox(width: 4),
                            ] else if (hasRunningTasks) ...[
                              Tooltip(
                                message: 'Tâche en cours d\'exécution...',
                                child: AntigravitySpinningArc(
                                  size: 10.5,
                                  color: isDark ? const Color(0xFF8AB4F8) : scheme.primary,
                                ),
                              ),
                              const SizedBox(width: 4),
                            ] else if (hasWaitingApproval) ...[
                              Tooltip(
                                message: 'Action ou approbation requise',
                                child: const Icon(
                                  Icons.shield_outlined,
                                  size: 11.5,
                                  color: Color(0xFFE5A93C),
                                ),
                              ),
                              const SizedBox(width: 4),
                            ] else if (isError) ...[
                              Tooltip(
                                message: 'Erreur',
                                child: const Icon(
                                  Icons.error_outline,
                                  size: 11.5,
                                  color: Color(0xFFE5534B),
                                ),
                              ),
                              const SizedBox(width: 4),
                            ],
                            Flexible(
                              child: Text(
                                displayTitle,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w400,
                                  color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                                  letterSpacing: -0.1,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (onToggleSearch != null) ...[
            const SizedBox(width: 4),
            InkWell(
              key: const Key('toggle-search-btn'),
              onTap: onToggleSearch,
              borderRadius: BorderRadius.circular(4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                decoration: BoxDecoration(
                  color: isSearching
                      ? (isDark ? AppColors.accentBlue.withValues(alpha: 0.2) : scheme.primaryContainer)
                      : (isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest),
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(
                    color: isSearching
                        ? (isDark ? AppColors.accentBlue : scheme.primary)
                        : (isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4)),
                    width: 0.6,
                  ),
                ),
                child: Icon(
                  Icons.search_rounded,
                  size: 13,
                  color: isSearching
                      ? (isDark ? AppColors.accentBlue : scheme.primary)
                      : (isDark ? AppColors.inkMuted : scheme.onSurfaceVariant),
                ),
              ),
            ),
          ],
          if (onToggleFullscreen != null) ...[
            const SizedBox(width: 6),
            InkWell(
              onTap: onToggleFullscreen,
              borderRadius: BorderRadius.circular(4),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: isCompact ? 5 : 6, vertical: 2),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(
                    color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4),
                    width: 0.6,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isFullscreen ? Icons.fullscreen_exit_rounded : Icons.fullscreen_rounded,
                      size: 13,
                      color: isDark ? AppColors.accentBlue : scheme.primary,
                    ),
                    if (!isCompact) ...[
                      const SizedBox(width: 4),
                      Text(
                        isFullscreen ? 'Quitter' : 'Plein écran',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w500,
                          color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ] else if (onOpenIde != null) ...[
            const SizedBox(width: 6),
            InkWell(
              onTap: onOpenIde,
              borderRadius: BorderRadius.circular(4),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: isCompact ? 5 : 6, vertical: 2),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(
                    color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4),
                    width: 0.6,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.terminal_rounded,
                      size: 13,
                      color: isDark ? AppColors.accentBlue : scheme.primary,
                    ),
                    if (!isCompact) ...[
                      const SizedBox(width: 4),
                      Text(
                        'Ouvrir IDE',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w500,
                          color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
