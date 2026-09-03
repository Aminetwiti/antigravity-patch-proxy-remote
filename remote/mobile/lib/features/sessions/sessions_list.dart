import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/protocol/messages.dart';
import '../../core/protocol/workspace_path.dart';
import '../../core/protocol/daemon_api.dart';
import '../../widgets/project_selector_bottom_sheet.dart';
import '../../widgets/antigravity_logo.dart';
import '../../widgets/antigravity_spinning_arc.dart';
import '../../widgets/status_dot_badge.dart';
import 'package:mobile/theme/app_colors.dart';
import 'display_options.dart';

// ── Entrée aplatie de la sidebar (virtualisation ListView.builder) ─────────
class _SidebarEntry {
  final String folderName;
  final ProjectItem? project;
  final CascadeSession? session;
  final bool isHeader;
  final bool isEmptyFolder;

  const _SidebarEntry.header(this.folderName, this.project)
      : session = null,
        isHeader = true,
        isEmptyFolder = false;

  const _SidebarEntry.empty(this.folderName)
      : project = null,
        session = null,
        isHeader = false,
        isEmptyFolder = true;

  const _SidebarEntry.row(this.session, this.folderName)
      : project = null,
        isHeader = false,
        isEmptyFolder = false;

  const _SidebarEntry.spacer()
      : folderName = '',
        project = null,
        session = null,
        isHeader = false,
        isEmptyFolder = false;
}

// ── Workspace Folder Header (séparé pour virtualisation) ───────────────────
class _FolderHeader extends StatelessWidget {
  final String folderName;
  final ProjectItem? project;
  final VoidCallback onToggleCollapse;
  final void Function(ProjectItem? project)? onNewConversation;
  final VoidCallback? onOpenSettings;
  final bool isCollapsed;

  const _FolderHeader({
    super.key,
    required this.folderName,
    this.project,
    required this.onToggleCollapse,
    this.onNewConversation,
    this.onOpenSettings,
    this.isCollapsed = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isConversationsSection = folderName == 'Conversations' || folderName == 'Outside of Project';

    return InkWell(
      onTap: onToggleCollapse,
      borderRadius: BorderRadius.circular(4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          children: [
            if (!isConversationsSection) ...[
              Icon(
                Icons.folder_outlined,
                size: 15,
                color: scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      isConversationsSection ? 'Conversations' : folderName,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: isConversationsSection ? FontWeight.w600 : FontWeight.w500,
                        color: isConversationsSection ? AppColors.inkSecondary : scheme.primary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (isConversationsSection) ...[
                    const SizedBox(width: 4),
                    Icon(
                      isCollapsed ? Icons.keyboard_arrow_right_rounded : Icons.keyboard_arrow_down_rounded,
                      size: 16,
                      color: AppColors.inkSecondary,
                    ),
                  ],
                ],
              ),
            ),
            if (onNewConversation != null)
              IconButton(
                icon: const Icon(Icons.add, size: 16),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                onPressed: () => onNewConversation!(isConversationsSection ? null : project),
                tooltip: 'Nouvelle conversation',
              ),
          ],
        ),
      ),
    );
  }
}

class LeftSidebarDrawer extends StatefulWidget {
  final String activeSessionId;
  final Function(String sessionId) onSessionSelected;
  final Function onNewConversation;
  final VoidCallback? onOpenSettings;
  final VoidCallback? onDiscover;
  final VoidCallback? onOpenWorkspace;
  final VoidCallback? onConversationHistory;
  final VoidCallback? onScheduledTasks;
  final VoidCallback? onOpenBattleArena;
  final VoidCallback? onOpenSidecars;
  final List<CascadeSession>? sessions;
  final List<ProjectItem>? projects;
  final bool isConnected;
  final bool isIdeConnected;
  final VoidCallback onToggleConnection;
  final Function(String id)? onDeleteSession;
  final Function(String id)? onArchiveSession;
  final Function(String id, String newTitle)? onRenameSession;
  final Function(CascadeSession session)? onExportSession;
  final String? focusedDesktopSessionId;
  final Function(String id)? onFocusDesktop;
  final DaemonApi? api;

  const LeftSidebarDrawer({
    super.key,
    required this.activeSessionId,
    required this.onSessionSelected,
    required this.onNewConversation,
    this.onOpenSettings,
    this.onDiscover,
    this.onOpenWorkspace,
    this.onConversationHistory,
    this.onScheduledTasks,
    this.onOpenBattleArena,
    this.onOpenSidecars,
    this.sessions,
    this.projects,
    this.isConnected = false,
    this.isIdeConnected = true,
    required this.onToggleConnection,
    this.onDeleteSession,
    this.onArchiveSession,
    this.onRenameSession,
    this.onExportSession,
    this.focusedDesktopSessionId,
    this.onFocusDesktop,
    this.api,
  });

  @override
  State<LeftSidebarDrawer> createState() => _LeftSidebarDrawerState();
}

class _LeftSidebarDrawerState extends State<LeftSidebarDrawer> {
  final ScrollController _scrollController = ScrollController();
  final Set<String> _collapsedFolders = {};
  bool _isFilterOpen = false;
  final TextEditingController _filterController = TextEditingController();
  String _filterQuery = '';

  SessionGroupBy _groupBy = SessionGroupBy.project;
  SessionSortBy _sortBy = SessionSortBy.lastUpdated;
  SessionSubtitle _subtitle = SessionSubtitle.none;

  // P4 : sessions épinglées — synchronisées localement et avec le daemon.
  final Set<String> _pinnedIds = {};
  bool _pinnedExpanded = true;

  // Suivi des sessions consultées pour afficher le point bleu (activité terminée non lue)
  final Set<String> _readSessionIds = {};

  @override
  void initState() {
    super.initState();
    _loadPins();
    _loadReadSessions();
    _loadCollapsedFolders();
    _loadDisplayOptions();
  }

  @override
  void didUpdateWidget(covariant LeftSidebarDrawer old) {
    super.didUpdateWidget(old);
    // Synchronisation bidirectionnelle des pins avec le daemon et Antigravity 2.0
    _syncPinsWithSessions(widget.sessions);
    _syncReadStateWithSessions(widget.sessions);
    if (widget.activeSessionId != old.activeSessionId && widget.activeSessionId.isNotEmpty) {
      _markSessionAsRead(widget.activeSessionId);
    }
  }

  void _syncPinsWithSessions(List<CascadeSession>? sessions) {
    if (sessions == null || sessions.isEmpty) return;
    bool changed = false;
    for (final s in sessions) {
      if (s.isPinned && !_pinnedIds.contains(s.id)) {
        _pinnedIds.add(s.id);
        changed = true;
      } else if (!s.isPinned && _pinnedIds.contains(s.id)) {
        _pinnedIds.remove(s.id);
        changed = true;
      }
    }
    if (changed) {
      setState(() {});
      SharedPreferences.getInstance().then((prefs) =>
          prefs.setStringList('pinned_session_ids', _pinnedIds.toList()));
    }
  }

  void _syncReadStateWithSessions(List<CascadeSession>? sessions) {
    if (sessions == null || sessions.isEmpty) return;
    bool changed = false;
    for (final s in sessions) {
      if (!s.hasUnread && !_readSessionIds.contains(s.id)) {
        _readSessionIds.add(s.id);
        changed = true;
      } else if (s.hasUnread && _readSessionIds.contains(s.id)) {
        _readSessionIds.remove(s.id);
        changed = true;
      }
    }
    if (changed) {
      setState(() {});
      SharedPreferences.getInstance().then((prefs) =>
          prefs.setStringList('read_session_ids', _readSessionIds.toList()));
    }
  }

  Future<void> _loadCollapsedFolders() async {
    final prefs = await SharedPreferences.getInstance();
    final collapsed = prefs.getStringList('collapsed_folder_names') ?? const [];
    if (!mounted) return;
    setState(() {
      _collapsedFolders.addAll(collapsed);
    });
  }

  void _saveCollapsedFolders() {
    SharedPreferences.getInstance().then((prefs) =>
        prefs.setStringList('collapsed_folder_names', _collapsedFolders.toList()));
  }

  Future<void> _loadDisplayOptions() async {
    final prefs = await SharedPreferences.getInstance();
    final groupIndex = prefs.getInt('session_group_by');
    final sortIndex = prefs.getInt('session_sort_by');
    final subIndex = prefs.getInt('session_subtitle');
    if (!mounted) return;
    setState(() {
      if (groupIndex != null && groupIndex >= 0 && groupIndex < SessionGroupBy.values.length) {
        _groupBy = SessionGroupBy.values[groupIndex];
      }
      if (sortIndex != null && sortIndex >= 0 && sortIndex < SessionSortBy.values.length) {
        _sortBy = SessionSortBy.values[sortIndex];
      }
      if (subIndex != null && subIndex >= 0 && subIndex < SessionSubtitle.values.length) {
        _subtitle = SessionSubtitle.values[subIndex];
      }
    });
  }

  void _saveDisplayOptions() {
    SharedPreferences.getInstance().then((prefs) {
      prefs.setInt('session_group_by', _groupBy.index);
      prefs.setInt('session_sort_by', _sortBy.index);
      prefs.setInt('session_subtitle', _subtitle.index);
    });
  }

  Future<void> _loadPins() async {
    final prefs = await SharedPreferences.getInstance();
    final ids = prefs.getStringList('pinned_session_ids') ?? const [];
    if (!mounted) return;
    setState(() {
      _pinnedIds.clear();
      // Si les sessions du daemon sont déjà disponibles, leur statut isPinned fait autorité
      if (widget.sessions != null && widget.sessions!.isNotEmpty) {
        for (final s in widget.sessions!) {
          if (s.isPinned) _pinnedIds.add(s.id);
        }
      } else {
        _pinnedIds.addAll(ids);
      }
    });
  }

  Future<void> _loadReadSessions() async {
    final prefs = await SharedPreferences.getInstance();
    final ids = prefs.getStringList('read_session_ids') ?? const [];
    if (!mounted) return;
    setState(() {
      _readSessionIds.clear();
      if (widget.sessions != null && widget.sessions!.isNotEmpty) {
        for (final s in widget.sessions!) {
          if (!s.hasUnread) {
            _readSessionIds.add(s.id);
          }
        }
      } else {
        _readSessionIds.addAll(ids);
      }
      if (widget.activeSessionId.isNotEmpty) {
        _readSessionIds.add(widget.activeSessionId);
      }
    });
  }

  void _markSessionAsRead(String id) {
    widget.api?.markSessionRead(id);
    if (_readSessionIds.contains(id)) return;
    setState(() {
      _readSessionIds.add(id);
    });
    SharedPreferences.getInstance().then((prefs) =>
        prefs.setStringList('read_session_ids', _readSessionIds.toList()));
  }

  void _markSessionAsUnread(String id) {
    widget.api?.markSessionUnread(id);
    if (!_readSessionIds.contains(id)) return;
    setState(() {
      _readSessionIds.remove(id);
    });
    SharedPreferences.getInstance().then((prefs) =>
        prefs.setStringList('read_session_ids', _readSessionIds.toList()));
  }

  void _toggleRead(String id) {
    HapticFeedback.selectionClick();
    if (_readSessionIds.contains(id)) {
      _markSessionAsUnread(id);
    } else {
      _markSessionAsRead(id);
    }
  }

  void _togglePin(String id) {
    HapticFeedback.selectionClick();
    final isNowPinned = !_pinnedIds.contains(id);
    setState(() {
      if (isNowPinned) {
        _pinnedIds.add(id);
      } else {
        _pinnedIds.remove(id);
      }
    });
    // ponytail: fire-and-forget, SharedPreferences garde le dernier état écrit.
    SharedPreferences.getInstance().then((prefs) =>
        prefs.setStringList('pinned_session_ids', _pinnedIds.toList()));
    if (isNowPinned) {
      widget.api?.pinCascade(id, pinned: true);
    } else {
      widget.api?.unpinCascade(id);
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _filterController.dispose();
    super.dispose();
  }

  // Guard anti-rebond contre les clics rapides créant des sessions fantômes concurrentes.
  bool _isDispatchingNewSession = false;

  void _callNewConversation([ProjectItem? project]) {
    if (_isDispatchingNewSession) return;
    _isDispatchingNewSession = true;
    final fn = widget.onNewConversation;
    try {
      if (fn is void Function(ProjectItem?)) {
        fn(project);
      } else if (fn is void Function([ProjectItem?])) {
        fn(project);
      } else if (fn is VoidCallback) {
        fn();
      } else {
        try {
          (fn as dynamic)(project);
        } catch (_) {
          (fn as dynamic)();
        }
      }
    } finally {
      Future.delayed(const Duration(milliseconds: 500), () {
        if (mounted) _isDispatchingNewSession = false;
      });
    }
  }

  void _handleNewConversation(BuildContext context, ColorScheme scheme, bool isDark) {
    final projs = widget.projects ?? [];
    if (projs.length <= 1) {
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
      _callNewConversation(projs.isNotEmpty ? projs.first : null);
      return;
    }

    ProjectSelectorBottomSheet.show(
      context,
      projects: projs,
      activeProjectPath: null,
      onSelectProject: (p) {
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
        _callNewConversation(p);
      },
    );
  }

  // ── Mémoïsation du pipeline filtre → tri → pins → groupe ──────────────
  // Le pipeline complet (4 passes + tri + groupage) était recalculé à chaque
  // build, donc à chaque évènement daemon (stream_start/end, refresh 15 s,
  // hover setState…) même quand ni la liste ni les filtres n'avaient changé.
  List<CascadeSession>? _pipeSessionsInput;
  String? _pipeQuery;
  SessionSortBy? _pipeSort;
  SessionGroupBy? _pipeGroup;
  Set<String>? _pipePinned;
  List<ProjectItem>? _pipeProjects;
  Map<String, List<CascadeSession>>? _pipeResult;

  Map<String, List<CascadeSession>> _projectSessionsOf() {
    final sessions = widget.sessions ?? const <CascadeSession>[];
    final projects = widget.projects;
    final pinnedSnapshot = Set<String>.of(_pinnedIds);
    if (_pipeResult != null &&
        identical(sessions, _pipeSessionsInput) &&
        _filterQuery == _pipeQuery &&
        _sortBy == _pipeSort &&
        _groupBy == _pipeGroup &&
        setEquals(pinnedSnapshot, _pipePinned) &&
        identical(projects, _pipeProjects)) {
      return _pipeResult!;
    }

    final seen = <String>{};
    final availableSessions = <CascadeSession>[];
    for (final s in sessions) {
      if (!s.isAvailable || s.id.isEmpty || s.isSubagent || s.isArchived) continue;
      final stUpper = s.status.toUpperCase();
      if (stUpper.contains('ARCHIV') || stUpper.contains('DELET') || stUpper.contains('TRASH') || stUpper.contains('KILLED')) continue;
      final normId = s.id.toLowerCase();
      if (seen.contains(normId)) continue;
      seen.add(normId);
      if (_filterQuery.isNotEmpty) {
        final q = _filterQuery.toLowerCase();
        if (!s.title.toLowerCase().contains(q) && !s.workspacePath.toLowerCase().contains(q)) {
          continue;
        }
      }
      availableSessions.add(s);
    }

    final sortedSessions = sortSessions(
      sessions: availableSessions,
      sortBy: _sortBy,
    );

    // Dans l'arbre des projets, on affiche les sessions non épinglées
    // (les épinglées sont déjà affichées dans la section Pinned Conversations dédiée au sommet).
    final nonPinnedSessions = sortedSessions.where((s) => !_pinnedIds.contains(s.id)).toList();

    final result = groupSessions(
      sessions: nonPinnedSessions,
      groupBy: _groupBy,
      projects: projects,
    );
    _pipeSessionsInput = sessions;
    _pipeQuery = _filterQuery;
    _pipeSort = _sortBy;
    _pipeGroup = _groupBy;
    _pipePinned = pinnedSnapshot;
    _pipeProjects = projects;
    _pipeResult = result;
    return result;
  }

  // Aplatissement virtualise : dossiers + lignes en UNE ListView.builder.
  // Avant, chaque dossier etait un Column qui construisait TOUTES ses lignes
  // de maniere avide (aucune virtualisation) ; le matching projet/dossier
  // etait en O(projects x dossiers) a chaque build. Ici la liste aplatie est
  // memoisee et seuls les items visibles sont construits par le builder.
  Map<String, List<CascadeSession>>? _flatInput;
  Set<String>? _flatCollapsed;
  SessionGroupBy? _flatGroup;
  List<_SidebarEntry>? _flatResult;

  List<_SidebarEntry> _entriesOf(Map<String, List<CascadeSession>> projectSessions) {
    final collapsedSnapshot = Set<String>.of(_collapsedFolders);
    if (_flatResult != null &&
        identical(projectSessions, _flatInput) &&
        setEquals(collapsedSnapshot, _flatCollapsed) &&
        _groupBy == _flatGroup) {
      return _flatResult!;
    }

    final hideHeader = _groupBy == SessionGroupBy.none;
    final projs = widget.projects;
    final entries = <_SidebarEntry>[];
    final matchCache = <String, ProjectItem?>{};

    ProjectItem? projectFor(String folder, List<CascadeSession> sessions) {
      return matchCache.putIfAbsent(folder, () {
        ProjectItem? m;
        if (projs != null) {
          for (final p in projs) {
            if (p.name == folder || p.path == folder || p.id == folder || WorkspacePath.isSameWorkspace(p.path, folder)) {
              m = p;
              break;
            }
          }
        }
        return m ??
            ProjectItem(
              id: '',
              name: folder,
              folderUri: sessions.isNotEmpty ? sessions.first.workspacePath : folder,
              path: sessions.isNotEmpty ? sessions.first.workspacePath : folder,
            );
      });
    }

    projectSessions.forEach((folder, sessions) {
      if (!hideHeader && folder.isNotEmpty) {
        entries.add(_SidebarEntry.header(folder, projectFor(folder, sessions)));
      }
      if (!collapsedSnapshot.contains(folder)) {
        if (sessions.isEmpty) {
          if (folder.isNotEmpty) {
            entries.add(_SidebarEntry.empty(folder));
          }
        } else {
          entries.addAll(
            sessions.map((s) => _SidebarEntry.row(s, folder)),
          );
        }
      }
      if (folder.isNotEmpty || sessions.isNotEmpty) {
        entries.add(const _SidebarEntry.spacer());
      }
    });

    _flatInput = projectSessions;
    _flatCollapsed = collapsedSnapshot;
    _flatGroup = _groupBy;
    _flatResult = entries;
    return entries;
  }

  Widget _buildHostSwitcherPill(BuildContext context, ColorScheme scheme, bool isDark) {
    final host = widget.api?.host ?? 'localhost';
    final isConnected = widget.isConnected;

    return InkWell(
      onTap: () {
        showModalBottomSheet(
          context: context,
          backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surface,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          ),
          builder: (ctx) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isConnected ? AppColors.positive : scheme.error,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Hôte distant : $host',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: scheme.onSurface,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        isConnected ? 'Connecté' : 'Déconnecté',
                        style: TextStyle(
                          fontSize: 12,
                          color: isConnected ? AppColors.positive : scheme.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Machine active pour les sessions et commandes terminal.',
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.of(ctx).pop();
                            widget.onToggleConnection();
                          },
                          icon: Icon(isConnected ? Icons.link_off : Icons.link, size: 16),
                          label: Text(isConnected ? 'Déconnecter' : 'Reconnecter'),
                        ),
                      ),
                      if (widget.onDiscover != null) ...[
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              if (Navigator.of(context).canPop()) Navigator.of(context).pop();
                              widget.onDiscover!();
                            },
                            icon: const Icon(Icons.qr_code_scanner, size: 16),
                            label: const Text('Changer d\'hôte'),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3.5),
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          border: Border.all(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
            width: 0.8,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isConnected ? AppColors.positive : scheme.error,
              ),
            ),
            const SizedBox(width: 5),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 100),
              child: Text(
                host,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 13,
              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final projectSessions = _projectSessionsOf();
    final entries = _entriesOf(projectSessions);
    final projectNames = projectSessions.keys.toList();

    return Drawer(
      backgroundColor: Theme.of(context).colorScheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 6),

            // ── Top Navigation Bar: Antigravity Brand Lockup + Host Switcher + Action Buttons
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const AntigravityLogo(
                          size: 22,
                          showGlow: true,
                        ),
                        const SizedBox(width: 8),
                        Flexible(child: _buildHostSwitcherPill(context, scheme, isDark)),
                      ],
                    ),
                  ),
                  _HeaderIconBtn(
                    icon: Icons.history,
                    tooltip: 'Historique des conversations',
                    onTap: () {
                      if (widget.onConversationHistory != null) {
                        if (Navigator.of(context).canPop()) {
                          Navigator.of(context).pop();
                        }
                        widget.onConversationHistory!();
                      }
                    },
                  ),
                  const SizedBox(width: 4),
                  _HeaderIconBtn(
                    icon: Icons.dock_outlined,
                    tooltip: 'Masquer la barre',
                    onTap: () {
                      if (Navigator.of(context).canPop()) {
                        Navigator.of(context).pop();
                      }
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: 8),

            // ── "+ New Conversation" Button
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    _handleNewConversation(context, scheme, isDark);
                  },
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                    decoration: BoxDecoration(
                      color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                      border: Border.all(
                        color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                        width: 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.add, size: 16, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 10),
                        Text(
                          'New Conversation',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: scheme.onSurface,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 6),

            // ── Action Items: Conversation History & Scheduled Tasks
            _SidebarActionItem(
              icon: Icons.history_rounded,
              label: 'Conversation History',
              isSelected: false,
              onTap: () {
                Navigator.of(context).pop();
                widget.onConversationHistory?.call();
              },
            ),
            _SidebarActionItem(
              icon: Icons.access_time_rounded,
              label: 'Scheduled Tasks',
              isSelected: false,
              onTap: () {
                Navigator.of(context).pop();
                widget.onScheduledTasks?.call();
              },
            ),

            const SizedBox(height: 6),

            // ── Pinned Conversations Section (Desktop 1:1)
            Builder(
              builder: (context) {
                final seenPinned = <String>{};
                final pinnedSessions = <CascadeSession>[];
                for (final s in (widget.sessions ?? const <CascadeSession>[])) {
                  if (!s.isAvailable || s.id.isEmpty || s.isArchived || !_pinnedIds.contains(s.id)) continue;
                  final stUpper = s.status.toUpperCase();
                  if (stUpper.contains('ARCHIV') || stUpper.contains('DELET') || stUpper.contains('TRASH') || stUpper.contains('KILLED')) continue;
                  final normId = s.id.toLowerCase();
                  if (seenPinned.contains(normId)) continue;
                  seenPinned.add(normId);
                  pinnedSessions.add(s);
                }
                pinnedSessions.sort((a, b) {
                  if (a.pinnedAt != null && b.pinnedAt != null) {
                    return a.pinnedAt!.compareTo(b.pinnedAt!);
                  }
                  if (a.pinnedAt != null) return -1;
                  if (b.pinnedAt != null) return 1;
                  return 0;
                });
                if (pinnedSessions.isEmpty) return const SizedBox.shrink();

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                      child: InkWell(
                        onTap: () {
                          HapticFeedback.selectionClick();
                          setState(() => _pinnedExpanded = !_pinnedExpanded);
                        },
                        borderRadius: BorderRadius.circular(4),
                        child: Row(
                          children: [
                            const Text(
                              'Pinned Conversations',
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.accentBlue,
                              ),
                            ),
                            const Spacer(),
                            Icon(
                              _pinnedExpanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                              size: 16,
                              color: AppColors.accentBlue,
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_pinnedExpanded) ...[
                      for (final s in pinnedSessions)
                        _SessionRowItem(
                          key: ValueKey('pinned_${s.id}'),
                          session: s,
                          isSelected: s.id == widget.activeSessionId,
                          showSubtitle: false,
                          isUnread: (s.hasUnread || (s.stepCount >= 1 && !s.isRunning)) &&
                              !_readSessionIds.contains(s.id) &&
                              s.id != widget.activeSessionId,
                          onTap: () {
                            _markSessionAsRead(s.id);
                            if (Navigator.of(context).canPop()) {
                              Navigator.of(context).pop();
                            }
                            widget.onSessionSelected(s.id);
                          },
                          onDelete: widget.onDeleteSession != null
                              ? () => widget.onDeleteSession!(s.id)
                              : null,
                          onArchive: widget.onArchiveSession != null
                              ? () => widget.onArchiveSession!(s.id)
                              : null,
                          onRename: widget.onRenameSession != null
                              ? (newTitle) => widget.onRenameSession!(s.id, newTitle)
                              : null,
                          onExport: widget.onExportSession != null
                              ? () => widget.onExportSession!(s)
                              : null,
                          isPinned: true,
                          isPinnedSection: true,
                          isDesktopFocused: s.id == widget.focusedDesktopSessionId,
                          onFocusDesktop: () => widget.onFocusDesktop?.call(s.id),
                          onTogglePin: () => _togglePin(s.id),
                          onToggleRead: () => _toggleRead(s.id),
                        ),
                      const SizedBox(height: 6),
                    ],
                  ],
                );
              },
            ),

            // ── Section Header: Projects [display options] [new folder]
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Row(
                children: [
                  Text(
                    _groupBy == SessionGroupBy.project
                        ? 'Projects'
                        : _groupBy == SessionGroupBy.workspace
                            ? 'Workspaces'
                            : _groupBy == SessionGroupBy.status
                                ? 'Status'
                                : 'Conversations',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.inkSecondary,
                    ),
                  ),
                  const Spacer(),
                  DisplayOptionsMenuButton(
                    selectedGroupBy: _groupBy,
                    selectedSortBy: _sortBy,
                    selectedSubtitle: _subtitle,
                    isFilterOpen: _isFilterOpen,
                    onGroupByChanged: (val) {
                      setState(() => _groupBy = val);
                      _saveDisplayOptions();
                    },
                    onSortByChanged: (val) {
                      setState(() => _sortBy = val);
                      _saveDisplayOptions();
                    },
                    onSubtitleChanged: (val) {
                      setState(() => _subtitle = val);
                      _saveDisplayOptions();
                    },
                    onToggleFilter: () {
                      HapticFeedback.selectionClick();
                      setState(() {
                        _isFilterOpen = !_isFilterOpen;
                        if (!_isFilterOpen) {
                          _filterController.clear();
                          _filterQuery = '';
                        }
                      });
                    },
                  ),
                  _HeaderIconBtn(
                    icon: _collapsedFolders.length >= projectNames.length && projectNames.isNotEmpty
                        ? Icons.unfold_more_rounded
                        : Icons.unfold_less_rounded,
                    tooltip: _collapsedFolders.length >= projectNames.length && projectNames.isNotEmpty
                        ? 'Développer tout'
                        : 'Réduire tout',
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() {
                        if (_collapsedFolders.length >= projectNames.length && projectNames.isNotEmpty) {
                          _collapsedFolders.clear();
                        } else {
                          _collapsedFolders.addAll(projectNames);
                        }
                      });
                      _saveCollapsedFolders();
                    },
                    size: 15,
                  ),
                  const SizedBox(width: 6),
                  _HeaderIconBtn(
                    icon: Icons.create_new_folder_outlined,
                    tooltip: 'Ouvrir workspace',
                    onTap: () {
                      Navigator.of(context).pop();
                      widget.onOpenWorkspace?.call();
                    },
                    size: 15,
                  ),
                ],
              ),
            ),

            // ── Champ de recherche / filtre interactif (P6)
            if (_isFilterOpen)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                child: SizedBox(
                  height: 32,
                  child: TextField(
                    controller: _filterController,
                    autofocus: true,
                    style: TextStyle(fontSize: 12, color: scheme.onSurface),
                    decoration: InputDecoration(
                      hintText: 'Filtrer les conversations...',
                      hintStyle: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
                      prefixIcon: Icon(Icons.filter_list_rounded, size: 14, color: scheme.primary),
                      prefixIconConstraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                      suffixIcon: _filterQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded, size: 13),
                              padding: EdgeInsets.zero,
                              onPressed: () {
                                _filterController.clear();
                                setState(() => _filterQuery = '');
                              },
                            )
                          : null,
                      filled: true,
                      fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        borderSide: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, width: 1),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        borderSide: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, width: 1),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        borderSide: BorderSide(color: scheme.primary, width: 1),
                      ),
                    ),
                    onChanged: (val) {
                      setState(() => _filterQuery = val.trim());
                    },
                  ),
                ),
              ),

            const SizedBox(height: 4),

            // ── Workspaces & Sessions Tree
            Expanded(
              child: RawScrollbar(
                controller: _scrollController,
                thumbVisibility: false,
                thickness: 3,
                radius: const Radius.circular(2),
                thumbColor: AppColors.borderStrong.withValues(alpha: 0.6),
                child: projectNames.isEmpty
                    ? ListView(
                        controller: _scrollController,
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                        children: [
                          _EmptyState(
                            isConnected: widget.isConnected,
                            onConnect: () {
                              Navigator.of(context).pop();
                              widget.onToggleConnection();
                            },
                          ),
                        ],
                      )
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                        itemCount: entries.length + 1,
                        itemBuilder: (ctx, index) {
                          if (index == entries.length) {
                            return const SizedBox(height: 16);
                          }
                          final entry = entries[index];

                          // En-tete de dossier (virtualise, memoise)
                          if (entry.isHeader) {
                            final folder = entry.folderName;
                            final isCollapsed = _collapsedFolders.contains(folder);
                            return _FolderHeader(
                              key: ValueKey('folder_$folder'),
                              folderName: folder,
                              project: entry.project,
                              isCollapsed: isCollapsed,
                              onToggleCollapse: () {
                                setState(() {
                                  if (isCollapsed) {
                                    _collapsedFolders.remove(folder);
                                  } else {
                                    _collapsedFolders.add(folder);
                                  }
                                });
                                _saveCollapsedFolders();
                              },
                              onNewConversation: (ProjectItem? p) {
                                if (Navigator.of(context).canPop()) {
                                  Navigator.of(context).pop();
                                }
                                _callNewConversation(p ?? entry.project);
                              },
                              onOpenSettings: () {
                                Navigator.of(context).pop();
                                widget.onOpenSettings?.call();
                              },
                            );
                          }

                          // Dossier vide
                          if (entry.isEmptyFolder) {
                            return const Padding(
                              padding: EdgeInsets.only(left: 28, top: 4, bottom: 8),
                              child: Text(
                                'No conversations yet',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontStyle: FontStyle.italic,
                                  color: AppColors.inkMuted,
                                ),
                              ),
                            );
                          }

                          // Ligne de session
                          final s = entry.session;
                          if (s != null) {
                            return _SessionRowItem(
                              key: ValueKey('session_${s.id}'),
                              session: s,
                              isSelected: s.id == widget.activeSessionId,
                              showSubtitle: _subtitle == SessionSubtitle.worktree || (_groupBy == SessionGroupBy.none && s.workspacePath.isNotEmpty),
                              isUnread: (s.hasUnread || (s.stepCount >= 1 && !s.isRunning)) && !_readSessionIds.contains(s.id) && s.id != widget.activeSessionId,
                              onTap: () {
                                _markSessionAsRead(s.id);
                                if (Navigator.of(context).canPop()) {
                                  Navigator.of(context).pop();
                                }
                                widget.onSessionSelected(s.id);
                              },
                              onDelete: widget.onDeleteSession != null
                                  ? () => widget.onDeleteSession!(s.id)
                                  : null,
                              onArchive: widget.onArchiveSession != null
                                  ? () => widget.onArchiveSession!(s.id)
                                  : null,
                              onRename: widget.onRenameSession != null
                                  ? (newTitle) => widget.onRenameSession!(s.id, newTitle)
                                  : null,
                              onExport: widget.onExportSession != null
                                  ? () => widget.onExportSession!(s)
                                  : null,
                              isPinned: _pinnedIds.contains(s.id),
                              isDesktopFocused: s.id == widget.focusedDesktopSessionId,
                              onFocusDesktop: () => widget.onFocusDesktop?.call(s.id),
                              onTogglePin: () => _togglePin(s.id),
                              onToggleRead: () => _toggleRead(s.id),
                            );
                          }

                          return const SizedBox(height: 4);
                        },
                      ),
              ),
            ),

            const _Divider(),

            // ── Bottom: Settings + Connection status
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 2, 8, 4),
              child: Column(
                children: [
                  _SidebarActionItem(
                    icon: Icons.settings_outlined,
                    label: 'Settings',
                    onTap: () {
                      Navigator.of(context).pop();
                      widget.onOpenSettings?.call();
                    },
                  ),
                  _ConnectionRow(
                    isConnected: widget.isConnected,
                    onTap: () {
                      Navigator.of(context).pop();
                      widget.onToggleConnection();
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Header Icon Button
class _HeaderIconBtn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final double size;

  const _HeaderIconBtn({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.size = 17,
  });

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadius.xs),
            child: Padding(
              padding: const EdgeInsets.all(5),
              child: Icon(icon, size: size, color: AppColors.inkSecondary),
            ),
          ),
        ),
      );
}

// ── Sidebar Action Item (History, Scheduled Tasks, Settings)
class _SidebarActionItem extends StatefulWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool isSelected;

  const _SidebarActionItem({
    required this.icon,
    required this.label,
    this.onTap,
    this.isSelected = false,
  });

  @override
  State<_SidebarActionItem> createState() => _SidebarActionItemState();
}

class _SidebarActionItemState extends State<_SidebarActionItem> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final isSelected = widget.isSelected;
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onTap?.call();
        },
        child: AnimatedContainer(
          duration: AppMotion.fast,
          curve: AppMotion.easeOut,
          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.surfaceHover
                : (_hovered ? AppColors.surfacePressed : Colors.transparent),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Row(
            children: [
              Icon(
                widget.icon,
                size: 16,
                color: isSelected ? AppColors.inkPrimary : AppColors.inkSecondary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  widget.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w500 : FontWeight.w400,
                    color: isSelected ? AppColors.inkPrimary : AppColors.inkSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Individual Session Row Item
class _SessionRowItem extends StatefulWidget {
  final CascadeSession session;
  final bool isSelected;
  final bool showSubtitle;
  final bool isUnread;
  final VoidCallback onTap;
  final VoidCallback? onDelete;
  final VoidCallback? onArchive;
  final Function(String newTitle)? onRename;
  final VoidCallback? onExport;

  // P4 : épinglage local
  final bool isPinned;
  final bool isPinnedSection;
  final bool isDesktopFocused;
  final VoidCallback? onFocusDesktop;
  final VoidCallback? onTogglePin;
  final VoidCallback? onToggleRead;

  const _SessionRowItem({
    super.key,
    required this.session,
    required this.isSelected,
    this.showSubtitle = true,
    this.isUnread = false,
    required this.onTap,
    this.onDelete,
    this.onArchive,
    this.onRename,
    this.onExport,
    this.isPinned = false,
    this.isPinnedSection = false,
    this.isDesktopFocused = false,
    this.onFocusDesktop,
    this.onTogglePin,
    this.onToggleRead,
  });

  @override
  State<_SessionRowItem> createState() => _SessionRowItemState();
}

class _SessionRowItemState extends State<_SessionRowItem> {
  bool _hovered = false;
  static final RegExp _cleanTitleRe = RegExp(r'\[([^\]]+)\]\([^\)]+\)');

  void _showSessionContextMenu(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    HapticFeedback.mediumImpact();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
      shape: RoundedRectangleBorder(
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
                  color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.session.title,
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
              Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
              if (widget.onFocusDesktop != null)
                ListTile(
                  leading: Icon(Icons.desktop_windows_outlined, size: 18, color: scheme.onSurface),
                  title: Text('Ouvrir sur le PC (Focus IDE)', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                  subtitle: widget.isDesktopFocused
                      ? Text('Actuellement ouvert sur l\'écran PC', style: TextStyle(fontSize: 11, color: AppColors.online))
                      : null,
                  onTap: () {
                    Navigator.of(ctx).pop();
                    widget.onFocusDesktop?.call();
                  },
                ),
              ListTile(
                leading: Icon(Icons.edit_outlined, size: 18, color: scheme.onSurface),
                title: Text('Renommer la conversation', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _promptRename(context);
                },
              ),
              if (widget.onTogglePin != null)
                ListTile(
                  leading: Icon(
                    widget.isPinned ? Icons.push_pin_rounded : Icons.push_pin_outlined,
                    size: 18,
                    color: scheme.onSurface,
                  ),
                  title: Text(
                    widget.isPinned ? 'Désépingler la conversation' : 'Épingler la conversation',
                    style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  ),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    widget.onTogglePin?.call();
                  },
                ),
              if (widget.onToggleRead != null)
                ListTile(
                  leading: Icon(
                    widget.isUnread ? Icons.mark_chat_read_outlined : Icons.mark_chat_unread_outlined,
                    size: 18,
                    color: scheme.onSurface,
                  ),
                  title: Text(
                    widget.isUnread ? 'Marquer comme lue' : 'Marquer comme non-lue',
                    style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  ),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    widget.onToggleRead?.call();
                  },
                ),
              if (widget.onExport != null)
                ListTile(
                  leading: Icon(Icons.download_rounded, size: 18, color: scheme.onSurface),
                  title: Text('Exporter en Markdown', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    widget.onExport?.call();
                  },
                ),
              ListTile(
                leading: Icon(Icons.copy_rounded, size: 18, color: scheme.onSurface),
                title: Text('Copier le titre', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Clipboard.setData(ClipboardData(text: widget.session.title));
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
                  Clipboard.setData(ClipboardData(text: widget.session.id));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Identifiant de session copié dans le presse-papiers'), duration: Duration(seconds: 2)),
                  );
                },
              ),
              if (widget.onArchive != null)
                ListTile(
                  leading: Icon(
                    widget.session.isArchived ? Icons.unarchive_outlined : Icons.archive_outlined,
                    size: 18,
                    color: scheme.onSurface,
                  ),
                  title: Text(
                    widget.session.isArchived ? 'Désarchiver la conversation' : 'Archiver la conversation',
                    style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  ),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    widget.onArchive?.call();
                  },
                ),
              if (widget.onDelete != null)
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

  void _promptRename(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final controller = TextEditingController(text: widget.session.title);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        scrollable: true,
        backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        title: Text('Renommer la conversation', style: TextStyle(fontSize: 15, color: scheme.onSurface)),
        content: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.done,
          onSubmitted: (val) {
            final newTitle = val.trim();
            Navigator.of(ctx).pop();
            if (newTitle.isNotEmpty && newTitle != widget.session.title) {
              widget.onRename?.call(newTitle);
            }
          },
          style: TextStyle(fontSize: 13, color: scheme.onSurface),
          decoration: InputDecoration(
            hintText: 'Nouveau titre...',
            hintStyle: TextStyle(color: scheme.onSurfaceVariant),
            filled: true,
            fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Annuler', style: TextStyle(color: scheme.onSurfaceVariant)),
          ),
          FilledButton(
            autofocus: true,
            onPressed: () {
              final newTitle = controller.text.trim();
              Navigator.of(ctx).pop();
              if (newTitle.isNotEmpty && newTitle != widget.session.title) {
                widget.onRename?.call(newTitle);
              }
            },
            child: const Text('Enregistrer'),
          ),
        ],
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
        backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        title: Text('Supprimer la conversation ?', style: TextStyle(fontSize: 15, color: scheme.onSurface)),
        content: Text(
          'Voulez-vous supprimer définitivement "${widget.session.title}" ?',
          style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Annuler', style: TextStyle(color: scheme.onSurfaceVariant)),
          ),
          FilledButton(
            autofocus: true,
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () {
              Navigator.of(ctx).pop();
              widget.onDelete?.call();
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
    final isSelected = widget.isSelected;
    final isWaiting = widget.session.isWaitingAction || widget.session.isBackgroundTask;
    final isRunning = widget.session.isRunning && !isWaiting;
    final isUnread = (widget.isUnread || widget.session.hasUnread) && !isSelected && !isRunning && !isWaiting;
    final cleaned = widget.session.title.trim().replaceAll('**', '').replaceFirst(RegExp(r'^Task:\s*', caseSensitive: false), '').trim();
    final rawTitle = cleaned.isNotEmpty ? cleaned : 'Nouvelle conversation';
    // Point 9 : remplacer [nom](url) par @nom propre
    final displayTitle = rawTitle.contains('[')
        ? rawTitle.replaceAllMapped(
            _cleanTitleRe,
            (m) => '@${m.group(1)}',
          )
        : rawTitle;
    final subtitleText = widget.session.worktree ?? WorkspacePath.displayName(widget.session.workspacePath);
    final pinText = widget.isPinned ? "Épinglée, " : "";
    final runningText = isRunning ? "En cours d'exécution, " : "";
    final timeText = widget.session.time.isNotEmpty ? widget.session.time : "récent";

    final ideTag = widget.session.isIde ? ' [Antigravity IDE]' : '';
    Widget item = Tooltip(
      message: '$displayTitle$ideTag\n📁 $subtitleText',
      waitDuration: const Duration(milliseconds: 600),
      child: Semantics(
        button: true,
        selected: isSelected,
        label: '$displayTitle$ideTag, $pinText$runningText$timeText, projet $subtitleText',
        child: MouseRegion(
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: GestureDetector(
            onTap: () {
              HapticFeedback.selectionClick();
              widget.onTap();
            },
            onLongPress: () => _showSessionContextMenu(context),
            onSecondaryTap: () => _showSessionContextMenu(context),
            child: AnimatedContainer(
              duration: AppMotion.fast,
              curve: AppMotion.easeOut,
              margin: const EdgeInsets.only(left: 14, right: 6, top: 1, bottom: 1),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6.5),
              decoration: BoxDecoration(
                color: isSelected
                    ? (isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest)
                    : (_hovered
                        ? (isDark ? AppColors.surfacePressed : scheme.surfaceContainerHigh.withValues(alpha: 0.5))
                        : Colors.transparent),
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (widget.session.isIde) ...[
                            Container(
                              margin: const EdgeInsets.only(right: 5.5),
                              padding: const EdgeInsets.symmetric(horizontal: 4.5, vertical: 0.8),
                              decoration: BoxDecoration(
                                color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                                borderRadius: BorderRadius.circular(3.5),
                                border: Border.all(
                                  color: isDark ? AppColors.accentBlue.withValues(alpha: 0.5) : scheme.primary.withValues(alpha: 0.4),
                                  width: 0.6,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'IDE',
                                    style: TextStyle(
                                      fontSize: 8.5,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.4,
                                      color: isDark ? AppColors.accentBlue : scheme.primary,
                                    ),
                                  ),
                                  const SizedBox(width: 3),
                                  Container(
                                    width: 4,
                                    height: 4,
                                    decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: AppColors.accentBlue,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          if (widget.isDesktopFocused) ...[
                            Container(
                              margin: const EdgeInsets.only(right: 5.5),
                              padding: const EdgeInsets.symmetric(horizontal: 4.5, vertical: 0.8),
                              decoration: BoxDecoration(
                                color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                                borderRadius: BorderRadius.circular(3.5),
                                border: Border.all(
                                  color: AppColors.online.withValues(alpha: 0.7),
                                  width: 0.6,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.desktop_windows_rounded, size: 8.5, color: AppColors.online),
                                  const SizedBox(width: 2.5),
                                  Text(
                                    'PC ACTIF',
                                    style: TextStyle(
                                      fontSize: 8,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.3,
                                      color: AppColors.online,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          Flexible(
                            child: Text(
                              displayTitle,
                              style: TextStyle(
                                fontSize: 12.5,
                                color: isSelected
                                    ? (isDark ? AppColors.inkPrimary : scheme.onSurface)
                                    : (isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant),
                                fontWeight: widget.session.isIde
                                    ? (isSelected ? FontWeight.w700 : FontWeight.w600)
                                    : (isSelected ? FontWeight.w500 : FontWeight.w400),
                              ),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                            ),
                          ),
                        ],
                      ),
                      if (widget.showSubtitle && subtitleText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 1.5),
                          child: Row(
                            children: [
                              Icon(
                                widget.session.isIde
                                    ? Icons.code_rounded
                                    : ((widget.session.worktree != null && widget.session.worktree!.isNotEmpty)
                                        ? Icons.account_tree_outlined
                                        : Icons.folder_outlined),
                                size: 10.5,
                                color: isSelected
                                    ? (isDark ? AppColors.inkSecondary : scheme.primary)
                                    : (isDark ? AppColors.inkMuted : scheme.outline),
                              ),
                              const SizedBox(width: 3.5),
                              Expanded(
                                child: Text(
                                  subtitleText,
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    color: isSelected
                                        ? (isDark ? AppColors.inkSecondary : scheme.primary)
                                        : (isDark ? AppColors.inkMuted : scheme.outline),
                                    fontWeight: FontWeight.w400,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                  maxLines: 1,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeOutCubic,
                  child: (isSelected || _hovered)
                      ? Row(
                          key: const ValueKey('selected_actions'),
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (isRunning) ...[
                              Tooltip(
                                key: const ValueKey('running'),
                                message: 'En cours d\'exécution',
                                child: AntigravitySpinningArc(
                                  size: 13,
                                  color: isSelected
                                      ? (isDark ? AppColors.inkPrimary : scheme.primary)
                                      : (isDark ? AppColors.inkMuted : scheme.outline),
                                ),
                              ),
                              const SizedBox(width: 4),
                            ] else if (isWaiting) ...[
                              const ThreeDotsWaiting(),
                              const SizedBox(width: 4),
                            ],
                            if (widget.onTogglePin != null)
                              Tooltip(
                                message: widget.isPinned ? 'Désépingler' : 'Épingler',
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(4),
                                  onTap: () {
                                    HapticFeedback.selectionClick();
                                    widget.onTogglePin?.call();
                                  },
                                  child: Padding(
                                    padding: const EdgeInsets.all(3),
                                    child: Icon(
                                      widget.isPinned ? Icons.push_pin_rounded : Icons.push_pin_outlined,
                                      size: 14,
                                      color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ),
                            Focus(
                              child: Tooltip(
                                key: const ValueKey('session_menu_btn'),
                                message: 'Options de la conversation (Clavier: Entrée)',
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(4),
                                  onTap: () {
                                    HapticFeedback.selectionClick();
                                    _showSessionContextMenu(context);
                                  },
                                  child: Padding(
                                    padding: const EdgeInsets.all(3),
                                    child: Icon(
                                      Icons.more_horiz_rounded,
                                      size: 15,
                                      color: isSelected
                                          ? (isDark ? AppColors.inkPrimary : scheme.onSurface)
                                          : (isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        )
                      : isRunning
                          ? Tooltip(
                              key: const ValueKey('running'),
                              message: 'En cours d\'exécution',
                              child: AntigravitySpinningArc(
                                size: 13.5,
                                color: isDark ? AppColors.inkMuted : scheme.outline,
                              ),
                            )
                          : isWaiting
                              ? Tooltip(
                                  key: const ValueKey('waiting'),
                                  message: widget.session.isBackgroundTask
                                      ? 'Tâche d\'arrière-plan en cours (en attente)'
                                      : 'En attente…',
                                  child: const ThreeDotsWaiting(),
                                )
                              : widget.session.isError
                                  ? Tooltip(
                                      key: const ValueKey('error'),
                                      message: 'Erreur',
                                      child: Container(
                                        width: 6,
                                        height: 6,
                                        decoration: const BoxDecoration(
                                          color: AppColors.danger,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                    )
                                  : isUnread
                                      ? Row(
                                          key: const ValueKey('unread_indicator'),
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(
                                              Icons.notifications_none_rounded,
                                              size: 13.5,
                                              color: isDark ? AppColors.inkMuted : scheme.outline,
                                            ),
                                            const SizedBox(width: 3),
                                            const Tooltip(
                                              key: ValueKey('unread_blue_dot'),
                                              message: 'Session terminée — non lue',
                                              child: _PulsingBlueDot(),
                                            ),
                                          ],
                                        )
                                        : widget.session.time.isNotEmpty
                                            ? Text(
                                                widget.session.time,
                                                key: ValueKey('time_${widget.session.time}'),
                                                style: TextStyle(
                                                  fontSize: 11.5,
                                                  color: isSelected
                                                      ? (isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant)
                                                      : (isDark ? AppColors.inkMuted : scheme.outline),
                                                  fontWeight: FontWeight.w400,
                                                ),
                                              )
                                            : const SizedBox.shrink(key: ValueKey('empty')),
              ),
              if (widget.isPinned && !widget.isPinnedSection)
                Padding(
                  padding: const EdgeInsets.only(left: 4),
                  child: Icon(
                    Icons.push_pin_rounded,
                    size: 11,
                    color: isSelected
                        ? (isDark ? AppColors.accentBlue : scheme.primary)
                        : (isDark ? AppColors.inkMuted : scheme.outlineVariant),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  ),
);

    // Swipe gesture : glisser vers la droite (startToEnd) = Archiver,
    // glisser vers la gauche (endToStart) = Supprimer.
    if (widget.onArchive != null || widget.onDelete != null || widget.onTogglePin != null) {
      return Dismissible(
        key: ValueKey('dismiss-${widget.session.id}'),
        direction: DismissDirection.horizontal,
        confirmDismiss: (dir) async {
          HapticFeedback.mediumImpact();
          if (dir == DismissDirection.startToEnd) {
            // Swipe droite : Archiver
            if (widget.onArchive != null) {
              widget.onArchive?.call();
            } else if (widget.onTogglePin != null) {
              widget.onTogglePin?.call();
            }
          } else if (dir == DismissDirection.endToStart) {
            // Swipe gauche : Supprimer
            if (widget.onDelete != null) {
              _confirmDelete(context);
            } else if (widget.onArchive != null) {
              widget.onArchive?.call();
            }
          }
          return false;
        },
        background: widget.onArchive != null || widget.onTogglePin != null
            ? Container(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.only(left: 16),
                margin: const EdgeInsets.only(left: 14, right: 6, top: 1, bottom: 1),
                decoration: BoxDecoration(
                  color: widget.onArchive != null
                      ? AppColors.accentBlue.withValues(alpha: 0.85)
                      : AppColors.accentBlueDeep.withValues(alpha: 0.85),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(widget.onArchive != null ? Icons.archive_outlined : Icons.push_pin_outlined, color: Colors.white, size: 18),
                    const SizedBox(width: 6),
                    Text(widget.onArchive != null ? 'Archiver' : 'Épingler', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              )
            : null,
        secondaryBackground: widget.onDelete != null
            ? Container(
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.only(right: 16),
                margin: const EdgeInsets.only(left: 14, right: 6, top: 1, bottom: 1),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: 0.85),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.delete_outline_rounded, color: Colors.white, size: 18),
                    SizedBox(width: 6),
                    Text('Supprimer', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              )
            : null,
        child: item,
      );
    }
    return item;
  }
}

// ── Empty State Widget
class _EmptyState extends StatelessWidget {
  final bool isConnected;
  final VoidCallback onConnect;

  const _EmptyState({required this.isConnected, required this.onConnect});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
        margin: const EdgeInsets.all(10),
        padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 16),
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, width: 1),
        ),
        child: Column(
          children: [
            Icon(
              isConnected
                  ? Icons.chat_bubble_outline
                  : Icons.cloud_off_outlined,
              size: 26,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(height: 10),
            Text(
              isConnected ? 'No active sessions' : 'Disconnected',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              isConnected
                  ? 'Start a new conversation in a project.'
                  : 'Connect to Daemon to view workspace sessions.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11.5,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            if (!isConnected) ...[
              const SizedBox(height: 14),
              GestureDetector(
                onTap: onConnect,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.qr_code_scanner, size: 13, color: AppColors.onAccent),
                      SizedBox(width: 7),
                      Text(
                        'Connect',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: AppColors.onAccent,
                        ),
                      ),
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

// ── Divider
class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      height: 1,
      color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
    );
  }
}

// ── Connection status row (bottom)
class _ConnectionRow extends StatefulWidget {
  final bool isConnected;
  final VoidCallback onTap;

  const _ConnectionRow({required this.isConnected, required this.onTap});

  @override
  State<_ConnectionRow> createState() => _ConnectionRowState();
}

class _ConnectionRowState extends State<_ConnectionRow> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final color = widget.isConnected ? AppColors.positive : scheme.onSurfaceVariant;
    final label = widget.isConnected ? 'Connected' : 'Offline';

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: AppMotion.fast,
          curve: AppMotion.easeOut,
          margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: _hovered ? (isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest) : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Row(
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: widget.isConnected
                      ? AppColors.positive
                      : (isDark ? AppColors.inkFaint : scheme.onSurfaceVariant),
                  shape: BoxShape.circle,
                  boxShadow: widget.isConnected
                      ? [
                          BoxShadow(
                            color: AppColors.positive.withValues(alpha: 0.5),
                            blurRadius: 4,
                            spreadRadius: 1,
                          )
                        ]
                      : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                    color: color,
                  ),
                ),
              ),
              Icon(
                widget.isConnected ? Icons.power_settings_new_rounded : Icons.link_rounded,
                size: 15,
                color: isDark ? AppColors.inkFaint : scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Animated "session terminée — non lue" indicator: a soft pulsing blue dot
/// that gently fades its glow in/out so a finished-but-unread session stands
/// out from static state dots (running spinner, waiting orange, error red).
class _PulsingBlueDot extends StatefulWidget {
  const _PulsingBlueDot();

  @override
  State<_PulsingBlueDot> createState() => _PulsingBlueDotState();
}

class _PulsingBlueDotState extends State<_PulsingBlueDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  late final Animation<double> _glow = Tween<double>(begin: 0.35, end: 1.0)
      .animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _glow,
      child: Container(
        width: 7,
        height: 7,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        decoration: BoxDecoration(
          color: AppColors.accentBlue,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: AppColors.accentBlue.withValues(alpha: 0.6),
              blurRadius: 4,
              spreadRadius: 0.5,
            ),
          ],
        ),
      ),
    );
  }
}

