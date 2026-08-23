import 'package:flutter/material.dart';
import '../../core/protocol/messages.dart';
import '../../core/protocol/workspace_path.dart';
import '../../theme/app_colors.dart';

enum SessionGroupBy {
  project,
  workspace,
  status,
  none,
}

extension SessionGroupByX on SessionGroupBy {
  String get label {
    switch (this) {
      case SessionGroupBy.project:
        return 'Project';
      case SessionGroupBy.workspace:
        return 'Workspace';
      case SessionGroupBy.status:
        return 'Status';
      case SessionGroupBy.none:
        return 'None';
    }
  }
}

enum SessionSortBy {
  lastUpdated,
  lastPrompt,
  alphabetical,
  dateAdded,
}

extension SessionSortByX on SessionSortBy {
  String get label {
    switch (this) {
      case SessionSortBy.lastUpdated:
        return 'Last Updated';
      case SessionSortBy.lastPrompt:
        return 'Last Prompt';
      case SessionSortBy.alphabetical:
        return 'Alphabetical (A-Z)';
      case SessionSortBy.dateAdded:
        return 'Date Added';
    }
  }
}

enum SessionSubtitle {
  worktree,
  project,
  none,
}

extension SessionSubtitleX on SessionSubtitle {
  String get label {
    switch (this) {
      case SessionSubtitle.worktree:
        return 'Worktree / Branch';
      case SessionSubtitle.project:
        return 'Project';
      case SessionSubtitle.none:
        return 'No Subtitle';
    }
  }
}

/// Utility helper for grouping sessions
Map<String, List<CascadeSession>> groupSessions({
  required List<CascadeSession> sessions,
  required SessionGroupBy groupBy,
  List<ProjectItem>? projects,
}) {
  final Map<String, List<CascadeSession>> grouped = {};

  if (groupBy == SessionGroupBy.none) {
    grouped['All Conversations'] = List.from(sessions);
    return grouped;
  }

  if (groupBy == SessionGroupBy.status) {
    for (final s in sessions) {
      String statusGroup = 'Other';
      if (s.isRunning) {
        statusGroup = 'Active';
      } else if (s.status.toUpperCase().contains('READY')) {
        statusGroup = 'Ready';
      } else {
        statusGroup = 'Idle';
      }
      grouped.putIfAbsent(statusGroup, () => []).add(s);
    }
    return grouped;
  }

  if (groupBy == SessionGroupBy.workspace) {
    for (final s in sessions) {
      final ws = WorkspacePath.displayName(s.workspacePath);
      grouped.putIfAbsent(ws, () => []).add(s);
    }
    return grouped;
  }

  // SessionGroupBy.project
  final officialProjects = projects ?? const [];
  if (officialProjects.isNotEmpty) {
    final Map<String, ProjectItem> byId = {};
    final Map<String, ProjectItem> byPath = {};
    final Map<String, ProjectItem> byNameLower = {};
    final List<MapEntry<String, ProjectItem>> parentPathEntries = [];

    for (final p in officialProjects) {
      grouped[p.name] = [];
      if (p.id.isNotEmpty) byId[p.id] = p;
      if (p.name.isNotEmpty) byNameLower[p.name.trim().toLowerCase()] = p;

      final pPath = WorkspacePath.canonicalPath(p.path);
      final pUri = WorkspacePath.canonicalPath(p.folderUri);
      final effectiveP = pPath.isNotEmpty ? pPath : pUri;

      if (p.path.isNotEmpty) byPath[WorkspacePath.canonicalPath(p.path)] = p;
      if (p.folderUri.isNotEmpty) byPath[WorkspacePath.canonicalPath(p.folderUri)] = p;

      if (effectiveP.isNotEmpty) {
        parentPathEntries.add(MapEntry(effectiveP, p));
      }
    }

    // Pre-canonicalize and lower-case parent paths so loop does 0 canonicalization allocations
    final canonicalParentEntries = parentPathEntries
        .map((e) {
          final c = WorkspacePath.canonicalPath(e.key).toLowerCase();
          return MapEntry(c, e.value);
        })
        .where((e) => e.key.isNotEmpty)
        .toList();

    // Sort parent paths by descending length so first match in loop is the most specific
    canonicalParentEntries.sort((a, b) => b.key.length.compareTo(a.key.length));

    for (final s in sessions) {
      ProjectItem? matchedProject;

      // 1. Priority 1: explicit projectId
      if (s.projectId != null && s.projectId!.isNotEmpty) {
        matchedProject = byId[s.projectId];
      }

      String? canonicalWs;
      String? cWsLower;

      // 2. Priority 2: exact path or URI match
      if (matchedProject == null && s.workspacePath.isNotEmpty) {
        canonicalWs = WorkspacePath.canonicalPath(s.workspacePath);
        matchedProject = byPath[canonicalWs];
      }

      // 3. Priority 3: most specific parent directory (longest matching prefix)
      if (matchedProject == null && s.workspacePath.isNotEmpty) {
        cWsLower = (canonicalWs ?? WorkspacePath.canonicalPath(s.workspacePath)).toLowerCase();
        for (final entry in canonicalParentEntries) {
          final pPrefix = entry.key;
          if (cWsLower == pPrefix || cWsLower.startsWith('$pPrefix/')) {
            matchedProject = entry.value;
            break;
          }
        }
      }

      // 4. Priority 4: folder name matching project name
      if (matchedProject == null && s.workspacePath.isNotEmpty) {
        final sessionFolder = WorkspacePath.displayName(s.workspacePath).toLowerCase();
        matchedProject = byNameLower[sessionFolder];
      }

      if (matchedProject != null) {
        grouped[matchedProject.name]?.add(s);
      } else {
        const fallbackName = 'Outside of Project';
        grouped.putIfAbsent(fallbackName, () => []).add(s);
      }
    }

    if (grouped['Outside of Project']?.isEmpty ?? false) {
      grouped.remove('Outside of Project');
    }
  } else {
    for (final s in sessions) {
      final folderName = WorkspacePath.displayName(
        s.workspacePath,
        fallback: 'antigravity-workspace',
      );
      grouped.putIfAbsent(folderName, () => []).add(s);
    }
  }

  return grouped;
}

/// Utility helper for sorting sessions
List<CascadeSession> sortSessions({
  required List<CascadeSession> sessions,
  required SessionSortBy sortBy,
}) {
  final copy = List<CascadeSession>.from(sessions);

  switch (sortBy) {
    case SessionSortBy.alphabetical:
      if (copy.length <= 100) {
        copy.sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
      } else {
        // O(N) pre-key extraction eliminates O(N log N) string allocations during sorting
        final indexed = List.generate(copy.length, (i) => (copy[i].title.toLowerCase(), copy[i]));
        indexed.sort((a, b) => a.$1.compareTo(b.$1));
        for (int i = 0; i < copy.length; i++) {
          copy[i] = indexed[i].$2;
        }
      }
      break;
    case SessionSortBy.lastPrompt:
      if (copy.length <= 100) {
        copy.sort((a, b) {
          final aPrompt = (a.lastPrompt ?? a.title).toLowerCase();
          final bPrompt = (b.lastPrompt ?? b.title).toLowerCase();
          return aPrompt.compareTo(bPrompt);
        });
      } else {
        final indexed = List.generate(copy.length, (i) => ((copy[i].lastPrompt ?? copy[i].title).toLowerCase(), copy[i]));
        indexed.sort((a, b) => a.$1.compareTo(b.$1));
        for (int i = 0; i < copy.length; i++) {
          copy[i] = indexed[i].$2;
        }
      }
      break;
    case SessionSortBy.dateAdded:
      copy.sort((a, b) => a.id.compareTo(b.id));
      break;
    case SessionSortBy.lastUpdated:
      copy.sort((a, b) {
        final aTime = a.updatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        final bTime = b.updatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        return bTime.compareTo(aTime);
      });
      break;
  }

  return copy;
}

/// Display Options Menu Button matching Antigravity 2.0 Desktop IDE menu
class DisplayOptionsMenuButton extends StatelessWidget {
  final SessionGroupBy selectedGroupBy;
  final SessionSortBy selectedSortBy;
  final SessionSubtitle selectedSubtitle;
  final bool isFilterOpen;
  final ValueChanged<SessionGroupBy> onGroupByChanged;
  final ValueChanged<SessionSortBy> onSortByChanged;
  final ValueChanged<SessionSubtitle> onSubtitleChanged;
  final VoidCallback onToggleFilter;

  const DisplayOptionsMenuButton({
    super.key,
    required this.selectedGroupBy,
    required this.selectedSortBy,
    required this.selectedSubtitle,
    required this.isFilterOpen,
    required this.onGroupByChanged,
    required this.onSortByChanged,
    required this.onSubtitleChanged,
    required this.onToggleFilter,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return PopupMenuButton<String>(
      tooltip: 'Display Options',
      color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainer,
      surfaceTintColor: Colors.transparent,
      elevation: 8,
      offset: const Offset(0, 24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        side: BorderSide(color: isDark ? const Color(0xFF2C2F36) : scheme.outlineVariant, width: 1),
      ),
      icon: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: isFilterOpen ? (isDark ? const Color(0xFF26282E) : scheme.surfaceContainerHighest) : Colors.transparent,
          borderRadius: BorderRadius.circular(5),
        ),
        child: Icon(
          Icons.tune_rounded,
          size: 16,
          color: isFilterOpen ? scheme.primary : scheme.onSurfaceVariant,
        ),
      ),
      onSelected: (value) {
        if (value.startsWith('group_')) {
          final groupName = value.substring(6);
          final match = SessionGroupBy.values.firstWhere(
            (e) => e.name == groupName,
            orElse: () => SessionGroupBy.project,
          );
          onGroupByChanged(match);
        } else if (value.startsWith('sort_')) {
          final sortName = value.substring(5);
          final match = SessionSortBy.values.firstWhere(
            (e) => e.name == sortName,
            orElse: () => SessionSortBy.lastUpdated,
          );
          onSortByChanged(match);
        } else if (value.startsWith('sub_')) {
          final subName = value.substring(4);
          final match = SessionSubtitle.values.firstWhere(
            (e) => e.name == subName,
            orElse: () => SessionSubtitle.worktree,
          );
          onSubtitleChanged(match);
        } else if (value == 'toggle_filter') {
          onToggleFilter();
        }
      },
      itemBuilder: (context) => [
        // ── Group By Header
        _buildSectionHeader('Group By', scheme, isDark),
        ...SessionGroupBy.values.map(
          (opt) => _buildCheckItem(
            value: 'group_${opt.name}',
            label: opt.label,
            isSelected: selectedGroupBy == opt,
            scheme: scheme,
            isDark: isDark,
          ),
        ),

        const PopupMenuDivider(height: 12),

        // ── Sort Conversations Header
        _buildSectionHeader('Sort Conversations', scheme, isDark),
        ...SessionSortBy.values.map(
          (opt) => _buildCheckItem(
            value: 'sort_${opt.name}',
            label: opt.label,
            isSelected: selectedSortBy == opt,
            scheme: scheme,
            isDark: isDark,
          ),
        ),

        const PopupMenuDivider(height: 12),

        // ── Subtitles Header
        _buildSectionHeader('Subtitles', scheme, isDark),
        ...SessionSubtitle.values.map(
          (opt) => _buildCheckItem(
            value: 'sub_${opt.name}',
            label: opt.label,
            isSelected: selectedSubtitle == opt,
            scheme: scheme,
            isDark: isDark,
          ),
        ),

        const PopupMenuDivider(height: 12),

        // ── Filter Sub-menu toggle
        PopupMenuItem<String>(
          value: 'toggle_filter',
          height: 32,
          child: Row(
            children: [
              Icon(
                isFilterOpen ? Icons.filter_list_off_rounded : Icons.filter_list_rounded,
                size: 15,
                color: isFilterOpen ? scheme.primary : scheme.onSurface,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  isFilterOpen ? 'Hide Filter Bar' : 'Filter',
                  style: TextStyle(
                    fontSize: 13,
                    color: isFilterOpen ? scheme.primary : scheme.onSurface,
                    fontWeight: isFilterOpen ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  PopupMenuItem<String> _buildSectionHeader(String title, ColorScheme scheme, bool isDark) {
    return PopupMenuItem<String>(
      enabled: false,
      height: 26,
      child: Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 2),
        child: Text(
          title,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: isDark ? const Color(0xFF6E707A) : scheme.onSurfaceVariant,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );
  }

  PopupMenuItem<String> _buildCheckItem({
    required String value,
    required String label,
    required bool isSelected,
    required ColorScheme scheme,
    required bool isDark,
  }) {
    return PopupMenuItem<String>(
      value: value,
      height: 32,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        decoration: BoxDecoration(
          color: isSelected
              ? (isDark ? const Color(0xFF26282E) : scheme.primary.withValues(alpha: 0.08))
              : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  color: scheme.onSurface,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            if (isSelected)
              Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  color: scheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.check_rounded,
                  size: 11,
                  color: isDark ? Colors.black : Colors.white,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
