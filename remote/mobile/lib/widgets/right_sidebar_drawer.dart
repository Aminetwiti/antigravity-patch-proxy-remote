import 'package:flutter/material.dart';

import '../core/protocol/daemon_api.dart';
import '../features/scheduled_tasks/scheduled_tasks_screen.dart';
import '../features/subagents/subagents_tree_sheet.dart';
import '../features/mcp/mcp_explorer_screen.dart';
import 'artifact_viewer_modal.dart';
import '../theme/app_colors.dart';

class RightSidebarDrawer extends StatefulWidget {
  final DaemonApi? api;
  final String activeSessionId;
  /// Workspace racine de la session active — requis par le daemon pour
  /// git_state (sinon "workspacePath requis"). Peut être relatif au home.
  final String workspacePath;
  final int subagentsCount;
  final int filesChangedCount;
  final int artifactsCount;
  final int uploadsCount;
  final int backgroundTasksCount;
  final int scheduledTasksCount;
  final int mcpServersCount;

  const RightSidebarDrawer({
    super.key,
    this.api,
    this.activeSessionId = '',
    this.workspacePath = '',
    this.subagentsCount = 0,
    this.filesChangedCount = 0,
    this.artifactsCount = 0,
    this.uploadsCount = 0,
    this.backgroundTasksCount = 0,
    this.scheduledTasksCount = 0,
    this.mcpServersCount = 0,
  });

  @override
  State<RightSidebarDrawer> createState() => _RightSidebarDrawerState();
}

class _RightSidebarDrawerState extends State<RightSidebarDrawer> {
  bool _isLoadingArtifacts = false;
  List<Map<String, dynamic>> _artifacts = [];
  bool _artifactsExpanded = false;

  bool _isLoadingFilesChanged = false;
  List<String> _filesChanged = [];
  bool _filesChangedExpanded = false;

  bool _isLoadingUploads = false;
  List<Map<String, dynamic>> _uploads = [];
  bool _uploadsExpanded = false;

  bool _isLoadingWorktrees = false;
  List<Map<String, dynamic>> _worktrees = [];
  bool _worktreesExpanded = false;
  int _mcpCount = 0;

  @override
  void initState() {
    super.initState();
    _fetchInitialCounts();
  }

  Future<void> _fetchInitialCounts() async {
    if (widget.api == null) return;
    try {
      final mcp = await widget.api!.getMcpServers();
      final wt = await widget.api!.listGitWorktrees(
        workspacePath: widget.workspacePath.isNotEmpty ? widget.workspacePath : null,
      );
      if (mounted) {
        setState(() {
          _mcpCount = mcp.length;
          _worktrees = wt;
        });
      }
    } catch (_) {}
  }

  @override
  void didUpdateWidget(covariant RightSidebarDrawer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeSessionId != widget.activeSessionId) {
      setState(() {
        _artifacts.clear();
        _uploads.clear();
        _filesChanged.clear();
        _worktrees.clear();
        _artifactsExpanded = false;
        _uploadsExpanded = false;
        _filesChangedExpanded = false;
        _worktreesExpanded = false;
      });
      _fetchInitialCounts();
    }
  }

  Future<void> _fetchWorktrees() async {
    if (widget.api == null) return;
    setState(() => _isLoadingWorktrees = true);
    try {
      final list = await widget.api!.listGitWorktrees(
        workspacePath: widget.workspacePath.isNotEmpty ? widget.workspacePath : null,
      );
      if (!mounted) return;
      setState(() {
        _worktrees = list;
        _isLoadingWorktrees = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoadingWorktrees = false);
    }
  }

  Future<void> _createNewWorktreeDialog() async {
    final branchCtrl = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        scrollable: true,
        title: const Text('Nouveau Git Worktree', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Crée une copie isolée du dépôt pour exécuter des tâches ou des agents en parallèle sans conflits.',
                style: TextStyle(fontSize: 12),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: branchCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nom de la branche / worktree',
                  hintText: 'feat-refactor-auth',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Annuler')),
          FilledButton(
            onPressed: () {
              if (branchCtrl.text.trim().isNotEmpty) {
                Navigator.of(ctx).pop(true);
              }
            },
            child: const Text('Créer'),
          ),
        ],
      ),
    );

    if (created == true && branchCtrl.text.trim().isNotEmpty && widget.api != null) {
      await widget.api!.createWorktree(branchCtrl.text.trim());
      _fetchWorktrees();
    }
  }

  Future<void> _fetchFilesChanged() async {
    if (widget.api == null) return;
    setState(() => _isLoadingFilesChanged = true);
    try {
      // Uniquement les fichiers modifiés par l'agent dans la session active
      final ctx = await widget.api!.getContext(
        cascadeId: widget.activeSessionId.isNotEmpty ? widget.activeSessionId : null,
        workspacePath: widget.workspacePath.isEmpty ? null : widget.workspacePath,
      );
      final ctxFiles = ctx['modifiedFiles'];
      final files = <String>{};
      if (ctxFiles is List && ctxFiles.isNotEmpty) {
        for (final item in ctxFiles) {
          if (item is String && item.isNotEmpty) files.add(_relPath(item));
        }
      }
      if (mounted) setState(() => _filesChanged = files.toList());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoadingFilesChanged = false);
    }
  }

  /// Réduit un URI file:///... à son chemin relatif pour l'affichage.
  /// Ponytail: pas de dépendance — parsing manuel minimal.
  static String _relPath(String uri) {
    var p = uri.replaceAll('\\', '/');
    if (p.startsWith('file:///')) {
      p = p.substring(8);
    } else if (p.startsWith('file://')) {
      p = p.substring(7);
    }
    return p;
  }

  Future<void> _fetchArtifacts() async {
    if (widget.api == null || widget.activeSessionId.isEmpty) return;
    setState(() => _isLoadingArtifacts = true);
    try {
      // 1. Try dedicated daemon listArtifacts RPC
      try {
        final res = await widget.api!.listArtifacts(widget.activeSessionId);
        final list = res['artifacts'] as List<dynamic>? ?? [];
        if (list.isNotEmpty) {
          final arts = <Map<String, dynamic>>[];
          for (final a in list) {
            if (a is Map && a['name'] != null) {
              arts.add({
                'name': a['name'].toString(),
                'path': a['path']?.toString() ?? a['name'].toString(),
              });
            }
          }
          if (mounted && arts.isNotEmpty) {
            setState(() => _artifacts = arts);
            return;
          }
        }
      } catch (_) {}

      // 2. Fallback: check both antigravity and antigravity-ide brain directories
      final brainBases = [
        '.gemini/antigravity/brain/${widget.activeSessionId}/',
        '.gemini/antigravity-ide/brain/${widget.activeSessionId}/',
      ];
      final arts = <Map<String, dynamic>>[];
      for (final path in brainBases) {
        try {
          final res = await widget.api!.listFiles(path);
          final files = res['files'] as List<dynamic>? ?? [];
          for (final f in files) {
            if (f is Map && f['name'] != null && f['name'].toString().endsWith('.md')) {
              arts.add({'name': f['name'], 'path': f['path'] ?? '$path${f['name']}'});
            }
          }
          if (arts.isNotEmpty) break;
        } catch (_) {}
      }
      if (mounted) setState(() => _artifacts = arts);
    } catch (e) {
      debugPrint('Failed to fetch artifacts: $e');
    } finally {
      if (mounted) setState(() => _isLoadingArtifacts = false);
    }
  }

  Future<void> _fetchUploads() async {
    if (widget.api == null || widget.activeSessionId.isEmpty) return;
    setState(() => _isLoadingUploads = true);
    try {
      // 1. Try dedicated daemon listUploads RPC
      try {
        final res = await widget.api!.listUploads(widget.activeSessionId);
        final list = res['uploads'] as List<dynamic>? ?? [];
        if (list.isNotEmpty) {
          final ups = <Map<String, dynamic>>[];
          final seen = <String>{};
          for (final u in list) {
            if (u is Map && u['name'] != null) {
              final name = u['name'].toString();
              if (seen.add(name)) {
                ups.add({
                  'name': name,
                  'path': u['path']?.toString() ?? name,
                });
              }
            }
          }
          if (mounted && ups.isNotEmpty) {
            setState(() => _uploads = ups);
            return;
          }
        }
      } catch (_) {}

      // 2. Fallback via listFiles with deduplication
      final brainBases = [
        '.gemini/antigravity/brain/${widget.activeSessionId}',
        '.gemini/antigravity-ide/brain/${widget.activeSessionId}',
      ];
      final ups = <Map<String, dynamic>>[];
      final seen = <String>{};

      for (final base in brainBases) {
        final pathsToTry = ['$base/scratch/', '$base/.user_uploaded/'];
        for (final p in pathsToTry) {
          try {
            final res = await widget.api!.listFiles(p);
            final files = res['files'] as List<dynamic>? ?? [];
            for (final f in files) {
              if (f is Map && f['name'] != null) {
                final name = f['name'].toString();
                final lower = name.toLowerCase();
                if (lower.endsWith('.png') ||
                    lower.endsWith('.jpg') ||
                    lower.endsWith('.jpeg') ||
                    lower.endsWith('.gif') ||
                    lower.endsWith('.webp') ||
                    lower.endsWith('.pdf') ||
                    lower.endsWith('.mp4')) {
                  if (seen.add(name)) {
                    ups.add({
                      'name': name,
                      'path': '$p$name',
                    });
                  }
                }
              }
            }
          } catch (_) {}
        }
        if (ups.isNotEmpty) break;
      }
      if (mounted) setState(() => _uploads = ups);
    } catch (e) {
      debugPrint('Failed to fetch uploads: $e');
    } finally {
      if (mounted) setState(() => _isLoadingUploads = false);
    }
  }

  void _openArtifact(Map<String, dynamic> artifact) {
    if (widget.api == null) return;
    ArtifactViewerModal.show(
      context,
      api: widget.api!,
      artifactPath: artifact['path'] ?? artifact['name'] ?? '',
      artifactName: artifact['name'] ?? 'Document',
      cascadeId: widget.activeSessionId,
      workspacePath: widget.workspacePath,
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Drawer(
      backgroundColor: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
        side: BorderSide(color: scheme.outlineVariant, width: 1),
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drawer Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Icon(Icons.vertical_split_outlined, size: 16, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Text(
                    'CONTEXTE',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: Icon(Icons.close, size: 18, color: scheme.onSurfaceVariant),
                    onPressed: () => Navigator.of(context).pop(),
                    tooltip: 'Fermer le panneau',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(
                      minWidth: 32,
                      minHeight: 32,
                    ),
                  ),
                ],
              ),
            ),
            const Divider(),

            // Context Accordion List
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  _ContextItemRow(
                    title: 'Subagents',
                    badgeCount: widget.subagentsCount,
                    isExpandable: false,
                    onTap: () {
                      SubagentsTreeSheet.show(
                        context,
                        api: widget.api,
                        cascadeId: widget.activeSessionId,
                      );
                    },
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ContextItemRow(
                        title: 'Files Changed',
                        badgeCount: _filesChangedExpanded ? _filesChanged.length : widget.filesChangedCount,
                        onTap: () {
                          setState(() {
                            _filesChangedExpanded = !_filesChangedExpanded;
                          });
                          if (_filesChangedExpanded && _filesChanged.isEmpty) {
                            _fetchFilesChanged();
                          }
                        },
                        isExpanded: _filesChangedExpanded,
                      ),
                      if (_filesChangedExpanded)
                        AnimatedContainer(
                          duration: AppMotion.fast,
                          padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
                          child: _isLoadingFilesChanged
                              ? Padding(
                                  padding: const EdgeInsets.all(8.0),
                                  child: Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(scheme.primary)))),
                                )
                              : _filesChanged.isEmpty
                                  ? Padding(
                                      padding: const EdgeInsets.all(8.0),
                                      child: Text('Aucun fichier modifié', style: TextStyle(color: scheme.outline, fontSize: 12)),
                                    )
                                  : Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: _filesChanged.map((file) => Padding(
                                        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                                        child: Row(
                                          children: [
                                            Icon(Icons.insert_drive_file_outlined, size: 14, color: scheme.primary),
                                            const SizedBox(width: 8),
                                            Expanded(
                                              child: Text(
                                                file,
                                                style: TextStyle(fontSize: 12, color: scheme.onSurface),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          ],
                                        ),
                                      )).toList(),
                                    ),
                        ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ContextItemRow(
                        title: 'Artifacts',
                        badgeCount: _artifactsExpanded ? _artifacts.length : widget.artifactsCount,
                        onTap: () {
                          setState(() {
                            _artifactsExpanded = !_artifactsExpanded;
                          });
                          if (_artifactsExpanded && _artifacts.isEmpty) {
                            _fetchArtifacts();
                          }
                        },
                        isExpanded: _artifactsExpanded,
                      ),
                      if (_artifactsExpanded)
                        AnimatedContainer(
                          duration: AppMotion.fast,
                          padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
                          child: _isLoadingArtifacts
                              ? Padding(
                                  padding: const EdgeInsets.all(8.0),
                                  child: Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(scheme.primary)))),
                                )
                              : _artifacts.isEmpty
                                  ? Padding(
                                      padding: const EdgeInsets.all(8.0),
                                      child: Text('Aucun artefact', style: TextStyle(color: scheme.outline, fontSize: 12)),
                                    )
                                  : Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: _artifacts.map((art) => InkWell(
                                        onTap: () => _openArtifact(art),
                                        borderRadius: BorderRadius.circular(AppRadius.sm),
                                        child: Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                                          child: Row(
                                            children: [
                                              Icon(Icons.article_outlined, size: 14, color: scheme.primary),
                                              const SizedBox(width: 8),
                                              Expanded(
                                                child: Text(
                                                  art['name'] ?? 'Document',
                                                  style: TextStyle(fontSize: 12, color: scheme.onSurface),
                                                  overflow: TextOverflow.ellipsis,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      )).toList(),
                                    ),
                        ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ContextItemRow(
                        title: 'Uploads',
                        badgeCount: _uploadsExpanded ? _uploads.length : widget.uploadsCount,
                        onTap: () {
                          setState(() {
                            _uploadsExpanded = !_uploadsExpanded;
                          });
                          if (_uploadsExpanded && _uploads.isEmpty) {
                            _fetchUploads();
                          }
                        },
                        isExpanded: _uploadsExpanded,
                      ),
                      if (_uploadsExpanded)
                        AnimatedContainer(
                          duration: AppMotion.fast,
                          padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
                          child: _isLoadingUploads
                              ? Padding(
                                  padding: const EdgeInsets.all(8.0),
                                  child: Center(
                                    child: SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        valueColor: AlwaysStoppedAnimation(scheme.primary),
                                      ),
                                    ),
                                  ),
                                )
                              : _uploads.isEmpty
                                  ? Padding(
                                      padding: const EdgeInsets.all(8.0),
                                      child: Text(
                                        'Aucun fichier téléversé',
                                        style: TextStyle(color: scheme.outline, fontSize: 12),
                                      ),
                                    )
                                  : Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: _uploads.map((up) => InkWell(
                                        onTap: () => _openArtifact(up),
                                        borderRadius: BorderRadius.circular(AppRadius.sm),
                                        child: Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                                          child: Row(
                                            children: [
                                              Icon(
                                                up['name']?.toString().endsWith('.pdf') == true
                                                    ? Icons.picture_as_pdf_outlined
                                                    : Icons.image_outlined,
                                                size: 14,
                                                color: scheme.secondary,
                                              ),
                                              const SizedBox(width: 8),
                                              Expanded(
                                                child: Text(
                                                  up['name'] ?? 'Fichier',
                                                  style: TextStyle(fontSize: 12, color: scheme.onSurface),
                                                  overflow: TextOverflow.ellipsis,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      )).toList(),
                                    ),
                        ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ContextItemRow(
                        title: 'Git Worktrees',
                        badgeCount: _worktrees.length,
                        onTap: () {
                          setState(() {
                            _worktreesExpanded = !_worktreesExpanded;
                          });
                          if (_worktreesExpanded && _worktrees.isEmpty) {
                            _fetchWorktrees();
                          }
                        },
                        isExpanded: _worktreesExpanded,
                      ),
                      if (_worktreesExpanded)
                        AnimatedContainer(
                          duration: AppMotion.fast,
                          padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
                          child: _isLoadingWorktrees
                              ? Padding(
                                  padding: const EdgeInsets.all(8.0),
                                  child: Center(
                                    child: SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        valueColor: AlwaysStoppedAnimation(scheme.primary),
                                      ),
                                    ),
                                  ),
                                )
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    if (_worktrees.isEmpty)
                                      Padding(
                                        padding: const EdgeInsets.all(8.0),
                                        child: Text(
                                          'Aucun worktree actif',
                                          style: TextStyle(color: scheme.outline, fontSize: 12),
                                        ),
                                      )
                                    else
                                      ..._worktrees.map((wt) {
                                        final branch = wt['branch'] ?? wt['head'] ?? 'main';
                                        final path = wt['path'] ?? wt['worktreeDirUri'] ?? '';
                                        final isCurrent = wt['isCurrent'] == true ||
                                            (widget.workspacePath.isNotEmpty && path.toString().contains(widget.workspacePath));

                                        return InkWell(
                                          onTap: () async {
                                            if (path.toString().isNotEmpty && widget.api != null) {
                                              await widget.api!.checkoutGitWorktree(path.toString());
                                              _fetchWorktrees();
                                            }
                                          },
                                          borderRadius: BorderRadius.circular(AppRadius.sm),
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                                            child: Row(
                                              children: [
                                                Icon(
                                                  isCurrent ? Icons.check_circle : Icons.alt_route,
                                                  size: 14,
                                                  color: isCurrent ? scheme.primary : scheme.onSurfaceVariant,
                                                ),
                                                const SizedBox(width: 8),
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      Text(
                                                        branch.toString(),
                                                        style: TextStyle(
                                                          fontSize: 12,
                                                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                                                          color: scheme.onSurface,
                                                        ),
                                                        overflow: TextOverflow.ellipsis,
                                                      ),
                                                      if (path.toString().isNotEmpty)
                                                        Text(
                                                          path.toString().split('/').last.split('\\').last,
                                                          style: TextStyle(fontSize: 10, color: scheme.outline),
                                                          overflow: TextOverflow.ellipsis,
                                                        ),
                                                    ],
                                                  ),
                                                ),
                                                if (isCurrent)
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                                    decoration: BoxDecoration(
                                                      color: scheme.primary.withValues(alpha: 0.12),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      'Actif',
                                                      style: TextStyle(fontSize: 10, color: scheme.primary, fontWeight: FontWeight.w600),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        );
                                      }),
                                    const SizedBox(height: 6),
                                    OutlinedButton.icon(
                                      onPressed: _createNewWorktreeDialog,
                                      icon: const Icon(Icons.add, size: 14),
                                      label: const Text('Nouveau Worktree', style: TextStyle(fontSize: 11)),
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        minimumSize: const Size(0, 30),
                                      ),
                                    ),
                                  ],
                                ),
                        ),
                    ],
                  ),
                  _ContextItemRow(
                    title: 'Scheduled Tasks',
                    badgeCount: widget.scheduledTasksCount,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (ctx) => ScheduledTasksScreen(
                            tasks: const [],
                            api: widget.api,
                            onCancelTask: (id) => widget.api?.cancelScheduledTask(id),
                            onTriggerNow: (id) => widget.api?.triggerScheduledTask(id),
                            onToggleTask: (id, enabled) => widget.api?.toggleScheduledTask(id, enabled),
                            onAddTask: (task) => widget.api?.scheduleTask(task),
                          ),
                        ),
                      );
                    },
                  ),
                  _ContextItemRow(
                    title: 'MCP Servers',
                    badgeCount: widget.mcpServersCount > 0 ? widget.mcpServersCount : _mcpCount,
                    isExpandable: false,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (ctx) => McpExplorerScreen(api: widget.api),
                        ),
                      ).then((_) => _fetchInitialCounts());
                    },
                  ),
                  _ContextItemRow(
                    title: 'Background Tasks',
                    badgeCount: widget.backgroundTasksCount,
                    isExpandable: false,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (ctx) => ScheduledTasksScreen(
                            tasks: const [],
                            api: widget.api,
                            onCancelTask: (id) => widget.api?.cancelScheduledTask(id),
                            onTriggerNow: (id) => widget.api?.triggerScheduledTask(id),
                            onToggleTask: (id, enabled) => widget.api?.toggleScheduledTask(id, enabled),
                            onAddTask: (task) => widget.api?.scheduleTask(task),
                          ),
                        ),
                      );
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

class _ContextItemRow extends StatelessWidget {
  final String title;
  final int badgeCount;
  final VoidCallback onTap;
  final bool isExpanded;
  final bool isExpandable;

  const _ContextItemRow({
    required this.title,
    required this.badgeCount,
    required this.onTap,
    this.isExpanded = false,
    this.isExpandable = true,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: AnimatedContainer(
          duration: AppMotion.fast,
          curve: AppMotion.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: (isExpandable && isExpanded) ? scheme.surfaceContainerHighest : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  border: Border.all(color: scheme.outlineVariant, width: 0.5),
                ),
                child: Text(
                  '$badgeCount',
                  style: TextStyle(
                    fontSize: 11,
                    color: badgeCount > 0 ? scheme.primary : scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              if (isExpandable)
                AnimatedRotation(
                  turns: isExpanded ? 0.25 : 0,
                  duration: AppMotion.fast,
                  child: Icon(
                    Icons.chevron_right,
                    size: 16,
                    color: scheme.onSurfaceVariant,
                  ),
                )
              else
                Icon(
                  Icons.chevron_right,
                  size: 16,
                  color: scheme.onSurfaceVariant,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
