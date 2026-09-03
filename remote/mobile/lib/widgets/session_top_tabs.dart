import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';

enum SessionTabType {
  chat,
  overview,
  review,
  plan,
  tasks,
}

class SessionTopTabs extends StatelessWidget {
  final SessionTabType activeTab;
  final Function(SessionTabType tab) onTabChanged;
  final int filesChangedCount;
  final bool hasPlan;
  final bool hasTasks;
  final int runningTasksCount;
  final List<String> artifactTabs;
  final String? activeArtifact;
  final Function(String artifact)? onOpenArtifact;
  final VoidCallback? onNewTab;
  final VoidCallback? onToggleSidebar;
  final VoidCallback? onToggleSearch;

  const SessionTopTabs({
    super.key,
    required this.activeTab,
    required this.onTabChanged,
    this.filesChangedCount = 0,
    this.hasPlan = false,
    this.hasTasks = false,
    this.runningTasksCount = 0,
    this.artifactTabs = const [],
    this.activeArtifact,
    this.onOpenArtifact,
    this.onNewTab,
    this.onToggleSidebar,
    this.onToggleSearch,
  });

  IconData _iconForArtifact(String name) {
    final lower = name.toLowerCase();
    if (lower.contains('walkthrough')) return Icons.menu_book_rounded;
    if (lower.contains('report') || lower.contains('comparison')) return Icons.assessment_outlined;
    if (lower.contains('plan')) return Icons.architecture_rounded;
    return Icons.description_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      height: 42,
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        border: Border(
          bottom: BorderSide(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              children: [
                _TabPill(
                  icon: Icons.chat_bubble_outline,
                  label: 'Chat',
                  isSelected: activeTab == SessionTabType.chat && activeArtifact == null,
                  onTap: () => onTabChanged(SessionTabType.chat),
                ),
                const SizedBox(width: 6),
                _TabPill(
                  icon: Icons.difference_outlined,
                  label: 'Review',
                  badge: filesChangedCount > 0 ? '+$filesChangedCount' : null,
                  badgeColor: AppColors.positive,
                  isSelected: activeTab == SessionTabType.review && activeArtifact == null,
                  onTap: () => onTabChanged(SessionTabType.review),
                ),
                const SizedBox(width: 6),
                _TabPill(
                  icon: Icons.dashboard_outlined,
                  label: 'Overview',
                  isSelected: activeTab == SessionTabType.overview && activeArtifact == null,
                  badge: runningTasksCount > 0 ? '$runningTasksCount' : null,
                  badgeColor: isDark ? AppColors.accentBlue : scheme.primary,
                  onTap: () => onTabChanged(SessionTabType.overview),
                ),
                if (hasPlan) ...[
                  const SizedBox(width: 6),
                  _TabPill(
                    icon: Icons.description_outlined,
                    label: 'Plan',
                    badge: 'Proceed ⌘↵',
                    badgeColor: isDark ? AppColors.accentBlue : scheme.primary,
                    isSelected: activeTab == SessionTabType.plan && activeArtifact == null,
                    onTap: () => onTabChanged(SessionTabType.plan),
                  ),
                ],
                ...artifactTabs.map((art) {
                  final isSel = activeArtifact == art;
                  return Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: _TabPill(
                      icon: _iconForArtifact(art),
                      label: art,
                      isSelected: isSel,
                      onTap: () {
                        if (isSel) {
                          onTabChanged(SessionTabType.chat);
                        } else {
                          onOpenArtifact?.call(art);
                        }
                      },
                      onClose: isSel ? () => onTabChanged(SessionTabType.chat) : null,
                    ),
                  );
                }),
                if (hasTasks) ...[
                  const SizedBox(width: 6),
                  _TabPill(
                    icon: Icons.checklist_rtl_outlined,
                    label: 'Tasks',
                    isSelected: activeTab == SessionTabType.tasks && activeArtifact == null,
                    onTap: () => onTabChanged(SessionTabType.tasks),
                  ),
                ],
              ],
            ),
          ),
          if (onNewTab != null || onToggleSidebar != null || onToggleSearch != null) ...[
            Container(
              height: 20,
              width: 1,
              color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
            ),
            if (onToggleSearch != null)
              Semantics(
                button: true,
                label: 'Rechercher dans la conversation',
                child: IconButton(
                  key: const Key('toggle-search-btn'),
                  icon: const Icon(Icons.search_rounded, size: 18),
                  tooltip: 'Rechercher dans la conversation',
                  onPressed: onToggleSearch,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 42, minHeight: 44),
                  color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                ),
              ),
            if (onNewTab != null)
              Semantics(
                button: true,
                label: 'Nouvelle conversation',
                child: IconButton(
                  icon: const Icon(Icons.add, size: 18),
                  tooltip: 'Nouvelle conversation',
                  onPressed: onNewTab,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 42, minHeight: 44),
                  color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                ),
              ),
            if (onToggleSidebar != null)
              Semantics(
                button: true,
                label: 'Panneau latéral',
                child: IconButton(
                  icon: const Icon(Icons.splitscreen_rounded, size: 16),
                  tooltip: 'Panneau latéral',
                  onPressed: onToggleSidebar,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 42, minHeight: 44),
                  color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                ),
              ),
            const SizedBox(width: 4),
          ],
        ],
      ),
    );
  }
}

class _TabPill extends StatefulWidget {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;
  final String? badge;
  final Color? badgeColor;
  final VoidCallback? onClose;

  const _TabPill({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
    this.badge,
    this.badgeColor,
    this.onClose,
  });

  @override
  State<_TabPill> createState() => _TabPillState();
}

class _TabPillState extends State<_TabPill> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isSelected = widget.isSelected;

    final Color fgColor;
    final Color bgColor;
    final Color borderColor;

    if (isDark) {
      fgColor = isSelected
          ? AppColors.inkPrimary
          : (_hovered ? AppColors.inkSecondary : AppColors.inkMuted);
      bgColor = isSelected
          ? AppColors.listSelectionBg
          : (_hovered ? AppColors.surfaceHover.withValues(alpha: 0.5) : Colors.transparent);
      borderColor = isSelected ? AppColors.borderStrong : Colors.transparent;
    } else {
      fgColor = isSelected
          ? scheme.primary
          : (_hovered ? scheme.onSurface : scheme.onSurfaceVariant);
      bgColor = isSelected
          ? scheme.primary.withValues(alpha: 0.12)
          : (_hovered ? scheme.surfaceContainerHighest : Colors.transparent);
      borderColor = isSelected
          ? scheme.primary.withValues(alpha: 0.35)
          : Colors.transparent;
    }

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Semantics(
        button: true,
        selected: isSelected,
        label: '${widget.label} tab',
        child: GestureDetector(
          onTap: () {
            HapticFeedback.selectionClick();
            widget.onTap();
          },
          child: AnimatedContainer(
            duration: AppMotion.fast,
            curve: AppMotion.easeOut,
            constraints: const BoxConstraints(minHeight: 34),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(
              color: borderColor,
              width: 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(widget.icon, size: 13, color: fgColor),
              const SizedBox(width: 6),
              Text(
                widget.label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  color: fgColor,
                  letterSpacing: -0.1,
                ),
              ),
              if (widget.badge != null) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                  decoration: BoxDecoration(
                    color: (widget.badgeColor ?? (isDark ? AppColors.accentBlue : scheme.primary))
                        .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: (widget.badgeColor ?? (isDark ? AppColors.accentBlue : scheme.primary))
                          .withValues(alpha: 0.35),
                      width: 0.5,
                    ),
                  ),
                  child: Text(
                    widget.badge!,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: widget.badgeColor ?? (isDark ? AppColors.accentBlue : scheme.primary),
                    ),
                  ),
                ),
              ],
              if (widget.onClose != null && isSelected) ...[
                const SizedBox(width: 4),
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    HapticFeedback.lightImpact();
                    widget.onClose!();
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: Icon(
                      Icons.close_rounded,
                      size: 12,
                      color: fgColor.withValues(alpha: 0.8),
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
  }
}
