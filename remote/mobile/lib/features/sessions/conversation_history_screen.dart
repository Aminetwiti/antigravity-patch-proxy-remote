import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/workspace_path.dart';
import 'package:mobile/theme/app_colors.dart';
import '../../widgets/antigravity_spinning_arc.dart';
import '../../widgets/status_dot_badge.dart';
import 'display_options.dart';

/// Écran Conversation History (Antigravity 2.0)
/// Affiche la liste complète de toutes les conversations avec recherche en temps réel,
/// filtrage par workspace/projet, indicateurs de sessions actives/en cours et sélection rapide.
class ConversationHistoryScreen extends StatefulWidget {
  final DaemonApi? api;
  final List<CascadeSession> sessions;
  final List<ProjectItem>? projects;
  final String activeSessionId;
  final Function(String sessionId) onSessionSelected;
  final VoidCallback? onRefresh;
  final Function(String sessionId)? onDeleteSession;

  const ConversationHistoryScreen({
    super.key,
    this.api,
    required this.sessions,
    this.projects,
    required this.activeSessionId,
    required this.onSessionSelected,
    this.onRefresh,
    this.onDeleteSession,
  });

  @override
  State<ConversationHistoryScreen> createState() => _ConversationHistoryScreenState();
}

class _ConversationHistoryScreenState extends State<ConversationHistoryScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  String? _selectedWorkspaceFilter; // null = all workspaces

  SessionGroupBy _groupBy = SessionGroupBy.project;
  SessionSortBy _sortBy = SessionSortBy.lastUpdated;
  SessionSubtitle _subtitle = SessionSubtitle.worktree;

  List<CascadeSession>? _fetchedSessions;
  List<ProjectItem>? _fetchedProjects;
  bool _isLoading = false;

  List<CascadeSession> get _allSessions => _fetchedSessions ?? widget.sessions;
  List<ProjectItem>? get _allProjects => _fetchedProjects ?? widget.projects;

  /// Debounce de la recherche : sans lui, chaque frappe déclenche un setState
  /// (rebuild de la liste) alors que le pipeline mémoïsé ne change qu'après
  /// stabilisation de la requête.
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      _searchDebounce?.cancel();
      _searchDebounce = Timer(const Duration(milliseconds: 150), () {
        if (!mounted) return;
        setState(() {
          _searchQuery = _searchController.text.trim().toLowerCase();
        });
      });
    });
    if (widget.api != null) {
      _loadAllSessions();
    }
  }

  Future<void> _loadAllSessions() async {
    if (widget.api == null) return;
    setState(() => _isLoading = true);
    try {
      final res = await widget.api!.listAllSessions();
      // Historique des conversations : conserve les sessions archivées
      // (le daemon les marque isArchived + CASCADE_STATUS_ARCHIVED).
      final parsed = SessionParser.parseListSessions(res, includeArchived: true);
      List<ProjectItem>? projs;
      if (res['projects'] is List) {
        projs = (res['projects'] as List)
            .whereType<Map>()
            .map((p) => ProjectItem.fromJson(Map<String, dynamic>.from(p)))
            .toList();
      }
      if (!mounted) return;
      setState(() {
        if (parsed.isNotEmpty) {
          _fetchedSessions = parsed;
        }
        if (projs != null && projs.isNotEmpty) {
          _fetchedProjects = projs;
        }
        _isLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  List<CascadeSession>? _memoAllSessions;
  List<ProjectItem>? _memoAllProjects;
  String? _memoSearchQuery;
  String? _memoSelectedFilter;
  SessionGroupBy? _memoGroupBy;
  SessionSortBy? _memoSortBy;
  List<String> _memoWorkspaces = const [];
  List<dynamic> _memoDisplayItems = const [];

  void _computePipeline() {
    final sessions = _allSessions;
    final projects = _allProjects;
    if (_memoDisplayItems.isNotEmpty &&
        identical(sessions, _memoAllSessions) &&
        identical(projects, _memoAllProjects) &&
        _searchQuery == _memoSearchQuery &&
        _selectedWorkspaceFilter == _memoSelectedFilter &&
        _groupBy == _memoGroupBy &&
        _sortBy == _memoSortBy) {
      return;
    }

    // L'historique affiche les sessions actives ET archivées (leur emplacement
    // désigné) ; les supprimées restent exclues par le daemon/parser.
    final available = sessions
        .where((s) => (s.isAvailable || s.isArchived) && s.id.isNotEmpty)
        .toList();

    final Set<String> workspaceSet = {};
    for (final s in available) {
      workspaceSet.add(WorkspacePath.displayName(s.workspacePath));
    }
    final workspaces = workspaceSet.toList()..sort();

    var filtered = available;
    if (_selectedWorkspaceFilter != null) {
      filtered = filtered.where((s) => WorkspacePath.displayName(s.workspacePath) == _selectedWorkspaceFilter).toList();
    }

    if (_searchQuery.isNotEmpty) {
      filtered = filtered.where((s) {
        final title = s.title.toLowerCase();
        final ws = WorkspacePath.displayName(s.workspacePath).toLowerCase();
        return title.contains(_searchQuery) || ws.contains(_searchQuery);
      }).toList();
    }

    filtered = sortSessions(sessions: filtered, sortBy: _sortBy);

    final groupedSessions = groupSessions(
      sessions: filtered,
      groupBy: _groupBy,
      projects: projects,
    );

    final List<dynamic> displayItems = [];
    if (_groupBy == SessionGroupBy.none) {
      displayItems.addAll(filtered);
    } else {
      for (final entry in groupedSessions.entries) {
        if (entry.value.isNotEmpty) {
          displayItems.add(entry.key);
          displayItems.addAll(entry.value);
        }
      }
    }

    _memoAllSessions = sessions;
    _memoAllProjects = projects;
    _memoSearchQuery = _searchQuery;
    _memoSelectedFilter = _selectedWorkspaceFilter;
    _memoGroupBy = _groupBy;
    _memoSortBy = _sortBy;
    _memoWorkspaces = workspaces;
    _memoDisplayItems = displayItems;
  }

  @override
  Widget build(BuildContext context) {
    _computePipeline();
    final workspaces = _memoWorkspaces;
    final displayItems = _memoDisplayItems;

    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surface,
      appBar: AppBar(
        backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surfaceContainer,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: scheme.onSurface),
          onPressed: () => Navigator.of(context).pop(),
          tooltip: 'Retour',
        ),
        title: Text(
          'Conversation History',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
            letterSpacing: -0.2,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.refresh_rounded, size: 20, color: scheme.onSurfaceVariant),
            onPressed: () {
              HapticFeedback.selectionClick();
              _loadAllSessions();
              widget.onRefresh?.call();
            },
            tooltip: 'Actualiser',
          ),
          DisplayOptionsMenuButton(
            selectedGroupBy: _groupBy,
            selectedSortBy: _sortBy,
            selectedSubtitle: _subtitle,
            isFilterOpen: true,
            onGroupByChanged: (val) => setState(() => _groupBy = val),
            onSortByChanged: (val) => setState(() => _sortBy = val),
            onSubtitleChanged: (val) => setState(() => _subtitle = val),
            onToggleFilter: () {
              setState(() {
                if (_searchQuery.isNotEmpty || _selectedWorkspaceFilter != null) {
                  _searchController.clear();
                  _selectedWorkspaceFilter = null;
                }
              });
            },
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_isLoading) const LinearProgressIndicator(minHeight: 2),
            // ── Search & Filter Bar ──────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      height: 40,
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        border: Border.all(color: isDark ? const Color(0xFF2C2F36) : scheme.outlineVariant, width: 1),
                      ),
                      child: TextField(
                        controller: _searchController,
                        style: TextStyle(fontSize: 13, color: scheme.onSurface),
                        cursorColor: scheme.primary,
                        decoration: InputDecoration(
                          hintText: 'Search conversations...',
                          hintStyle: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                          prefixIcon: Icon(Icons.search_rounded, size: 18, color: scheme.onSurfaceVariant),
                          suffixIcon: _searchQuery.isNotEmpty
                              ? IconButton(
                                  icon: Icon(Icons.close_rounded, size: 16, color: scheme.onSurfaceVariant),
                                  tooltip: 'Effacer la recherche',
                                  onPressed: () {
                                    _searchController.clear();
                                  },
                                )
                              : null,
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Bouton Filtre par projet
                  PopupMenuButton<String>(
                    tooltip: 'Filtrer par projet',
                    color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      side: BorderSide(color: isDark ? AppColors.borderStrong : scheme.outlineVariant),
                    ),
                    icon: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: _selectedWorkspaceFilter != null
                            ? scheme.primary.withValues(alpha: 0.15)
                            : (isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest),
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        border: Border.all(
                          color: _selectedWorkspaceFilter != null
                              ? scheme.primary
                              : (isDark ? const Color(0xFF2C2F36) : scheme.outlineVariant),
                          width: 1,
                        ),
                      ),
                      child: Icon(
                        Icons.filter_list_rounded,
                        size: 18,
                        color: _selectedWorkspaceFilter != null
                            ? scheme.primary
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                    onSelected: (ws) {
                      setState(() {
                        _selectedWorkspaceFilter = ws.isEmpty ? null : ws;
                      });
                    },
                    itemBuilder: (context) => [
                      PopupMenuItem<String>(
                        value: '',
                        child: Text(
                          'Tous les projets',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurface),
                        ),
                      ),
                      const PopupMenuDivider(),
                      ...workspaces.map(
                        (ws) => PopupMenuItem<String>(
                          value: ws,
                          child: Row(
                            children: [
                              Icon(Icons.folder_outlined, size: 14, color: scheme.onSurfaceVariant),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  ws,
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: _selectedWorkspaceFilter == ws
                                        ? scheme.primary
                                        : scheme.onSurface,
                                    fontWeight: _selectedWorkspaceFilter == ws
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (_selectedWorkspaceFilter == ws)
                                Icon(Icons.check_rounded, size: 16, color: scheme.primary),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Badge de filtre actif (si présent)
            if (_selectedWorkspaceFilter != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.accentBlue.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(color: AppColors.accentBlue.withValues(alpha: 0.3)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.folder_open_rounded, size: 13, color: AppColors.accentBlue),
                          const SizedBox(width: 6),
                          Text(
                            _selectedWorkspaceFilter!,
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w500,
                              color: AppColors.accentBlue,
                            ),
                          ),
                          const SizedBox(width: 6),
                          InkWell(
                            onTap: () => setState(() => _selectedWorkspaceFilter = null),
                            child: const Icon(Icons.close_rounded, size: 13, color: AppColors.accentBlue),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

            // ── Session List ────────────────────────────────────────────────
            Expanded(
              child: displayItems.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      itemCount: displayItems.length,
                      itemBuilder: (context, index) {
                        final item = displayItems[index];

                        if (item is String) {
                          return Padding(
                            padding: const EdgeInsets.fromLTRB(8, 14, 8, 6),
                            child: Row(
                              children: [
                                Icon(Icons.folder_outlined, size: 13, color: scheme.onSurfaceVariant),
                                const SizedBox(width: 6),
                                Text(
                                  item,
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: scheme.onSurfaceVariant,
                                    letterSpacing: 0.2,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }

                        final session = item as CascadeSession;
                        final isActive = session.id == widget.activeSessionId;
                        final isRunning = session.isRunning;
                        final wsName = WorkspacePath.displayName(session.workspacePath);

                        return _ConversationHistoryRow(
                          session: session,
                          workspaceName: wsName,
                          isActive: isActive,
                          isRunning: isRunning,
                          showSubtitle: _subtitle == SessionSubtitle.worktree,
                          onTap: () {
                            HapticFeedback.selectionClick();
                            widget.onSessionSelected(session.id);
                            Navigator.of(context).pop();
                          },
                          onDelete: widget.onDeleteSession != null
                              ? () => widget.onDeleteSession!(session.id)
                              : null,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off_rounded, size: 42, color: scheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(
              _searchQuery.isNotEmpty
                  ? 'Aucune conversation pour "$_searchQuery"'
                  : 'Aucune conversation disponible',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              'Les sessions archivées ou supprimées sont automatiquement filtrées.',
              style: TextStyle(
                fontSize: 12,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            if (_searchQuery.isNotEmpty || _selectedWorkspaceFilter != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () {
                  setState(() {
                    _searchController.clear();
                    _selectedWorkspaceFilter = null;
                  });
                },
                icon: Icon(Icons.refresh_rounded, size: 14, color: scheme.primary),
                label: Text('Effacer les filtres', style: TextStyle(fontSize: 12, color: scheme.primary)),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: scheme.primary),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ConversationHistoryRow extends StatelessWidget {
  final CascadeSession session;
  final String workspaceName;
  final bool isActive;
  final bool isRunning;
  final bool showSubtitle;
  final VoidCallback onTap;
  final VoidCallback? onDelete;

  const _ConversationHistoryRow({
    required this.session,
    required this.workspaceName,
    required this.isActive,
    required this.isRunning,
    this.showSubtitle = true,
    required this.onTap,
    this.onDelete,
  });

  void _showContextMenu(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    HapticFeedback.mediumImpact();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF3B3E47) : scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        session.title,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              Divider(color: isDark ? const Color(0xFF2C2F36) : scheme.outlineVariant),
              ListTile(
                leading: Icon(Icons.copy_rounded, size: 18, color: scheme.onSurface),
                title: Text('Copier le titre', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Clipboard.setData(ClipboardData(text: session.title));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Titre copié dans le presse-papiers'), duration: Duration(seconds: 2)),
                  );
                },
              ),
              ListTile(
                leading: Icon(Icons.tag_rounded, size: 18, color: scheme.onSurface),
                title: Text('Copier l\'identifiant de session', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Clipboard.setData(ClipboardData(text: session.id));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Identifiant de session copié dans le presse-papiers'), duration: Duration(seconds: 2)),
                  );
                },
              ),
              if (onDelete != null)
                ListTile(
                  leading: const Icon(Icons.delete_outline_rounded, size: 18, color: AppColors.danger),
                  title: const Text('Supprimer la conversation', style: TextStyle(fontSize: 13, color: AppColors.danger)),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _confirmDelete(context);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        scrollable: true,
        backgroundColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainer,
        title: Text('Supprimer la conversation ?', style: TextStyle(fontSize: 15, color: scheme.onSurface)),
        content: Text(
          'Voulez-vous supprimer définitivement "${session.title}" ?',
          style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Annuler', style: TextStyle(color: scheme.onSurfaceVariant)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () {
              Navigator.of(ctx).pop();
              onDelete?.call();
            },
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final displayTitle = session.title.trim().isNotEmpty
        ? session.title.trim()
        : 'Nouvelle conversation';

    final runningText = isRunning ? "En cours d'exécution, " : "";
    final timeText = session.time.isNotEmpty ? session.time : "récent";
    return Semantics(
      button: true,
      selected: isActive,
      label: '$displayTitle, $runningText$timeText',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          onLongPress: () => _showContextMenu(context),
          onSecondaryTap: () => _showContextMenu(context),
          borderRadius: BorderRadius.circular(AppRadius.md),
          hoverColor: isDark ? const Color(0xFF1E2127) : scheme.surfaceContainerHighest,
          splashColor: scheme.primary.withValues(alpha: 0.1),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                // Colonne Titre + Workspace
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayTitle,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                          color: isActive ? scheme.primary : (isDark ? const Color(0xFFE4E4E7) : scheme.onSurface),
                          letterSpacing: -0.1,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (showSubtitle) ...[
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Icon(
                              Icons.folder_outlined,
                              size: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                workspaceName,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: scheme.onSurfaceVariant,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),

                const SizedBox(width: 12),

                // Badge « Archivée » : les sessions archivées n'apparaissent
                // que dans cet écran d'historique, jamais dans la sidebar.
                if (session.isArchived) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.archive_outlined, size: 11, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 3),
                        Text(
                          'Archivée',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w600,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                ],

                // Trailing Status: Active blue dot, Spinner, 3 dots waiting, or relative time
                if (isRunning && !session.isWaiting)
                  Tooltip(
                    message: 'En cours d\'exécution',
                    child: AntigravitySpinningArc(
                      size: 13.5,
                      color: isActive ? scheme.primary : (isDark ? const Color(0xFF8E929E) : scheme.outline),
                    ),
                  )
                else if (session.isWaiting)
                  const Tooltip(
                    message: 'En attente…',
                    child: ThreeDotsWaiting(),
                  )
                else if (session.hasUnread && !isActive)
                  Tooltip(
                    message: 'Session terminée — non lue',
                    child: Container(
                      width: 7,
                      height: 7,
                      decoration: const BoxDecoration(
                        color: Color(0xFF1A73E8),
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Color(0x661A73E8),
                            blurRadius: 4,
                            spreadRadius: 0.5,
                          ),
                        ],
                      ),
                    ),
                  )
                else if (session.time.isNotEmpty)
                  Text(
                    session.time,
                    style: TextStyle(
                      fontSize: 11,
                      color: scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w400,
                    ),
                  )
                else
                  Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 11,
                    color: isDark ? const Color(0xFF3F424E) : scheme.outlineVariant,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
