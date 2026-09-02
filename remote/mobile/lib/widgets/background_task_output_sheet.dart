import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';
import '../core/protocol/daemon_api.dart';

/// Modal / BottomSheet affichant la sortie d'une tâche de fond en temps réel
/// inspiré de l'interface "Background Task Output" d'Antigravity IDE.
class BackgroundTaskOutputSheet extends StatefulWidget {
  final String taskId;
  final String command;
  final String initialOutput;
  final String status;
  final Stream<String>? outputStream;
  final VoidCallback? onStop;
  final DaemonApi? api;
  final String? cascadeId;

  const BackgroundTaskOutputSheet({
    super.key,
    required this.taskId,
    required this.command,
    this.initialOutput = '',
    this.status = 'running',
    this.outputStream,
    this.onStop,
    this.api,
    this.cascadeId,
  });

  static Future<void> show(
    BuildContext context, {
    required String taskId,
    required String command,
    String initialOutput = '',
    String status = 'running',
    Stream<String>? outputStream,
    VoidCallback? onStop,
    DaemonApi? api,
    String? cascadeId,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => BackgroundTaskOutputSheet(
        taskId: taskId,
        command: command,
        initialOutput: initialOutput,
        status: status,
        outputStream: outputStream,
        onStop: onStop,
        api: api,
        cascadeId: cascadeId,
      ),
    );
  }

  @override
  State<BackgroundTaskOutputSheet> createState() => _BackgroundTaskOutputSheetState();
}

class _BackgroundTaskOutputSheetState extends State<BackgroundTaskOutputSheet> {
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  late StringBuffer _outputBuffer;
  late String _currentStatus;
  Timer? _pollTimer;
  bool _autoScroll = true;
  bool _userScrolledUp = false;
  bool _isSearching = false;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _currentStatus = widget.status;
    _outputBuffer = StringBuffer(widget.initialOutput);
    _scrollController.addListener(_onScroll);
    _fetchLog();
    if (_currentStatus == 'running') {
      _pollTimer = Timer.periodic(const Duration(milliseconds: 1200), (_) => _fetchLog());
    }
    widget.outputStream?.listen((delta) {
      if (mounted) {
        setState(() {
          _outputBuffer.write(delta);
        });
        _maybeScrollToBottom();
      }
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    final distanceToBottom = pos.maxScrollExtent - pos.pixels;
    if (distanceToBottom > 60 && !_userScrolledUp) {
      setState(() {
        _userScrolledUp = true;
        _autoScroll = false;
      });
    } else if (distanceToBottom <= 15 && _userScrolledUp) {
      setState(() {
        _userScrolledUp = false;
        _autoScroll = true;
      });
    }
  }

  void _maybeScrollToBottom() {
    if (_autoScroll && !_userScrolledUp) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  void _resumeAutoScroll() {
    HapticFeedback.selectionClick();
    setState(() {
      _userScrolledUp = false;
      _autoScroll = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutCubic,
        );
      }
    });
  }

  Future<void> _fetchLog() async {
    if (widget.api != null && widget.cascadeId != null && widget.cascadeId!.isNotEmpty) {
      Map<String, dynamic> res = await widget.api!.getTaskLog(widget.cascadeId!, widget.taskId);
      if (res.isEmpty || res['log']?.toString().isEmpty == true) {
        if (widget.command.isNotEmpty && widget.command != widget.taskId) {
          final resAlt = await widget.api!.getTaskLog(widget.cascadeId!, widget.command);
          if (resAlt.isNotEmpty && resAlt['log']?.toString().isNotEmpty == true) {
            res = resAlt;
          }
        }
      }
      if (mounted && res.isNotEmpty) {
        final log = res['log']?.toString() ?? '';
        final st = res['status']?.toString() ?? _currentStatus;
        bool changed = false;
        if (log.isNotEmpty && log != _outputBuffer.toString()) {
          _outputBuffer.clear();
          _outputBuffer.write(log);
          changed = true;
        }
        if (st != _currentStatus) {
          _currentStatus = st;
          changed = true;
          if (_currentStatus != 'running') {
            _pollTimer?.cancel();
          }
        }
        if (changed) {
          setState(() {});
          _maybeScrollToBottom();
        }
      }
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _searchController.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isRunning = _currentStatus == 'running';
    final outputText = _outputBuffer.toString();
    final allLines = outputText.isEmpty ? <String>['(En attente de la sortie de la commande...)'] : outputText.split('\n');
    final lines = _searchQuery.isEmpty
        ? allLines
        : allLines.where((l) => l.toLowerCase().contains(_searchQuery.toLowerCase())).toList();

    final hasError = outputText.contains('exited with code 1') ||
        outputText.contains('Error:') ||
        outputText.contains('FAILED') ||
        outputText.contains('FAIL');
    final statusLabel = isRunning ? 'EN COURS' : (hasError ? 'ÉCHEC' : 'SUCCÈS');
    final statusColor = isRunning
        ? AppColors.accentBlue
        : (hasError ? AppColors.danger : AppColors.positive);

    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceBase : AppColors.surfaceInput,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          border: Border(
            top: BorderSide(color: isDark ? AppColors.borderStrong : AppColors.borderSubtle, width: 1),
          ),
        ),
        child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 8, bottom: 4),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: isDark ? AppColors.borderStrong : AppColors.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // En-tête Antigravity 2.0
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                // Tab pill avec icône terminal flexible
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: isDark ? AppColors.surfaceRaised : AppColors.surfaceBase,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(color: isDark ? AppColors.borderStrong : AppColors.borderSubtle),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.terminal_rounded, size: 14, color: AppColors.accentBlue),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            widget.command,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              fontFamily: 'monospace',
                              color: isDark ? AppColors.inkPrimary : Colors.black87,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (isRunning) ...[
                          const SizedBox(width: 8),
                          const SizedBox(
                            width: 10,
                            height: 10,
                            child: CircularProgressIndicator(
                              strokeWidth: 1.5,
                              color: AppColors.accentBlue,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 6),

                // Recherche / Filtre
                IconButton(
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: const EdgeInsets.all(6),
                  icon: Icon(_isSearching ? Icons.search_off_rounded : Icons.search_rounded, size: 16),
                  tooltip: _isSearching ? 'Fermer la recherche' : 'Rechercher dans les logs',
                  color: _isSearching ? AppColors.accentBlue : (isDark ? AppColors.inkMuted : const Color(0xFF8B949E)),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    setState(() {
                      _isSearching = !_isSearching;
                      if (!_isSearching) {
                        _searchQuery = '';
                        _searchController.clear();
                      }
                    });
                  },
                ),

                // Rafraîchir
                IconButton(
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: const EdgeInsets.all(6),
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  tooltip: 'Rafraîchir les logs',
                  color: isDark ? AppColors.inkMuted : const Color(0xFF8B949E),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    _fetchLog();
                  },
                ),

                // Copier
                IconButton(
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: const EdgeInsets.all(6),
                  icon: const Icon(Icons.copy_rounded, size: 16),
                  tooltip: 'Copier la sortie',
                  color: isDark ? AppColors.inkMuted : const Color(0xFF8B949E),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: outputText));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Sortie copiée dans le presse-papier'),
                        duration: Duration(seconds: 1),
                      ),
                    );
                  },
                ),

                // Arrêter la tâche
                if (isRunning && widget.onStop != null) ...[
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    padding: const EdgeInsets.all(6),
                    icon: const Icon(Icons.stop_circle_rounded, size: 18, color: AppColors.danger),
                    tooltip: 'Arrêter la tâche',
                    onPressed: () {
                      HapticFeedback.mediumImpact();
                      widget.onStop!();
                      Navigator.of(context).pop();
                    },
                  ),
                ],

                // Fermer
                IconButton(
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: const EdgeInsets.all(6),
                  icon: const Icon(Icons.close_rounded, size: 18),
                  tooltip: 'Fermer',
                  color: isDark ? AppColors.inkMuted : const Color(0xFF8B949E),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),

          // Barre de recherche si active
          if (_isSearching)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceRaised : Colors.white,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppColors.accentBlue.withValues(alpha: 0.5)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.search_rounded, size: 14, color: AppColors.accentBlue),
                    const SizedBox(width: 6),
                    Expanded(
                      child: TextField(
                        controller: _searchController,
                        autofocus: true,
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark ? AppColors.inkPrimary : Colors.black87,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Filtrer (error, FAIL, warning...)',
                          hintStyle: TextStyle(fontSize: 12, color: AppColors.inkMuted),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 6),
                        ),
                        onChanged: (val) {
                          setState(() {
                            _searchQuery = val.trim();
                          });
                        },
                      ),
                    ),
                    if (_searchQuery.isNotEmpty)
                      Text(
                        '${lines.length} résultat${lines.length > 1 ? 's' : ''}',
                        style: const TextStyle(fontSize: 11, color: AppColors.inkMuted),
                      ),
                  ],
                ),
              ),
            ),

          // Titre secondaire avec badge de statut
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    'Background Task Output',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: isDark ? AppColors.inkPrimary : Colors.black87,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 12, thickness: 1),

          // Zone de console terminal avec numéros de lignes et bouton Reprendre
          Expanded(
            child: Stack(
              children: [
                Container(
                  color: isDark ? AppColors.executionTerminalBg : const Color(0xFF1E1E1E),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: ListView.builder(
                    controller: _scrollController,
                    itemCount: lines.length,
                    itemBuilder: (context, index) {
                      final lineNum = index + 1;
                      final lineContent = lines[index];

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Numéro de ligne
                            SizedBox(
                              width: 38,
                              child: Text(
                                '$lineNum',
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: AppColors.inkMuted,
                                ),
                                textAlign: TextAlign.right,
                              ),
                            ),
                            const SizedBox(width: 12),
                            // Contenu de la ligne
                            Expanded(
                              child: Text(
                                lineContent,
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: AppColors.inkPrimary,
                                  height: 1.35,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
                if (_userScrolledUp)
                  Positioned(
                    bottom: 12,
                    right: 16,
                    child: GestureDetector(
                      onTap: _resumeAutoScroll,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppColors.accentBlue,
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x66000000),
                              blurRadius: 6,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.arrow_downward_rounded, size: 14, color: Colors.white),
                            SizedBox(width: 4),
                            Text(
                              'Reprendre le défilement',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
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
