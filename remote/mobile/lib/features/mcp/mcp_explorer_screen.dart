import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'models/mcp_server_info.dart';
import '../../core/protocol/daemon_api.dart';
import '../../widgets/skeleton_loader.dart';
import 'package:mobile/theme/app_colors.dart';

class McpExplorerScreen extends StatefulWidget {
  final DaemonApi? api;
  final List<McpServerInfo> servers;

  const McpExplorerScreen({super.key, this.api, this.servers = const []});

  @override
  State<McpExplorerScreen> createState() => _McpExplorerScreenState();
}

class _McpExplorerScreenState extends State<McpExplorerScreen> {
  List<McpServerInfo> _servers = [];
  bool _loading = false;
  String? _error;
  int? _expandedIndex;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _servers = widget.servers;
    if (widget.api != null) {
      _loadServers();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadServers() async {
    setState(() { _loading = true; _error = null; });
    try {
      final servers = await widget.api!.getMcpServers();
      setState(() { _servers = servers; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Erreur lors du chargement des serveurs'; _loading = false; });
    }
  }

  List<McpServerInfo> get _filteredServers {
    if (_searchQuery.isEmpty) return _servers;
    final q = _searchQuery.toLowerCase();
    return _servers.where((s) {
      if (s.name.toLowerCase().contains(q)) return true;
      if (s.description?.toLowerCase().contains(q) == true) return true;
      return s.tools.any((t) => t.toLowerCase().contains(q));
    }).toList();
  }

  void _showSidecarModal(BuildContext context, String sidecarId) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _SidecarLogsSheet(
        api: widget.api,
        sidecarId: sidecarId,
      ),
    );
  }

  void _promptInspectSidecar(BuildContext context) {
    final textController = TextEditingController();
    final scheme = Theme.of(context).colorScheme;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        scrollable: true,
        backgroundColor: scheme.surfaceContainer,
        title: Row(
          children: [
            Icon(Icons.terminal_outlined, size: 20, color: scheme.primary),
            const SizedBox(width: 8),
            const Text('Inspecter un Sidecar', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Entrez l\'identifiant du plugin ou sidecar à inspecter :',
                style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: textController,
                autofocus: true,
                style: const TextStyle(fontSize: 13),
                decoration: InputDecoration(
                  hintText: 'ex: github-mcp, filesystem, sc-1...',
                  isDense: true,
                  filled: true,
                  fillColor: scheme.surfaceContainerHighest,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () {
              final id = textController.text.trim();
              Navigator.of(ctx).pop();
              if (id.isNotEmpty) {
                _showSidecarModal(context, id);
              }
            },
            child: const Text('Inspecter'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final displayedServers = _filteredServers;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Serveurs MCP'),
        actions: [
          IconButton(
            tooltip: 'Inspecter un sidecar',
            icon: const Icon(Icons.terminal_outlined),
            onPressed: () => _promptInspectSidecar(context),
          ),
          IconButton(
            tooltip: 'Recharger la configuration MCP',
            icon: const Icon(Icons.sync),
            onPressed: () async {
              if (widget.api != null) {
                try {
                  await widget.api!.refreshMcpServers();
                  await _loadServers();
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Configuration MCP rechargée avec succès !')),
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Erreur rechargement MCP: $e')),
                    );
                  }
                }
              }
            },
          ),
        ],
      ),

      body: _loading
          ? SkeletonLoader(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (int i = 0; i < 3; i++) ...[
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(color: scheme.outlineVariant),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Row(
                            children: [
                              SkeletonLine(width: 130, height: 14),
                              Spacer(),
                              SkeletonLine(width: 50, height: 18, borderRadius: AppRadius.pill),
                            ],
                          ),
                          SizedBox(height: 10),
                          SkeletonLine(width: 220, height: 11),
                          SizedBox(height: 12),
                          Row(
                            children: [
                              SkeletonLine(width: 60, height: 16, borderRadius: AppRadius.xs),
                              SizedBox(width: 8),
                              SkeletonLine(width: 75, height: 16, borderRadius: AppRadius.xs),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadServers,
              child: Column(
                children: [
                  if (_error != null)
                    Container(
                      color: scheme.errorContainer,
                      padding: const EdgeInsets.all(8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _error!,
                              style: TextStyle(color: scheme.onErrorContainer, fontSize: 12),
                            ),
                          ),
                          TextButton(onPressed: _loadServers, child: const Text('Réessayer'))
                        ],
                      ),
                    ),
                  if (_servers.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: TextField(
                        controller: _searchController,
                        style: const TextStyle(fontSize: 13),
                        onChanged: (val) => setState(() => _searchQuery = val.trim()),
                        decoration: InputDecoration(
                          hintText: 'Rechercher un serveur ou un outil...',
                          hintStyle: TextStyle(fontSize: 12.5, color: scheme.outline),
                          prefixIcon: const Icon(Icons.search, size: 18),
                          suffixIcon: _searchQuery.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear, size: 16),
                                  onPressed: () {
                                    _searchController.clear();
                                    setState(() => _searchQuery = '');
                                  },
                                )
                              : null,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                          filled: true,
                          fillColor: scheme.surfaceContainerHighest,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.md),
                            borderSide: BorderSide(color: scheme.outlineVariant),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppRadius.md),
                            borderSide: BorderSide(color: scheme.outlineVariant),
                          ),
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Text(
                      'MCP Servers (${_servers.length})',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 0.8),
                    ),
                  ),
                  Expanded(
                    child: _servers.isEmpty
                        ? ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: const [
                              SizedBox(height: 100),
                              Center(
                                child: Text('Aucun serveur MCP configuré', style: TextStyle(fontSize: 12)),
                              ),
                            ],
                          )
                        : displayedServers.isEmpty
                            ? ListView(
                                physics: const AlwaysScrollableScrollPhysics(),
                                children: [
                                  const SizedBox(height: 80),
                                  Center(
                                    child: Column(
                                      children: [
                                        Icon(Icons.search_off, size: 36, color: scheme.outline),
                                        const SizedBox(height: 10),
                                        Text(
                                          'Aucun serveur ou outil pour « $_searchQuery »',
                                          style: TextStyle(fontSize: 12.5, color: scheme.outline),
                                        ),
                                        const SizedBox(height: 8),
                                        TextButton(
                                          onPressed: () {
                                            _searchController.clear();
                                            setState(() => _searchQuery = '');
                                          },
                                          child: const Text('Effacer la recherche', style: TextStyle(fontSize: 12)),
                                        )
                                      ],
                                    ),
                                  ),
                                ],
                              )
                            : ListView.builder(
                                physics: const AlwaysScrollableScrollPhysics(),
                                itemCount: displayedServers.length,
                                itemBuilder: (context, index) {
                                  final server = displayedServers[index];
                                  final isExpanded = _expandedIndex == index;
                              return Card(
                                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(AppRadius.md),
                                  side: BorderSide(color: scheme.outlineVariant),
                                ),
                                child: Column(
                                  children: [
                                    ListTile(
                                      title: Row(
                                        children: [
                                          Container(
                                            width: 8,
                                            height: 8,
                                            decoration: BoxDecoration(
                                              color: server.status == 'ready' || server.status == 'connected'
                                                  ? AppColors.positive
                                                  : server.status == 'connecting' || server.status == 'pending'
                                                      ? AppColors.warning
                                                      : AppColors.danger,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Flexible(
                                            child: Text(
                                              server.name,
                                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                                            decoration: BoxDecoration(
                                              color: (server.status == 'ready' || server.status == 'connected'
                                                      ? AppColors.positive
                                                      : server.status == 'connecting' || server.status == 'pending'
                                                          ? AppColors.warning
                                                          : AppColors.danger)
                                                  .withValues(alpha: 0.15),
                                              borderRadius: BorderRadius.circular(AppRadius.xs),
                                            ),
                                            child: Text(
                                              server.status.toUpperCase(),
                                              style: TextStyle(
                                                fontSize: 9.5,
                                                fontWeight: FontWeight.w700,
                                                color: server.status == 'ready' || server.status == 'connected'
                                                    ? AppColors.positive
                                                    : server.status == 'connecting' || server.status == 'pending'
                                                        ? AppColors.warning
                                                        : AppColors.danger,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: scheme.surfaceContainerHighest,
                                              borderRadius: BorderRadius.circular(AppRadius.sm),
                                            ),
                                            child: Text(
                                              '${server.toolCount} tools',
                                              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
                                            ),
                                          ),
                                        ],
                                      ),
                                      subtitle: server.description != null
                                          ? Text(server.description!, style: const TextStyle(fontSize: 11.5))
                                          : null,
                                      onTap: () => setState(() => _expandedIndex = isExpanded ? null : index),
                                    ),
                                    if (isExpanded)
                                      Padding(
                                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Wrap(
                                              spacing: 6,
                                              runSpacing: 6,
                                              children: server.tools
                                                  .map((t) => Chip(
                                                        label: Text(t, style: const TextStyle(fontSize: 11)),
                                                        padding: EdgeInsets.zero,
                                                      ))
                                                  .toList(),
                                            ),
                                            const SizedBox(height: 10),
                                            Row(
                                              children: [
                                                OutlinedButton.icon(
                                                  onPressed: () => _showSidecarModal(
                                                    context,
                                                    server.sidecarId ?? server.name,
                                                  ),
                                                  icon: const Icon(Icons.receipt_long_outlined, size: 14),
                                                  label: const Text('Logs & Contrôle Sidecar', style: TextStyle(fontSize: 11.5)),
                                                  style: OutlinedButton.styleFrom(
                                                    visualDensity: VisualDensity.compact,
                                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ],
                                        ),
                                      ),
                                  ],
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

/// Modal / Bottom sheet pour inspecter les logs et gérer un sidecar MCP
class _SidecarLogsSheet extends StatefulWidget {
  final DaemonApi? api;
  final String sidecarId;

  const _SidecarLogsSheet({
    required this.api,
    required this.sidecarId,
  });

  @override
  State<_SidecarLogsSheet> createState() => _SidecarLogsSheetState();
}

class _SidecarLogsSheetState extends State<_SidecarLogsSheet> {
  bool _loadingFiles = true;
  bool _loadingLogs = false;
  List<String> _logFiles = [];
  String? _selectedFile;
  String _logs = '';
  String? _error;
  bool _actionInProgress = false;

  @override
  void initState() {
    super.initState();
    _fetchFiles();
  }

  Future<void> _fetchFiles() async {
    if (widget.api == null) {
      setState(() {
        _loadingFiles = false;
        _logFiles = ['server.log'];
        _selectedFile = 'server.log';
        _logs = '// Aucun API Daemon connecté (mode hors-ligne)';
      });
      return;
    }
    setState(() {
      _loadingFiles = true;
      _error = null;
    });
    try {
      final files = await widget.api!.listSidecarLogFiles(widget.sidecarId);
      if (!mounted) return;
      setState(() {
        _logFiles = files.isNotEmpty ? files : ['server.log'];
        _selectedFile = _logFiles.first;
        _loadingFiles = false;
      });
      if (_selectedFile != null) {
        _fetchLogs(_selectedFile!);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Impossible de lister les logs: $e';
        _loadingFiles = false;
        _logFiles = ['server.log'];
        _selectedFile = 'server.log';
      });
    }
  }

  Future<void> _fetchLogs(String fileName) async {
    if (widget.api == null) return;
    setState(() {
      _loadingLogs = true;
      _selectedFile = fileName;
      _error = null;
    });
    try {
      final content = await widget.api!.getSidecarLogs(widget.sidecarId, fileName);
      if (!mounted) return;
      setState(() {
        _logs = content.isNotEmpty ? content : '// Aucun log disponible dans $fileName';
        _loadingLogs = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _logs = 'Erreur lors de la lecture des logs: $e';
        _loadingLogs = false;
      });
    }
  }

  Future<void> _manageAction(int action, String actionName) async {
    if (widget.api == null || _actionInProgress) return;
    setState(() => _actionInProgress = true);
    HapticFeedback.mediumImpact();
    try {
      await widget.api!.manageSidecar(widget.sidecarId, action: action);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Action $actionName envoyée au sidecar ${widget.sidecarId}'),
          duration: const Duration(seconds: 2),
        ),
      );
      // Rafraîchir les logs après une courte pause
      await Future.delayed(const Duration(milliseconds: 600));
      if (mounted && _selectedFile != null) {
        _fetchLogs(_selectedFile!);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Échec $actionName: $e')),
      );
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final maxH = MediaQuery.sizeOf(context).height * 0.82;

    return SafeArea(
      top: false,
      child: Container(
        constraints: BoxConstraints(maxHeight: maxH),
        decoration: BoxDecoration(
          color: scheme.surfaceContainer,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle & header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Row(
                children: [
                  Icon(Icons.terminal_rounded, size: 20, color: scheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Logs Sidecar : ${widget.sidecarId}',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.refresh, size: 18),
                    tooltip: 'Rafraîchir les logs',
                    onPressed: _loadingLogs ? null : () {
                      if (_selectedFile != null) _fetchLogs(_selectedFile!);
                    },
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy_all, size: 18),
                    tooltip: 'Copier les logs',
                    onPressed: _logs.isEmpty ? null : () async {
                      await Clipboard.setData(ClipboardData(text: _logs));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Logs copiés dans le presse-papier')),
                        );
                      }
                    },
                  ),
                  PopupMenuButton<int>(
                    tooltip: 'Gérer le cycle de vie',
                    enabled: !_actionInProgress,
                    icon: _actionInProgress
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.more_vert, size: 18),
                    onSelected: (action) {
                      final names = {1: 'Démarrer', 2: 'Arrêter', 3: 'Redémarrer', 4: 'Supprimer'};
                      _manageAction(action, names[action] ?? '$action');
                    },
                    itemBuilder: (ctx) => const [
                      PopupMenuItem(value: 3, child: Text('Redémarrer (restart)')),
                      PopupMenuItem(value: 1, child: Text('Démarrer (start)')),
                      PopupMenuItem(value: 2, child: Text('Arrêter (stop)')),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Text(_error!, style: TextStyle(color: scheme.error, fontSize: 11.5)),
            ),

          // Logs view
          Expanded(
            child: Container(
              margin: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: scheme.outlineVariant, width: 0.8),
              ),
              child: _loadingFiles || _loadingLogs
                  ? const Center(child: CircularProgressIndicator())
                  : SingleChildScrollView(
                      child: SelectableText(
                        _logs,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11.5,
                          height: 1.4,
                        ),
                      ),
                    ),
            ),
          ),
        ],
      ),
    ),
    );
  }
}
