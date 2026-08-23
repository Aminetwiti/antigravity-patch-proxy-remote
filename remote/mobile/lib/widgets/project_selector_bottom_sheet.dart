import 'package:flutter/material.dart';
import '../core/protocol/messages.dart';
import '../theme/app_colors.dart';

/// Modal bottom sheet réutilisable permettant de sélectionner un projet/workspace
/// avec défilement fluide, support d'un nombre élevé de projets sans overflow,
/// debounce anti-rebond et intégration des tokens de design Antigravity.
class ProjectSelectorBottomSheet extends StatelessWidget {
  final List<ProjectItem> projects;
  final String? activeProjectPath;
  final ValueChanged<ProjectItem> onSelectProject;
  final ValueChanged<ProjectItem>? onDeleteProject;

  const ProjectSelectorBottomSheet({
    super.key,
    required this.projects,
    this.activeProjectPath,
    required this.onSelectProject,
    this.onDeleteProject,
  });

  /// Affiche le sélecteur de projet sous forme de modal bottom sheet contrôlé.
  static Future<ProjectItem?> show(
    BuildContext context, {
    required List<ProjectItem> projects,
    String? activeProjectPath,
    ValueChanged<ProjectItem>? onSelectProject,
    ValueChanged<ProjectItem>? onDeleteProject,
  }) {
    if (projects.isEmpty) return Future.value(null);

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    return showModalBottomSheet<ProjectItem>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      ),
      builder: (ctx) => ProjectSelectorBottomSheet(
        projects: projects,
        activeProjectPath: activeProjectPath,
        onSelectProject: (p) {
          onSelectProject?.call(p);
          Navigator.of(ctx).pop(p);
        },
        onDeleteProject: onDeleteProject,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final screenHeight = MediaQuery.sizeOf(context).height;
    final maxHeight = screenHeight * 0.75;

    bool isSelecting = false;

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Drag handle
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.borderStrong : scheme.outlineVariant,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),

              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: scheme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Icon(Icons.workspaces_outlined, size: 18, color: scheme.primary),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Sélectionner un projet de travail',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                          letterSpacing: -0.2,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        '${projects.length}',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),

              // Scrollable list of projects
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  physics: const BouncingScrollPhysics(),
                  itemCount: projects.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 4),
                  itemBuilder: (ctx, index) {
                    final p = projects[index];
                    final isSelected = activeProjectPath != null &&
                        (p.path == activeProjectPath ||
                            p.name == activeProjectPath);

                    return Semantics(
                      label: 'Projet ${p.name}, chemin ${p.path}',
                      selected: isSelected,
                      button: true,
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            if (isSelecting) return;
                            isSelecting = true;
                            onSelectProject(p);
                          },
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? scheme.primary.withValues(alpha: 0.10)
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(AppRadius.md),
                              border: isSelected
                                  ? Border.all(
                                      color: scheme.primary.withValues(alpha: 0.35),
                                      width: 1,
                                    )
                                  : null,
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? scheme.primary.withValues(alpha: 0.18)
                                        : (isDark
                                            ? AppColors.surfaceInput
                                            : scheme.surfaceContainerHigh),
                                    borderRadius: BorderRadius.circular(AppRadius.sm),
                                  ),
                                  child: Icon(
                                    Icons.folder_outlined,
                                    size: 18,
                                    color: isSelected ? scheme.primary : scheme.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        p.name,
                                        style: TextStyle(
                                          fontSize: 13.5,
                                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                                          color: isSelected ? scheme.primary : scheme.onSurface,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        p.path,
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                                if (isSelected) ...[
                                  const SizedBox(width: 8),
                                  Icon(
                                    Icons.check_circle_rounded,
                                    size: 18,
                                    color: scheme.primary,
                                  ),
                                ],
                                if (onDeleteProject != null) ...[
                                  const SizedBox(width: 4),
                                  Tooltip(
                                    message: 'Supprimer définitivement le projet',
                                    child: InkWell(
                                      borderRadius: BorderRadius.circular(4),
                                      onTap: () => _confirmDeleteProject(context, p),
                                      child: Padding(
                                        padding: const EdgeInsets.all(6),
                                        child: Icon(
                                          Icons.delete_outline_rounded,
                                          size: 16,
                                          color: AppColors.danger,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
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
      ),
    );
  }

  void _confirmDeleteProject(BuildContext context, ProjectItem project) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    showDialog(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        scrollable: true,
        backgroundColor: isDark ? const Color(0xFF1F2127) : scheme.surfaceContainerHighest,
        title: Text(
          'Supprimer définitivement le projet ?',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
          ),
        ),
        content: Text(
          'Supprimer définitivement "${project.name}" le supprime, ainsi que toutes les conversations actives et archivées associées.',
          style: TextStyle(
            fontSize: 13,
            color: scheme.onSurfaceVariant,
            height: 1.4,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: Text('Annuler', style: TextStyle(color: scheme.onSurfaceVariant)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () {
              Navigator.of(dialogCtx).pop();
              onDeleteProject?.call(project);
            },
            child: const Text('Supprimer définitivement'),
          ),
        ],
      ),
    );
  }
}
