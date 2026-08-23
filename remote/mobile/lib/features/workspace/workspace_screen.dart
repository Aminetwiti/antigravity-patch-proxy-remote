import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/protocol/daemon_api.dart';
import '../../core/protocol/messages.dart';
import '../../core/protocol/workspace_path.dart';
import '../../widgets/custom_dropdown_overlay.dart';
import '../../widgets/markdown_bubble.dart';
import '../../widgets/syntax_highlighter.dart';
import 'git_commit_dialog.dart';
import 'package:mobile/theme/app_colors.dart';

class WorkspaceScreen extends StatefulWidget {
  final DaemonApi? api;
  final String workspacePath;
  final List<ProjectItem> projects;
  final ValueChanged<String>? onSelectWorkspace;

  const WorkspaceScreen({
    super.key,
    this.api,
    this.workspacePath = '.',
    this.projects = const [],
    this.onSelectWorkspace,
  });

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  String _selectedFilePath = '';
  bool _isLoadingTree = true;
  bool _isLoadingCode = false;
  String? _loadError;
  List<Map<String, dynamic>> _files = [];
  String _codeContent = '// Sélectionnez un fichier';
  Uint8List? _imageBytes;
  bool _isMarkdownPreview = false;
  int? _targetLineNumber;
  final Set<String> _collapsedFolders = {};
  // Bug #5 : recherche substring dans l'arbre
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  // Find-in-page (Cmd+F) dans le viewer de code
  final TextEditingController _findController = TextEditingController();
  String _findQuery = '';
  bool _showFindBar = false;
  final GlobalKey _workspaceButtonKey = GlobalKey();
  // Workspace résolu en chemin absolu pour le daemon (resolvePath).
  String _workspaceResolved = '.';
  // Grep workspace (P5) : recherche contenu+noms côté daemon.
  final TextEditingController _grepController = TextEditingController();
  final FocusNode _grepFocusNode = FocusNode();
  bool _showGrep = false;
  bool _isGrepLoading = false;
  List<Map<String, dynamic>> _grepResults = [];
  // Filtre d'extension rapide (Axe 2)
  String? _selectedExtensionFilter;
  // Branches Git du workspace (Axe 2)
  List<String> _gitBranches = [];
  String? _currentGitBranch;
  // État Git & conflits (P3)
  bool _inConflict = false;
  List<String> _conflicts = [];
  Map<String, String> _fileGitStatuses = {};

  /// Normalise le workspace en chemin absolu exploitable par le daemon.
  static String resolveWorkspace(String raw) {
    final w = raw.trim();
    if (w.startsWith('file:///')) return w.substring(8);
    if (w.startsWith('file://')) return w.substring(7);
    return w;
  }

  /// Extrait le nom court du dossier d'un chemin de workspace.
  static String _extractWorkspaceName(String raw) =>
      WorkspacePath.displayName(raw, fallback: 'Workspace');

  @override
  void initState() {
    super.initState();
    // Le daemon confine list_files/read_file sous une racine ABSOLUE (resolvePath
    // fait filepath.Abs). On envoie donc le workspace en chemin absolu dès le
    // départ : '.', 'workspace/', 'file:///...' → path réel côté PC.
    _workspaceResolved = resolveWorkspace(widget.workspacePath);
    _loadFiles();
    _loadGitBranches();
    _loadGitState();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase());
    });
    _findController.addListener(() {
      setState(() => _findQuery = _findController.text);
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _findController.dispose();
    _grepController.dispose();
    super.dispose();
  }

  // Basename réel du workspace (nom du dossier, pas le path complet).
  String get _workspaceLabel => WorkspacePath.displayName(widget.workspacePath, fallback: 'Workspace');

  Future<void> _loadFiles() async {
    if (widget.api == null) {
      if (mounted) {
        setState(() {
          _isLoadingTree = false;
          _loadError = null;
        });
      }
      return;
    }
    try {
      final res = await widget.api!.listFiles(_workspaceResolved);
      if (mounted) {
        setState(() {
          final rawFiles = res['files'] ?? (res['data'] is Map ? res['data']['files'] : null);
          _files = (rawFiles is List)
              ? rawFiles.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
              : <Map<String, dynamic>>[];
          _isLoadingTree = false;
          _loadError = null;
        });
      }
    } catch (e) {
      // Bug #6 : afficher l'erreur explicitement au lieu de silencer.
      if (mounted) {
        setState(() {
          _isLoadingTree = false;
          _loadError = e.toString();
        });
      }
    }
  }

  /// Charge les branches Git du workspace (Axe 2). La branche courante est
  /// déduite de la présence d'un '*' en tête (git branch -a).
  Future<void> _loadGitBranches() async {
    if (widget.api == null) return;
    try {
      final branches = await widget.api!.listGitBranches(
        workspacePath: _workspaceResolved,
      );
      String? current;
      for (final b in branches) {
        if (b.startsWith('*')) {
          current = b.substring(1).trim();
          break;
        }
      }
      if (mounted) {
        setState(() {
          _gitBranches = branches
              .map((b) => b.replaceFirst(RegExp(r'^\*\s*'), '').trim())
              .where((b) => b.isNotEmpty)
              .toList();
          _currentGitBranch = current ?? (_gitBranches.isNotEmpty ? _gitBranches.first : null);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _gitBranches = [];
          _currentGitBranch = null;
        });
      }
    }
  }

  /// Charge l'état VCS / Git complet (conflits, modifications indexées).
  Future<void> _loadGitState() async {
    if (widget.api == null) return;
    try {
      final state = await widget.api!.getGitState(
        workspacePath: _workspaceResolved,
      );
      if (mounted) {
        // VCS wire: {conflictState: {inConflict: bool, conflicts: [{path:...}]}}
        // Some paths flatten this to {inConflict: bool, conflicts: [...]}
        final conflictState = state['conflictState'] is Map
            ? Map<String, dynamic>.from(state['conflictState'] as Map)
            : state;
        final conflictList = <String>[];
        final rawConflicts = conflictState['conflicts'];
        if (rawConflicts is List) {
          for (final c in rawConflicts) {
            if (c is Map && c['path'] != null) {
              conflictList.add(c['path'].toString());
            } else if (c is String) {
              conflictList.add(c);
            }
          }
        }
        final isConflict =
            conflictState['inConflict'] == true ||
            state['inConflict'] == true ||
            conflictList.isNotEmpty;

        final fileStatuses = <String, String>{};
        void addStatusList(dynamic list, String status) {
          if (list is List) {
            for (final item in list) {
              if (item is String && item.isNotEmpty) {
                fileStatuses[item] = status;
                final base = item.split(RegExp(r'[/\\]')).last;
                fileStatuses[base] = status;
              } else if (item is Map && item['path'] != null) {
                final p = item['path'].toString();
                final s = item['status']?.toString() ?? status;
                fileStatuses[p] = s;
                final base = p.split(RegExp(r'[/\\]')).last;
                fileStatuses[base] = s;
              }
            }
          }
        }

        addStatusList(state['modifiedFiles'], 'M');
        addStatusList(state['untrackedFiles'], '?');
        addStatusList(state['stagedFiles'], '+');
        addStatusList(state['deletedFiles'], 'D');
        addStatusList(rawConflicts, '!');
        if (state['files'] is List) {
          addStatusList(state['files'], 'M');
        }

        setState(() {
          _inConflict = isConflict;
          _conflicts = conflictList;
          _fileGitStatuses = fileStatuses;
          if (state['currentRef'] is String &&
              (state['currentRef'] as String).isNotEmpty) {
            _currentGitBranch = state['currentRef'] as String;
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _loadFile(String path) async {
    setState(() {
      _selectedFilePath = path;
      _isLoadingCode = true;
      _codeContent = '';
      _imageBytes = null;
    });
    try {
      final res = await widget.api!.readFile(
        path,
        workspacePath: _workspaceResolved,
      );
      if (mounted) {
        Uint8List? imgBytes;
        final rawB64 = res['base64Data'] ?? (res['data'] is Map ? res['data']['base64Data'] : null);
        if (rawB64 is String && rawB64.isNotEmpty) {
          try {
            imgBytes = base64Decode(rawB64);
          } catch (_) {}
        }
        if (imgBytes == null && File(path).existsSync()) {
          try {
            imgBytes = File(path).readAsBytesSync();
          } catch (_) {}
        }
        setState(() {
          final rawContent = res['content'] ?? res['text'] ?? (res['data'] is Map ? (res['data']['content'] ?? res['data']['text']) : null);
          _codeContent = rawContent?.toString() ?? '';
          _imageBytes = imgBytes;
          _isLoadingCode = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _codeContent = 'Erreur: $e';
          _imageBytes = null;
          _isLoadingCode = false;
        });
      }
    }
  }

  /// Partage / exportation du fichier ouvert via Share.shareXFiles (P7).
  Future<void> _shareFile() async {
    if (_selectedFilePath.isEmpty || _isLoadingCode) return;
    try {
      final fileName = _selectedFilePath.split('/').last.split('\\').last;
      final tempDir = await getTemporaryDirectory();
      final tempFile = File('${tempDir.path}/$fileName');
      await tempFile.writeAsString(_codeContent);
      await Share.shareXFiles([XFile(tempFile.path)], text: 'Fichier $fileName depuis Antigravity Workspace');
    } catch (_) {
      await Share.share(_codeContent, subject: _selectedFilePath.split('/').last);
    }
  }

  /// Grep workspace : délègue au daemon (search_files), résultats tapables.
  /// On ferme le drawer si ouvert (mobile) puis on charge le fichier.
  Future<void> _searchInWorkspace() async {
    final query = _grepController.text.trim();
    if (query.isEmpty || widget.api == null) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _isGrepLoading = true;
      _grepResults = [];
    });
    try {
      final res = await widget.api!.searchFiles(_workspaceResolved, query);
      if (mounted) {
        setState(() {
          final rawResults = res['results'] ?? res['matches'] ?? (res['data'] is Map ? (res['data']['results'] ?? res['data']['matches']) : null);
          _grepResults = (rawResults is List)
              ? rawResults.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
              : <Map<String, dynamic>>[];
          _isGrepLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _grepResults = [];
          _isGrepLoading = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Recherche impossible : $e'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  void _openGrepResult(String path, int? line) {
    final scaffold = Scaffold.maybeOf(context);
    if (scaffold != null && scaffold.isDrawerOpen) {
      scaffold.closeDrawer();
    }
    _loadFile(path);
    // Retour au fichier si l'utilisateur est dans l'onglet Grep :
    // l'aperçu code est prioritaire (le panneau reste accessible via l'icône).
    if (_showGrep && _selectedFilePath == path) {
      setState(() => _showGrep = false);
    }
  }

  void _showBranchSelectorBottomSheet(BuildContext context) {
    if (_gitBranches.isEmpty) return;
    final scheme = Theme.of(context).colorScheme;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.alt_route, size: 20, color: scheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Changer de branche Git',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: scheme.onSurface,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _gitBranches.length,
                  itemBuilder: (context, idx) {
                    final branch = _gitBranches[idx];
                    final isCurrent = branch == _currentGitBranch;
                    return ListTile(
                      leading: Icon(
                        isCurrent ? Icons.check_circle : Icons.radio_button_unchecked,
                        color: isCurrent ? AppColors.positive : scheme.outline,
                        size: 18,
                      ),
                      title: Text(
                        branch,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                          color: scheme.onSurface,
                        ),
                      ),
                      onTap: () async {
                        Navigator.of(ctx).pop();
                        if (isCurrent || widget.api == null) return;
                        final messenger = ScaffoldMessenger.of(context);
                        try {
                          await widget.api!.sendCommand(
                            'git checkout $branch',
                            workspacePath: _workspaceResolved,
                          );
                          await _loadGitBranches();
                          await _loadGitState();
                          await _loadFiles();
                          if (mounted) {
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Branche basculée sur $branch'),
                              ),
                            );
                          }
                        } catch (e) {
                          if (mounted) {
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Erreur changement de branche: $e'),
                              ),
                            );
                          }
                        }
                      },
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

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < 600;

        final fileTree = Container(
          width: isMobile ? double.infinity : 280,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border(
              right: BorderSide(
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                key: _workspaceButtonKey,
                onTap: () => _showWorkspaceDropdown(context),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(
                        Icons.folder_open,
                        size: 16,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _workspaceLabel,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (_inConflict) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.error,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text(
                            'CONFLIT',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                      if (_currentGitBranch != null) ...[
                        const SizedBox(width: 6),
                        InkWell(
                          onTap: () => _showBranchSelectorBottomSheet(context),
                          borderRadius: BorderRadius.circular(8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: Theme.of(
                                context,
                              ).colorScheme.secondaryContainer,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.alt_route,
                                  size: 10,
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSecondaryContainer,
                                ),
                                const SizedBox(width: 3),
                                Text(
                                  _currentGitBranch!,
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSecondaryContainer,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      Icon(
                        Icons.keyboard_arrow_down,
                        size: 16,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
              ),
              if (_inConflict)
                Container(
                  margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: Theme.of(context).colorScheme.error.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.warning_amber_rounded,
                            size: 15,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Conflits Git (${_conflicts.length})',
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context).colorScheme.onErrorContainer,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (_conflicts.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        ..._conflicts.take(3).map((c) => Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: InkWell(
                            onTap: () {
                              final scaffold = Scaffold.maybeOf(context);
                              if (scaffold != null && scaffold.isDrawerOpen) {
                                scaffold.closeDrawer();
                              }
                              _loadFile(c);
                            },
                            child: Text(
                              '• $c',
                              style: TextStyle(
                                fontSize: 10.5,
                                fontFamily: 'monospace',
                                color: Theme.of(context).colorScheme.onErrorContainer,
                                decoration: TextDecoration.underline,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )),
                      ],
                    ],
                  ),
                ),
              // Bug #5 : barre de recherche substring.
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: TextField(
                  controller: _searchController,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Rechercher...',
                    hintStyle: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    prefixIcon: Icon(
                      Icons.search,
                      size: 16,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    suffixIcon:
                        _searchQuery.isNotEmpty
                            ? IconButton(
                              icon: Icon(
                                Icons.close,
                                size: 14,
                                color:
                                    Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                              ),
                              tooltip: 'Effacer la recherche',
                              onPressed: () => _searchController.clear(),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 28,
                                minHeight: 28,
                              ),
                            )
                            : null,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      borderSide: BorderSide(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      borderSide: BorderSide(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      borderSide: BorderSide(
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    filled: true,
                    fillColor:
                        Theme.of(context).colorScheme.surfaceContainerHighest,
                  ),
                ),
              ),
              // Filtres rapides par extension (Axe 2)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    _buildFilterChip(null, 'Tout', Icons.all_inclusive_outlined),
                    _buildFilterChip('.dart', 'Dart'),
                    _buildFilterChip('.go', 'Go'),
                    _buildFilterChip('.ts', 'TS'),
                    _buildFilterChip('.json', 'JSON'),
                    _buildFilterChip('.md', 'MD'),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: _buildFileStatsRow(),
              ),
              const SizedBox(height: 6),
              const Divider(height: 1),
              Expanded(
                child:
                    _isLoadingTree
                        ? _buildSkeletonTree()
                        : _loadError != null
                        ? _buildErrorState(_loadError!)
                        : _buildFileList(),
              ),
            ],
          ),
        );

        return Scaffold(
          backgroundColor: Theme.of(context).colorScheme.surface,
          appBar: AppBar(
            title: const Text('Explorateur de Fichiers'),
            backgroundColor: Theme.of(context).colorScheme.surfaceContainer,
            actions: [
              IconButton(
                icon: const Icon(Icons.commit_outlined, size: 20),
                tooltip: 'Créer un commit Git (IA)',
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(context);
                  final msg = await GitCommitDialog.show(
                    context,
                    api: widget.api,
                    workspacePath: _workspaceResolved,
                  );
                  if (msg != null && mounted) {
                    messenger.showSnackBar(
                      SnackBar(
                        content: Text('Message de commit prêt :\n$msg'),
                        duration: const Duration(seconds: 3),
                      ),
                    );
                  }
                },
              ),
              IconButton(
                icon: Icon(
                  Icons.manage_search_rounded,
                  size: 20,
                  color:
                      _showGrep
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                tooltip: 'Rechercher dans le workspace (grep)',
                onPressed: () {
                  setState(() {
                    _showGrep = !_showGrep;
                    if (!_showGrep) _grepResults = [];
                  });
                  if (_showGrep) {
                    // Autofocus après le build du panneau.
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted && _grepController.text.isEmpty) {
                        FocusScope.of(context).requestFocus(_grepFocusNode);
                      }
                    });
                  }
                },
              ),
            ],
          ),
          drawer: isMobile ? Drawer(child: SafeArea(child: fileTree)) : null,
          body: Row(
            children: [
              if (!isMobile) fileTree,
              // ── Right Code View
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      color: Theme.of(context).colorScheme.surfaceContainer,
                      child: Row(
                        children: [
                          Icon(
                            _selectedFilePath.isEmpty
                                ? Icons.folder_open_outlined
                                : Icons.description_outlined,
                            size: 16,
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _buildBreadcrumbs(),
                          ),
                          IconButton(
                            icon: Icon(
                              _selectedFilePath.endsWith('.png') ||
                                      _selectedFilePath.endsWith('.jpg') ||
                                      _selectedFilePath.endsWith('.svg')
                                  ? Icons.image_search_outlined
                                  : Icons.copy_all_outlined,
                              size: 16,
                              color:
                                  Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                            ),
                            tooltip:
                                _selectedFilePath.endsWith('.png') ||
                                        _selectedFilePath.endsWith('.jpg') ||
                                        _selectedFilePath.endsWith('.svg')
                                    ? 'Copier l\'image'
                                    : 'Copier le contenu',
                            onPressed:
                                _selectedFilePath.isEmpty || _isLoadingCode
                                    ? null
                                    : () async {
                                      final messenger = ScaffoldMessenger.of(
                                        context,
                                      );
                                      await Clipboard.setData(
                                        ClipboardData(text: _codeContent),
                                      );
                                      if (!mounted) return;
                                      messenger.showSnackBar(
                                        SnackBar(
                                          content: Text(
                                            _selectedFilePath.endsWith(
                                                      '.png',
                                                    ) ||
                                                    _selectedFilePath.endsWith(
                                                      '.jpg',
                                                    ) ||
                                                    _selectedFilePath.endsWith(
                                                      '.svg',
                                                    )
                                                ? 'Image copiée dans le presse-papier !'
                                                : 'Contenu copié : ${_selectedFilePath.split('/').last}',
                                          ),
                                          duration: const Duration(seconds: 1),
                                        ),
                                      );
                                    },
                          ),
                          // Markdown preview toggle (si fichier .md)
                          if (_selectedFilePath.toLowerCase().endsWith('.md') ||
                              _selectedFilePath.toLowerCase().endsWith('.markdown'))
                            IconButton(
                              icon: Icon(
                                _isMarkdownPreview
                                    ? Icons.code_rounded
                                    : Icons.menu_book_rounded,
                                size: 16,
                                color: _isMarkdownPreview
                                    ? Theme.of(context).colorScheme.primary
                                    : Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                              tooltip: _isMarkdownPreview
                                  ? 'Afficher le code source'
                                  : 'Afficher l\'aperçu formaté',
                              onPressed: () => setState(() {
                                _isMarkdownPreview = !_isMarkdownPreview;
                              }),
                            ),
                          // Jump to line button
                          IconButton(
                            icon: Icon(
                              Icons.format_list_numbered_rounded,
                              size: 16,
                              color: _targetLineNumber != null
                                  ? Theme.of(context).colorScheme.primary
                                  : Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                            tooltip: 'Aller à la ligne...',
                            onPressed: _selectedFilePath.isEmpty || _isLoadingCode
                                ? null
                                : () => _showJumpToLineDialog(context),
                          ),
                          // Find-in-page toggle
                          IconButton(
                            icon: Icon(
                              Icons.search,
                              size: 16,
                              color:
                                  _showFindBar
                                      ? Theme.of(context).colorScheme.primary
                                      : Theme.of(
                                        context,
                                      ).colorScheme.onSurfaceVariant,
                            ),
                            tooltip: 'Rechercher dans le fichier (Cmd+F)',
                            onPressed:
                                _selectedFilePath.isEmpty
                                    ? null
                                    : () => setState(() {
                                      _showFindBar = !_showFindBar;
                                      if (!_showFindBar) {
                                        _findController.clear();
                                      }
                                    }),
                          ),
                          // Share file (P7)
                          IconButton(
                            icon: Icon(
                              Icons.share_outlined,
                              size: 16,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                            tooltip: 'Partager le fichier',
                            onPressed:
                                _selectedFilePath.isEmpty || _isLoadingCode
                                    ? null
                                    : _shareFile,
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    // Find-in-page bar (toggle via icône loupe)
                    if (_showFindBar)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        color: Theme.of(context).colorScheme.surfaceContainer,
                        child: Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _findController,
                                autofocus: true,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  color:
                                      Theme.of(context).colorScheme.onSurface,
                                ),
                                decoration: InputDecoration(
                                  hintText: 'Trouver dans le fichier...',
                                  hintStyle: TextStyle(
                                    fontSize: 12.5,
                                    color:
                                        Theme.of(
                                          context,
                                        ).colorScheme.onSurfaceVariant,
                                  ),
                                  prefixIcon: Icon(
                                    Icons.search,
                                    size: 16,
                                    color:
                                        Theme.of(
                                          context,
                                        ).colorScheme.onSurfaceVariant,
                                  ),
                                  isDense: true,
                                  contentPadding: const EdgeInsets.symmetric(
                                    vertical: 8,
                                  ),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  filled: true,
                                  fillColor:
                                      Theme.of(
                                        context,
                                      ).colorScheme.surfaceContainerHighest,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            if (_findQuery.isNotEmpty)
                              Text(
                                '${_countMatches(_codeContent, _findQuery)} rés.',
                                style: TextStyle(
                                  fontSize: 11,
                                  color:
                                      Theme.of(
                                        context,
                                      ).colorScheme.onSurfaceVariant,
                                ),
                              ),
                            IconButton(
                              icon: const Icon(Icons.close, size: 16),
                              tooltip: 'Fermer la recherche',
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 28,
                                minHeight: 28,
                              ),
                              onPressed:
                                  () => setState(() {
                                    _showFindBar = false;
                                    _findController.clear();
                                  }),
                            ),
                          ],
                        ),
                      ),
                    // Grep workspace : panneau de résultats en remplacement du
                    // viewer de code quand _showGrep est actif.
                    if (_showGrep)
                      Expanded(
                        child: Container(
                          width: double.infinity,
                          color:
                              Theme.of(
                                context,
                              ).colorScheme.surfaceContainerHighest,
                          child: _buildGrepPanel(),
                        ),
                      )
                    else
                      Expanded(
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          color:
                              Theme.of(
                                context,
                              ).colorScheme.surfaceContainerHighest,
                          child:
                              _isLoadingCode
                                  ? _buildSkeletonCode()
                                  : _buildCodeView(),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showWorkspaceDropdown(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final projects = widget.projects;

    CustomDropdownOverlay.show(
      context: context,
      targetKey: _workspaceButtonKey,
      width: 320,
      child: Material(
        color: Colors.transparent,
        child: ListView(
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          children: [
            if (projects.isNotEmpty)
              ...projects.map((proj) {
                final dispName = proj.name.isNotEmpty
                    ? proj.name
                    : _extractWorkspaceName(proj.path);
                final isSelected = proj.name == _workspaceLabel ||
                    proj.path == _workspaceResolved ||
                    _extractWorkspaceName(proj.path) == _workspaceLabel;
                return _buildWorkspaceItem(
                  dispName,
                  isSelected,
                  scheme,
                  onTap: () {
                    CustomDropdownOverlay.hide();
                    final chosenPath = proj.path.isNotEmpty ? proj.path : proj.folderUri;
                    widget.onSelectWorkspace?.call(chosenPath);
                    setState(() {
                      _workspaceResolved = resolveWorkspace(chosenPath);
                      _selectedFilePath = '';
                      _codeContent = '// Sélectionnez un fichier';
                      _isLoadingTree = true;
                    });
                    _loadFiles();
                  },
                );
              })
            else
              _buildWorkspaceItem(_workspaceLabel, true, scheme),
            Divider(color: scheme.outlineVariant, height: 1),
            _buildWorkspaceActionItem(
              Icons.create_new_folder_outlined,
              'New Project',
              scheme,
            ),
            _buildWorkspaceActionItem(
              Icons.bolt_outlined,
              'Quick Start',
              scheme,
            ),
            Divider(color: scheme.outlineVariant, height: 1),
            _buildWorkspaceActionItem(
              Icons.do_disturb_alt_outlined,
              'No Project',
              scheme,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWorkspaceItem(
    String title,
    bool isSelected,
    ColorScheme scheme, {
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap ?? () {
        CustomDropdownOverlay.hide();
      },
      child: Container(
        color: isSelected ? scheme.surfaceContainerHighest : Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(
              Icons.folder_outlined,
              size: 16,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                  color: scheme.onSurface,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWorkspaceActionItem(
    IconData icon,
    String title,
    ColorScheme scheme,
  ) {
    return InkWell(
      onTap: () {
        CustomDropdownOverlay.hide();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(icon, size: 16, color: scheme.onSurfaceVariant),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: TextStyle(fontSize: 13, color: scheme.onSurface),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Fil d'Ariane interactif pour la navigation dans l'en-tête de code.
  Widget _buildBreadcrumbs() {
    if (_selectedFilePath.isEmpty) {
      return Text(
        'Sélectionnez un fichier',
        style: TextStyle(
          fontSize: 12.5,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      );
    }
    final normalized = _selectedFilePath.replaceAll(r'\', '/');
    final segments = normalized.split('/');
    final scheme = Theme.of(context).colorScheme;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (int i = 0; i < segments.length; i++) ...[
            if (i > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Icon(
                  Icons.chevron_right_rounded,
                  size: 14,
                  color: scheme.outlineVariant,
                ),
              ),
            if (i == segments.length - 1)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  segments[i],
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: scheme.primary,
                  ),
                ),
              )
            else
              InkWell(
                onTap: () {
                  final folderPath = segments.sublist(0, i + 1).join('/');
                  setState(() {
                    _collapsedFolders.remove(folderPath);
                  });
                },
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Text(
                    segments[i],
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  // Bug #3 : perf — construit la liste une seule fois, filtrée par _searchQuery.
  /// Puce de filtre d'extension rapide (Axe 2).
  Widget _buildFilterChip(String? ext, String label, [IconData? icon]) {
    final scheme = Theme.of(context).colorScheme;
    final selected = _selectedExtensionFilter == ext;
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: selected ? scheme.onPrimary : scheme.onSurfaceVariant),
            const SizedBox(width: 4),
          ],
          Text(label, style: const TextStyle(fontSize: 10.5)),
        ],
      ),
      selected: selected,
      showCheckmark: false,
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      backgroundColor: scheme.surfaceContainerHighest,
      selectedColor: scheme.primary,
      labelStyle: TextStyle(
        fontSize: 10.5,
        color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
      ),
      side: BorderSide(color: selected ? scheme.primary : scheme.outlineVariant),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      onSelected: (_) => setState(() {
        _selectedExtensionFilter = selected ? null : ext;
      }),
    );
  }

  /// Bascule l'expansion de tous les dossiers
  void _toggleCollapseAll() {
    setState(() {
      if (_collapsedFolders.isNotEmpty) {
        _collapsedFolders.clear();
      } else {
        for (final f in _files) {
          if (f['isDir'] == true) {
            final p = (f['fullPath'] as String?) ?? (f['name'] as String);
            _collapsedFolders.add(p);
          }
        }
      }
    });
  }

  /// Compteur fichiers/dossiers affichés avec bouton plier/déplier.
  Widget _buildFileStatsRow() {
    final scheme = Theme.of(context).colorScheme;
    final hasFolders = _files.any((f) => f['isDir'] == true);
    final allCollapsed = hasFolders && _collapsedFolders.isNotEmpty;

    return Row(
      children: [
        Expanded(
          child: Text(
            _buildFileStats(),
            style: TextStyle(
              fontSize: 10.5,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
        if (hasFolders)
          InkWell(
            onTap: _toggleCollapseAll,
            borderRadius: BorderRadius.circular(4),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    allCollapsed ? Icons.unfold_more_rounded : Icons.unfold_less_rounded,
                    size: 13,
                    color: scheme.primary,
                  ),
                  const SizedBox(width: 3),
                  Text(
                    allCollapsed ? 'Déplier' : 'Plier',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: scheme.primary,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  String _buildFileStats() {
    final files = _files.where((f) => f['isDir'] != true).length;
    final dirs = _files.length - files;
    final active = _selectedExtensionFilter;
    final base = '$files fichiers · $dirs dossiers';
    if (active == null) return base;
    final count = _files.where((f) {
      if (f['isDir'] == true) return false;
      return (f['name'] as String).toLowerCase().endsWith(active);
    }).length;
    return '$count · $active · $base';
  }

  Widget _buildFileList() {
    if (_files.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.folder_open_outlined,
              size: 40,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 8),
            Text(
              'Espace de travail vide',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Aucun fichier à afficher dans ce répertoire.',
              style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    }
    var filtered =
        _searchQuery.isEmpty
            ? _files
            : _files.where((f) {
              final name = (f['name'] as String).toLowerCase();
              return name.contains(_searchQuery);
            }).toList();
    if (_selectedExtensionFilter != null) {
      filtered = filtered.where((f) {
        if (f['isDir'] == true) return false;
        final name = (f['name'] as String).toLowerCase();
        return name.endsWith(_selectedExtensionFilter!);
      }).toList();
    }

    if (filtered.isEmpty) {
      final hasFilters = _searchQuery.isNotEmpty || _selectedExtensionFilter != null;
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _searchQuery.isEmpty
                    ? (_selectedExtensionFilter != null
                        ? 'Aucun fichier «\u00a0$_selectedExtensionFilter\u00a0»'
                        : 'Aucun fichier dans ce workspace')
                    : 'Aucun résultat pour «\u00a0$_searchQuery\u00a0»',
                style: TextStyle(
                  fontSize: 12.5,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              if (hasFilters) ...[
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _searchController.clear();
                      _selectedExtensionFilter = null;
                    });
                  },
                  icon: const Icon(Icons.refresh_rounded, size: 14),
                  label: const Text('Réinitialiser les filtres', style: TextStyle(fontSize: 12)),
                ),
              ],
            ],
          ),
        ),
      );
    }

    // Gestion du masquage des enfants de dossiers pliés
    final List<Map<String, dynamic>> visibleItems = [];
    int? activeCollapsedDepth;

    for (final file in filtered) {
      final isDir = file['isDir'] == true;
      final fullPath = (file['fullPath'] as String?) ?? (file['name'] as String);
      final depth = (file['depth'] as num?)?.toInt() ?? 0;

      if (_searchQuery.isNotEmpty) {
        visibleItems.add(file);
        continue;
      }

      if (activeCollapsedDepth != null) {
        if (depth > activeCollapsedDepth) {
          continue;
        } else {
          activeCollapsedDepth = null;
        }
      }

      visibleItems.add(file);

      if (isDir && _collapsedFolders.contains(fullPath)) {
        activeCollapsedDepth = depth;
      }
    }

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 12),
      itemCount: visibleItems.length,
      itemBuilder: (context, index) {
        final file = visibleItems[index];
        final isDir = file['isDir'] == true;
        final name = file['name'] as String;
        final depth = (file['depth'] as num?)?.toInt() ?? 0;
        final fullPath = file['fullPath'] as String? ?? name;
        final isSelected = fullPath == _selectedFilePath;

        if (isDir) {
          final isCollapsed = _collapsedFolders.contains(fullPath);
          return _TreeFolder(
            title: name,
            depth: depth,
            isCollapsed: isCollapsed,
            searchQuery: _searchQuery,
            onTap: () {
              setState(() {
                if (isCollapsed) {
                  _collapsedFolders.remove(fullPath);
                } else {
                  _collapsedFolders.add(fullPath);
                }
              });
            },
            onLongPress: () => _showFileContextMenu(context, fullPath, true),
          );
        } else {
          final status = _fileGitStatuses[fullPath] ?? _fileGitStatuses[name];
          return _TreeFile(
            title: name,
            depth: depth,
            isSelected: isSelected,
            gitStatus: status,
            searchQuery: _searchQuery,
            onTap: () {
              // Mobile : le drawer reste ouvert après sélection sinon.
              final scaffold = Scaffold.maybeOf(context);
              if (scaffold != null && scaffold.isDrawerOpen) {
                scaffold.closeDrawer();
              }
              _loadFile(fullPath);
            },
            onLongPress: () => _showFileContextMenu(context, fullPath, false),
          );
        }
      },
    );
  }

  // Bug #6 : état d'erreur explicite avec bouton de rechargement.
  Widget _buildErrorState(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              size: 32,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(
              'Impossible de charger les fichiers',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurface,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              error,
              style: TextStyle(
                fontSize: 11.5,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () {
                setState(() {
                  _isLoadingTree = true;
                  _loadError = null;
                });
                _loadFiles();
              },
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Réessayer'),
            ),
          ],
        ),
      ),
    );
  }

  // Find-in-page : comptage des occurrences (insensible à la casse).
  // ponytail: allMatches() d'une RegExp — stdlib, zéro allocation custom.
  int _countMatches(String content, String query) {
    if (query.isEmpty) return 0;
    return RegExp(
      RegExp.escape(query),
      caseSensitive: false,
    ).allMatches(content).length;
  }

  /// Panneau grep : barre de recherche + résultats (fichier:ligne + snippet).
  Widget _buildGrepPanel() {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _grepController,
                  focusNode: _grepFocusNode,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _searchInWorkspace(),
                  decoration: InputDecoration(
                    hintText: 'Rechercher dans le workspace…',
                    hintStyle: TextStyle(
                      fontSize: 13,
                      color: scheme.onSurfaceVariant,
                    ),
                    prefixIcon: Icon(
                      Icons.search,
                      size: 18,
                      color: scheme.onSurfaceVariant,
                    ),
                    suffixIcon:
                        _grepController.text.isNotEmpty
                            ? IconButton(
                              icon: const Icon(Icons.close, size: 16),
                              tooltip: 'Effacer',
                              onPressed: () {
                                _grepController.clear();
                                setState(() => _grepResults = []);
                              },
                            )
                            : null,
                    isDense: true,
                    filled: true,
                    fillColor: scheme.surfaceContainer,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: _isGrepLoading ? null : _searchInWorkspace,
                icon:
                    _isGrepLoading
                        ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                        : const Icon(Icons.search, size: 16),
                label: const Text('Chercher'),
              ),
            ],
          ),
        ),
        if (_isGrepLoading)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          )
        else if (_grepResults.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                _grepController.text.trim().isEmpty
                    ? 'Saisis un terme puis touche Chercher.'
                    : 'Aucun résultat pour «\u00a0${_grepController.text.trim()}\u00a0»',
                style: TextStyle(
                  fontSize: 12.5,
                  color: scheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 12),
              itemCount: _grepResults.length,
              itemBuilder: (context, index) {
                final r = _grepResults[index];
                final path = (r['path'] as String?) ?? '';
                final line = (r['line'] as num?)?.toInt();
                final snippet = (r['snippet'] as String?) ?? '';
                final isNameMatch = r['match'] == 'name';
                return _SearchResultTile(
                  path: path,
                  line: line,
                  snippet: snippet,
                  isNameMatch: isNameMatch,
                  onTap: () => _openGrepResult(path, line),
                );
              },
            ),
          ),
      ],
    );
  }

  // Bug find-in-page + Bug #4 (diffs > 1000 lignes) :
  // — Quand _findQuery est vide : ListView.builder ligne par ligne (virtualisation)
  //   → corrige le rendu défaillant sur les fichiers volumineux (>1000 lignes).
  // — Quand _findQuery est non-vide : RichText avec spans surlignés ligne par ligne.
  // ponytail: on ne reconstruit que les lignes visibles (itemBuilder à la volée).
  Widget _buildCodeView() {
    // Handling SVG previews safely without crashing on raw binary
    if (_selectedFilePath.endsWith('.svg')) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            color: Theme.of(context).colorScheme.surfaceContainer,
            child: Row(
              children: [
                Icon(
                  Icons.image_outlined,
                  size: 16,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  'Aperçu Vectoriel SVG',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Container(
              constraints: const BoxConstraints(minWidth: 200, minHeight: 200),
              padding: const EdgeInsets.all(12),
              child: SingleChildScrollView(child: SelectableText(_codeContent)),
            ),
          ),
        ],
      );
    }

    // Fichiers images réels avec zoom interactif
    final lowerPath = _selectedFilePath.toLowerCase();
    final isImg = lowerPath.endsWith('.png') ||
        lowerPath.endsWith('.jpg') ||
        lowerPath.endsWith('.jpeg') ||
        lowerPath.endsWith('.gif') ||
        lowerPath.endsWith('.webp') ||
        lowerPath.endsWith('.ico') ||
        lowerPath.endsWith('.bmp');
    if (isImg) {
      return _buildImagePreview();
    }

    // Fichiers binaires (audio, vidéo, archives, PDF) : pas de numéros de ligne
    final isBinary =
        lowerPath.endsWith('.mp3') ||
        lowerPath.endsWith('.wav') ||
        lowerPath.endsWith('.ogg') ||
        lowerPath.endsWith('.flac') ||
        lowerPath.endsWith('.mp4') ||
        lowerPath.endsWith('.webm') ||
        lowerPath.endsWith('.mov') ||
        lowerPath.endsWith('.mkv') ||
        lowerPath.endsWith('.avi') ||
        lowerPath.endsWith('.pdf') ||
        lowerPath.endsWith('.zip') ||
        lowerPath.endsWith('.tar') ||
        lowerPath.endsWith('.gz');
    if (isBinary) {
      final ext = _selectedFilePath.contains('.') ? _selectedFilePath.split('.').last.toUpperCase() : 'BIN';
      return Center(
        child: _buildBinaryPlaceholder(ext),
      );
    }

    // Markdown preview si activé
    if (_isMarkdownPreview &&
        (_selectedFilePath.toLowerCase().endsWith('.md') ||
            _selectedFilePath.toLowerCase().endsWith('.markdown'))) {
      return Container(
        width: double.infinity,
        color: Theme.of(context).colorScheme.surface,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: MarkdownBubble(
            text: _codeContent,
            workspacePath: _workspaceResolved,
            api: widget.api,
            onLocalFile: (path) => _loadFile(path),
          ),
        ),
      );
    }

    // Tronquage de sécurité pour éviter les plantages sur les sorties > 2000 lignes ou > 50 000 caractères
    final bool isLargeFile = _codeContent.length > 50000;
    final safeContent =
        isLargeFile ? _codeContent.substring(0, 50000) : _codeContent;
    final rawLines = safeContent.split('\n');
    final lines = rawLines.length > 2000 ? rawLines.sublist(0, 2000) : rawLines;

    final textStyle = TextStyle(
      fontFamily: 'monospace',
      fontSize: 12,
      height: 1.5,
      color: Theme.of(context).colorScheme.onSurface,
    );
    final lineNumberStyle = TextStyle(
      fontFamily: 'monospace',
      fontSize: 11,
      height: 1.5,
      color: Theme.of(
        context,
      ).colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
    );

    final ext = _selectedFilePath.contains('.') ? _selectedFilePath.split('.').last.toLowerCase() : '';
    // Lignes du viewer : numéros + contenu avec ciblage et sélection de ligne
    final codeList = ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: lines.length,
      itemBuilder: (context, index) {
        final lineNum = '${index + 1}'.padLeft(4, ' ');
        final line = lines[index];
        final isTargetLine = _targetLineNumber != null && (index + 1) == _targetLineNumber;

        Widget contentWidget;
        if (_findQuery.isEmpty) {
          final highlightedSpans = SyntaxHighlighter.highlight(
            line,
            ext,
            defaultTextColor: Theme.of(context).colorScheme.onSurface,
          );
          contentWidget = Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$lineNum │ ',
                style: isTargetLine
                    ? lineNumberStyle.copyWith(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.bold,
                      )
                    : lineNumberStyle,
              ),
              Expanded(
                child: SelectableText.rich(
                  TextSpan(
                    style: textStyle,
                    children: highlightedSpans,
                  ),
                  maxLines: null,
                ),
              ),
            ],
          );
        } else {
          // Surlignage : découper la ligne en spans autour de chaque match.
          final spans = <TextSpan>[];
          final pattern = RegExp(RegExp.escape(_findQuery), caseSensitive: false);
          int cursor = 0;
          for (final match in pattern.allMatches(line)) {
            if (match.start > cursor) {
              spans.add(TextSpan(text: line.substring(cursor, match.start)));
            }
            spans.add(
              TextSpan(
                text: line.substring(match.start, match.end),
                style: TextStyle(
                  backgroundColor: Theme.of(
                    context,
                  ).colorScheme.primary.withValues(alpha: 0.30),
                  color: Theme.of(context).colorScheme.onSurface,
                  fontWeight: FontWeight.bold,
                ),
              ),
            );
            cursor = match.end;
          }
          if (cursor < line.length) {
            spans.add(TextSpan(text: line.substring(cursor)));
          }
          contentWidget = Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$lineNum │ ',
                style: isTargetLine
                    ? lineNumberStyle.copyWith(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.bold,
                      )
                    : lineNumberStyle,
              ),
              Expanded(
                child: SelectableText.rich(
                  TextSpan(style: textStyle, children: spans),
                  maxLines: null,
                ),
              ),
            ],
          );
        }

        return InkWell(
          onTap: () {
            setState(() {
              _targetLineNumber = isTargetLine ? null : (index + 1);
            });
          },
          child: Container(
            decoration: isTargetLine
                ? BoxDecoration(
                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
                    border: Border(
                      left: BorderSide(
                        color: Theme.of(context).colorScheme.primary,
                        width: 3.0,
                      ),
                    ),
                  )
                : null,
            padding: EdgeInsets.only(left: isTargetLine ? 0 : 3.0),
            child: contentWidget,
          ),
        );
      },
    );

    return Column(
      children: [
        if (isLargeFile || rawLines.length > 2000)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            color: Theme.of(
              context,
            ).colorScheme.primary.withValues(alpha: 0.10),
            child: Text(
              isLargeFile && rawLines.length > 2000
                  ? 'Fichier volumineux — ${rawLines.length} lignes, 2000 affichées (contenu tronqué à 50 000 caractères)'
                  : isLargeFile
                  ? 'Fichier volumineux — contenu tronqué à 50 000 caractères'
                  : 'Fichier volumineux — ${rawLines.length} lignes, 2000 affichées',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ),
        Expanded(
          // ponytail: largeur estimée (7.2px/char monospace 12px) pour le
          // scroll horizontal — pas de mesure de layout coûteuse sur les gros
          // fichiers. À remplacer par un TextPainter si les lignes débordent.
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: math.max(
                MediaQuery.sizeOf(context).width,
                lines.fold<int>(0, (m, l) => l.length > m ? l.length : m) *
                        7.2 +
                    60,
              ),
              child: codeList,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildImagePreview() {
    final scheme = Theme.of(context).colorScheme;
    final fileName = _selectedFilePath.split(RegExp(r'[/\\]')).last;
    final ext = fileName.contains('.') ? fileName.split('.').last.toUpperCase() : 'IMG';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          color: scheme.surfaceContainer,
          child: Row(
            children: [
              Icon(Icons.image_outlined, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Text(
                'Aperçu Image $ext',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: scheme.primary,
                ),
              ),
              const Spacer(),
              if (_imageBytes != null)
                Text(
                  '${(_imageBytes!.length / 1024).toStringAsFixed(1)} Ko',
                  style: TextStyle(
                    fontSize: 11,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: Center(
            child: _imageBytes != null
                ? Container(
                    margin: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(color: scheme.outlineVariant, width: 0.5),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: InteractiveViewer(
                      minScale: 0.5,
                      maxScale: 4.0,
                      child: Image.memory(
                        _imageBytes!,
                        fit: BoxFit.contain,
                        errorBuilder: (ctx, err, stack) => _buildBinaryPlaceholder(ext),
                      ),
                    ),
                  )
                : _buildBinaryPlaceholder(ext),
          ),
        ),
      ],
    );
  }

  Widget _buildBinaryPlaceholder(String ext) {
    final scheme = Theme.of(context).colorScheme;
    final lower = ext.toLowerCase();
    final isAudio = lower == 'mp3' || lower == 'wav' || lower == 'ogg' || lower == 'flac';
    final isVideo = lower == 'mp4' || lower == 'webm' || lower == 'mov' || lower == 'mkv' || lower == 'avi';
    final isArchive = lower == 'zip' || lower == 'tar' || lower == 'gz';

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          isAudio
              ? Icons.audio_file_outlined
              : isVideo
                  ? Icons.video_file_outlined
                  : isArchive
                      ? Icons.folder_zip_outlined
                      : Icons.image_outlined,
          size: 48,
          color: scheme.primary,
        ),
        const SizedBox(height: 12),
        Text(
          'Fichier $ext',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Aperçu binaire — numéros de ligne masqués',
          style: TextStyle(
            fontSize: 12,
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  Widget _buildSkeletonTree() {
    return ListView.builder(
      itemCount: 8,
      padding: const EdgeInsets.only(bottom: 12, left: 12, right: 12),
      itemBuilder: (context, index) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Container(
                width: 16,
                height: 16,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 100 + (index % 3) * 40.0,
                height: 14,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showJumpToLineDialog(BuildContext context) {
    final controller = TextEditingController();
    final scheme = Theme.of(context).colorScheme;

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        scrollable: true,
        backgroundColor: scheme.surfaceContainer,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        title: Row(
          children: [
            Icon(Icons.format_list_numbered_rounded, size: 18, color: scheme.primary),
            const SizedBox(width: 8),
            Text(
              'Aller à la ligne',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: scheme.onSurface),
            ),
          ],
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: TextStyle(fontSize: 13, color: scheme.onSurface),
          decoration: InputDecoration(
            hintText: 'Numéro de ligne (ex: 42)',
            hintStyle: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            filled: true,
            fillColor: scheme.surfaceContainerHighest,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
          onSubmitted: (val) {
            final line = int.tryParse(val.trim());
            if (line != null && line > 0) {
              Navigator.of(ctx).pop();
              setState(() => _targetLineNumber = line);
            }
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () {
              final line = int.tryParse(controller.text.trim());
              if (line != null && line > 0) {
                Navigator.of(ctx).pop();
                setState(() => _targetLineNumber = line);
              }
            },
            child: const Text('Aller'),
          ),
        ],
      ),
    );
  }

  void _showFileContextMenu(BuildContext context, String fullPath, bool isDir) {
    final scheme = Theme.of(context).colorScheme;
    final fileName = fullPath.split(RegExp(r'[/\\]')).last;

    showModalBottomSheet(
      context: context,
      backgroundColor: scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: scheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Row(
                    children: [
                      Icon(isDir ? Icons.folder_rounded : Icons.description_outlined, size: 18, color: scheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          fileName,
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: scheme.onSurface),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 12),
                ListTile(
                  leading: const Icon(Icons.copy_rounded, size: 18),
                  title: const Text('Copier le chemin relatif', style: TextStyle(fontSize: 13)),
                  subtitle: Text(fullPath, style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant), overflow: TextOverflow.ellipsis),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    await Clipboard.setData(ClipboardData(text: fullPath));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Chemin relatif copié !'), duration: Duration(seconds: 1)),
                      );
                    }
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.alternate_email_rounded, size: 18),
                  title: const Text('Citer dans le chat (@fichier)', style: TextStyle(fontSize: 13)),
                  subtitle: Text('@$fullPath', style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant)),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    await Clipboard.setData(ClipboardData(text: '@$fullPath'));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Mention @fichier copiée dans le presse-papier !'), duration: Duration(seconds: 1)),
                      );
                    }
                  },
                ),
                if (!isDir)
                  ListTile(
                    leading: const Icon(Icons.share_outlined, size: 18),
                    title: const Text('Partager le fichier', style: TextStyle(fontSize: 13)),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _shareFile();
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  static List<InlineSpan> _buildHighlightedSpans(
    String text,
    String query,
    TextStyle baseStyle,
    TextStyle highlightStyle,
  ) {
    if (query.isEmpty) return [TextSpan(text: text, style: baseStyle)];
    final spans = <InlineSpan>[];
    final pattern = RegExp(RegExp.escape(query), caseSensitive: false);
    int cursor = 0;
    for (final match in pattern.allMatches(text)) {
      if (match.start > cursor) {
        spans.add(TextSpan(text: text.substring(cursor, match.start), style: baseStyle));
      }
      spans.add(TextSpan(text: text.substring(match.start, match.end), style: highlightStyle));
      cursor = match.end;
    }
    if (cursor < text.length) {
      spans.add(TextSpan(text: text.substring(cursor), style: baseStyle));
    }
    return spans;
  }

  Widget _buildSkeletonCode() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(10, (index) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Container(
            width: index % 2 == 0 ? 200 : 300,
            height: 14,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        );
      }),
    );
  }
}

class _TreeFolder extends StatelessWidget {
  final String title;
  final int depth;
  final bool isCollapsed;
  final String? searchQuery;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  const _TreeFolder({
    required this.title,
    required this.depth,
    required this.isCollapsed,
    required this.onTap,
    this.searchQuery,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final baseStyle = TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w600,
      color: scheme.onSurface,
    );
    final highlightStyle = TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w800,
      color: scheme.primary,
      backgroundColor: scheme.primary.withValues(alpha: 0.15),
    );

    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      onLongPress: onLongPress,
      borderRadius: BorderRadius.circular(4),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        padding: EdgeInsets.only(
          left: 4.0 + depth * 14,
          top: 4,
          bottom: 4,
          right: 8,
        ),
        child: Row(
          children: [
            Icon(
              isCollapsed ? Icons.chevron_right_rounded : Icons.expand_more_rounded,
              size: 16,
              color: scheme.outline,
            ),
            const SizedBox(width: 4),
            Icon(
              isCollapsed ? Icons.folder_rounded : Icons.folder_open_rounded,
              size: 15,
              color: scheme.primary.withValues(alpha: 0.85),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: searchQuery != null && searchQuery!.isNotEmpty
                  ? Text.rich(
                      TextSpan(
                        children: _WorkspaceScreenState._buildHighlightedSpans(
                          title,
                          searchQuery!,
                          baseStyle,
                          highlightStyle,
                        ),
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    )
                  : Text(
                      title,
                      style: baseStyle,
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TreeFile extends StatelessWidget {
  final String title;
  final int depth;
  final bool isSelected;
  final String? gitStatus;
  final String? searchQuery;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  const _TreeFile({
    required this.title,
    required this.depth,
    required this.onTap,
    this.isSelected = false,
    this.gitStatus,
    this.searchQuery,
    this.onLongPress,
  });

  IconData _iconForName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.dart')) return Icons.flutter_dash_outlined;
    if (lower.endsWith('.go')) return Icons.code_rounded;
    if (lower.endsWith('.json') ||
        lower.endsWith('.yaml') ||
        lower.endsWith('.yml') ||
        lower.endsWith('.toml')) {
      return Icons.settings_suggest_outlined;
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt')) {
      return Icons.article_outlined;
    }
    if (lower.endsWith('.sh') ||
        lower.endsWith('.bat') ||
        lower.endsWith('.ps1')) {
      return Icons.terminal_rounded;
    }
    if (lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.svg') ||
        lower.endsWith('.webp')) {
      return Icons.image_outlined;
    }
    return Icons.insert_drive_file_outlined;
  }

  Color _colorForName(String name, ColorScheme scheme) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.dart')) return const Color(0xFF29B6F6);
    if (lower.endsWith('.go')) return const Color(0xFF00ADD8);
    if (lower.endsWith('.json') ||
        lower.endsWith('.yaml') ||
        lower.endsWith('.yml')) {
      return const Color(0xFFEAB308);
    }
    if (lower.endsWith('.md')) return const Color(0xFFA855F7);
    if (lower.endsWith('.sh') || lower.endsWith('.bat')) {
      return const Color(0xFF22C55E);
    }
    if (lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.svg')) {
      return const Color(0xFFEC4899);
    }
    return isSelected ? scheme.primary : scheme.onSurfaceVariant;
  }

  Color _gitBadgeBgColor(String status, ColorScheme scheme) {
    switch (status.toUpperCase()) {
      case 'M':
        return AppColors.warning.withValues(alpha: 0.2);
      case '+':
      case 'A':
        return AppColors.success.withValues(alpha: 0.2);
      case '?':
        return AppColors.accent.withValues(alpha: 0.2);
      case '!':
        return AppColors.error.withValues(alpha: 0.2);
      case 'D':
        return Colors.grey.withValues(alpha: 0.2);
      default:
        return scheme.surfaceContainerHighest;
    }
  }

  Color _gitBadgeTextColor(String status, ColorScheme scheme) {
    switch (status.toUpperCase()) {
      case 'M':
        return AppColors.warning;
      case '+':
      case 'A':
        return AppColors.success;
      case '?':
        return AppColors.accent;
      case '!':
        return AppColors.error;
      case 'D':
        return Colors.grey;
      default:
        return scheme.onSurfaceVariant;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final baseStyle = TextStyle(
      fontSize: 12.5,
      color: isSelected ? scheme.onSurface : scheme.onSurfaceVariant,
      fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
    );
    final highlightStyle = TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w800,
      color: scheme.primary,
      backgroundColor: scheme.primary.withValues(alpha: 0.15),
    );

    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      onLongPress: onLongPress,
      borderRadius: BorderRadius.circular(4),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        padding: EdgeInsets.only(
          left: 4.0 + depth * 14,
          top: 4,
          bottom: 4,
          right: 8,
        ),
        decoration: BoxDecoration(
          color:
              isSelected ? scheme.surfaceContainerHighest : Colors.transparent,
          borderRadius: BorderRadius.circular(4),
          border:
              isSelected
                  ? Border.all(color: scheme.outlineVariant, width: 1)
                  : null,
        ),
        child: Row(
          children: [
            Icon(
              _iconForName(title),
              size: 14,
              color: _colorForName(title, scheme),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: searchQuery != null && searchQuery!.isNotEmpty
                  ? Text.rich(
                      TextSpan(
                        children: _WorkspaceScreenState._buildHighlightedSpans(
                          title,
                          searchQuery!,
                          baseStyle,
                          highlightStyle,
                        ),
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    )
                  : Text(
                      title,
                      style: baseStyle,
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
            ),
            if (gitStatus != null && gitStatus!.isNotEmpty) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: _gitBadgeBgColor(gitStatus!, scheme),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: Text(
                  gitStatus!,
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w700,
                    color: _gitBadgeTextColor(gitStatus!, scheme),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Résultat de recherche grep : chemin (avec ligne) + snippet du match.
class _SearchResultTile extends StatelessWidget {
  final String path;
  final int? line;
  final String snippet;
  final bool isNameMatch;
  final VoidCallback onTap;

  const _SearchResultTile({
    required this.path,
    required this.line,
    required this.snippet,
    required this.isNameMatch,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: scheme.surfaceContainer,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: scheme.outlineVariant, width: 0.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isNameMatch
                      ? Icons.folder_copy_outlined
                      : Icons.description_outlined,
                  size: 13,
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    line != null ? '$path:$line' : path,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                ),
              ],
            ),
            if (snippet.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                snippet,
                style: TextStyle(
                  fontSize: 11.5,
                  fontFamily: 'monospace',
                  color: scheme.onSurfaceVariant,
                ),
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
