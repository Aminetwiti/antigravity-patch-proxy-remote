import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/protocol/daemon_api.dart';
import '../theme/app_colors.dart';

/// Console Terminal Interactive Mobile
/// Permet d'exécuter des commandes CLI en direct sur le PC hôte via le Daemon.
class RemoteTerminalSheet extends StatefulWidget {
  final DaemonApi? api;
  final String projectName;
  final String workspacePath;

  /// Contenu pré-rempli dans la barre de saisie (bloc shell envoyé
  /// depuis un message — l'utilisateur n'a plus qu'à valider).
  final String initialCommand;

  const RemoteTerminalSheet({
    super.key,
    required this.api,
    this.projectName = 'Workspace',
    this.workspacePath = '',
    this.initialCommand = '',
  });

  static Future<void> show(
    BuildContext context, {
    DaemonApi? api,
    String projectName = 'Workspace',
    String workspacePath = '',
    String initialCommand = '',
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => RemoteTerminalSheet(
        api: api,
        projectName: projectName,
        workspacePath: workspacePath,
        initialCommand: initialCommand,
      ),
    );
  }

  @override
  State<RemoteTerminalSheet> createState() => _RemoteTerminalSheetState();
}

class _TerminalEntry {
  final String command;
  final String output;
  final bool isError;
  final DateTime timestamp;

  _TerminalEntry({
    required this.command,
    required this.output,
    this.isError = false,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

class _RemoteTerminalSheetState extends State<RemoteTerminalSheet> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<_TerminalEntry> _entries = [];
  final List<String> _history = [];
  int _historyIndex = -1;
  bool _isRunning = false;

  // État de session PTY : quand le daemon répond à terminal_create
  // avec un id, on bascule en mode "flux live" — la sortie streamée est
  // affichée dans _ptyBuffer au lieu des entrées commande→résultat.
  String? _ptyId;
  String _ptyBuffer = '';
  bool _ptyClosed = false;
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  final List<String> _quickCommands = [
    'git status',
    'git diff --stat',
    'git branch -a',
    'npm test',
    'flutter analyze',
    'ls -la',
  ];

  @override
  void initState() {
    super.initState();
    final displayPath = widget.workspacePath.isNotEmpty ? widget.workspacePath : '.';
    _entries.add(
      _TerminalEntry(
        command: 'init',
        output:
            'Antigravity Remote Terminal Bridge v3.2.0\nProjet: ${widget.projectName} ($displayPath)\nConnecté au PC hôte — prêt pour exécution.',
      ),
    );
    if (widget.initialCommand.isNotEmpty) {
      _inputController.text = widget.initialCommand;
    }
    _openPty();
  }

  /// Ouvre une session PTY interactive (terminal_create).
  /// Fallback silencieux : si le daemon ne supporte pas encore le PTY
  /// (version antérieure), on garde le mode commande→résultat existant.
  Future<void> _openPty() async {
    final api = widget.api;
    if (api == null) return;
    try {
      final ws = widget.workspacePath.isNotEmpty ? widget.workspacePath : '.';
      final res = await api.terminalCreate(ws);
      final id = (res['id'] ?? res['terminalId']) as String?;
      if (!mounted || id == null || id.isEmpty) return;
      setState(() {
        _ptyId = id;
        _ptyClosed = false;
      });
      _eventSub = api.events.listen(_onTerminalEvent);
    } catch (_) {
      // Daemon sans support PTY ou offline → on reste en mode legacy.
    }
  }

  void _onTerminalEvent(Map<String, dynamic> msg) {
    if (msg['type'] != 'terminal_output') return;

    // Extraction robuste que data soit imbriqué dans 'data' ou à plat à la racine
    final dataMap = msg['data'] is Map<String, dynamic>
        ? msg['data'] as Map<String, dynamic>
        : (msg['data'] is Map ? Map<String, dynamic>.from(msg['data'] as Map) : msg);

    final id = (dataMap['id'] ?? dataMap['terminalId'] ?? msg['id'] ?? msg['terminalId']) as String?;
    if (id != _ptyId) return;

    final data = (dataMap['data'] ?? dataMap['output'] ?? '') as String;
    final kind = (dataMap['kind'] as String?) ?? 'stdout';

    if (!mounted) return;
    setState(() {
      if (kind == 'exit') {
        _ptyClosed = true;
        _ptyBuffer += '\n[Processus shell terminé]\n';
      } else {
        _ptyBuffer += data;
      }
    });
    _scrollToBottom();
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    if (_ptyId != null && _ptyId!.isNotEmpty) {
      try {
        widget.api?.terminalKill(_ptyId!);
      } catch (_) {}
    }
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Envoie une ligne à la session PTY (terminal_write).
  Future<void> _writePty(String input) async {
    final id = _ptyId;
    final api = widget.api;
    if (id == null || id.isEmpty || api == null || _ptyClosed) return;
    try {
      await api.terminalWrite(id, input);
    } catch (_) {}
  }

  /// Point d'entrée unique de la barre de saisie : PTY si session active,
  /// sinon mode legacy commande→résultat.
  void _submitInput(String val) {
    final text = val.trimRight();
    if (text.isEmpty) return;

    _history.remove(text);
    _history.add(text);
    _historyIndex = _history.length;

    if (_ptyId != null) {
      setState(() {
        _ptyBuffer += '\$ $text\n';
        _ptyClosed = false;
      });
      _writePty('$text\n');
      _inputController.clear();
      _scrollToBottom();
      return;
    }
    _executeCommand(text);
  }

  Future<void> _executeCommand(String rawCmd) async {
    final cmd = rawCmd.trim();
    if (cmd.isEmpty) return;

    setState(() {
      _isRunning = true;
      _inputController.clear();
    });

    _scrollToBottom();

    final api = widget.api;
    if (api == null) {
      setState(() {
        _isRunning = false;
        _entries.add(
          _TerminalEntry(
            command: cmd,
            output: 'Erreur: Daemon non connecté (hors ligne).',
            isError: true,
          ),
        );
      });
      _scrollToBottom();
      return;
    }

    try {
      final res = await api.sendCommand(cmd, workspacePath: widget.workspacePath);
      String output = '';
      bool isErr = false;

      if (res['error'] != null) {
        output = res['error'].toString();
        isErr = true;
      } else if (res['data'] != null) {
        final d = res['data'];
        if (d is Map) {
          output =
              d['output']?.toString() ??
              d['stdout']?.toString() ??
              d['text']?.toString() ??
              d['result']?.toString() ??
              d.toString();
        } else {
          output = d.toString();
        }
      } else if (res['text'] != null) {
        output = res['text'].toString();
      } else {
        output = 'Commande exécutée (code 0).';
      }

      if (mounted) {
        setState(() {
          _isRunning = false;
          _entries.add(
            _TerminalEntry(command: cmd, output: output.trim(), isError: isErr),
          );
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isRunning = false;
          _entries.add(
            _TerminalEntry(
              command: cmd,
              output: 'Échec d\'exécution : $e',
              isError: true,
            ),
          );
        });
        _scrollToBottom();
      }
    }
  }

  void _scrollToBottom() {
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

  void _navigateHistory(int direction) {
    if (_history.isEmpty) return;
    _historyIndex = (_historyIndex + direction).clamp(0, _history.length - 1);
    final cmd = _history[_historyIndex];
    _inputController.text = cmd;
    _inputController.selection = TextSelection.fromPosition(
      TextPosition(offset: cmd.length),
    );
  }

  void _insertText(String text) {
    HapticFeedback.lightImpact();
    final val = _inputController.text;
    final sel = _inputController.selection;
    final start = sel.start >= 0 ? sel.start : val.length;
    final end = sel.end >= 0 ? sel.end : val.length;
    final newText = val.replaceRange(start, end, text);
    _inputController.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: start + text.length),
    );
  }

  void _clearConsole() {
    HapticFeedback.mediumImpact();
    setState(() {
      _entries.clear();
      _ptyBuffer = '';
    });
  }

  /// Console PTY live : buffer scrollable + invite en bas de flux.
  Widget _buildPtyConsole(ColorScheme scheme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: SingleChildScrollView(
            controller: _scrollController,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: SelectableText(
              _ptyBuffer.isEmpty
                  ? 'Session PTY active — tapez une commande CLI (ex: git status).\n'
                  : _ptyBuffer,
              style: const TextStyle(
                fontSize: 11.5,
                fontFamily: 'monospace',
                color: Color(0xFFE4E4E7),
                height: 1.4,
                letterSpacing: 0.2,
              ),
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
          child: Row(
            children: [
              Text(
                _ptyClosed ? '[session terminée]' : r'$ ',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  fontFamily: 'monospace',
                  color: _ptyClosed ? AppColors.inkMuted : AppColors.positive,
                ),
              ),
              if (!_ptyClosed)
                Container(
                  width: 7,
                  height: 14,
                  color: AppColors.positive.withValues(alpha: 0.8),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// Barre d'accessoires de touches CLI pour smartphone
  Widget _buildAccessoryBar(ColorScheme scheme) {
    return Container(
      height: 32,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
        border: Border(
          top: BorderSide(color: scheme.outlineVariant, width: 0.5),
          bottom: BorderSide(color: scheme.outlineVariant, width: 0.5),
        ),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        children: [
          // Ctrl-C
          _buildAccessoryKey(
            label: 'Ctrl+C',
            isAccent: true,
            onTap: () {
              HapticFeedback.mediumImpact();
              if (_ptyId != null) {
                _writePty('\x03');
              } else {
                _inputController.clear();
              }
            },
            scheme: scheme,
          ),
          // Tab
          _buildAccessoryKey(
            label: 'Tab',
            onTap: () {
              if (_ptyId != null) {
                _writePty('\t');
              } else {
                _insertText('  ');
              }
            },
            scheme: scheme,
          ),
          // Historique Up
          _buildAccessoryKey(
            icon: Icons.arrow_upward_rounded,
            onTap: () => _navigateHistory(-1),
            scheme: scheme,
          ),
          // Historique Down
          _buildAccessoryKey(
            icon: Icons.arrow_downward_rounded,
            onTap: () => _navigateHistory(1),
            scheme: scheme,
          ),
          // Symboles fréquents
          _buildAccessoryKey(
            label: '|',
            onTap: () => _insertText('|'),
            scheme: scheme,
          ),
          _buildAccessoryKey(
            label: '~',
            onTap: () => _insertText('~'),
            scheme: scheme,
          ),
          _buildAccessoryKey(
            label: '/',
            onTap: () => _insertText('/'),
            scheme: scheme,
          ),
          _buildAccessoryKey(
            label: '-',
            onTap: () => _insertText('-'),
            scheme: scheme,
          ),
          // Clear
          _buildAccessoryKey(
            label: 'Clear',
            onTap: _clearConsole,
            scheme: scheme,
          ),
        ],
      ),
    );
  }

  Widget _buildAccessoryKey({
    String? label,
    IconData? icon,
    bool isAccent = false,
    required VoidCallback onTap,
    required ColorScheme scheme,
  }) {
    final semanticLabel = label ?? (icon == Icons.arrow_upward ? 'Haut' : icon == Icons.arrow_downward ? 'Bas' : icon == Icons.arrow_back ? 'Gauche' : icon == Icons.arrow_forward ? 'Droite' : 'Touche');

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2.5, vertical: 2),
      child: Semantics(
        button: true,
        label: semanticLabel,
        child: Material(
          color: isAccent
              ? AppColors.danger.withValues(alpha: 0.15)
              : scheme.surfaceContainer,
          borderRadius: BorderRadius.circular(5),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(5),
            child: Container(
              constraints: const BoxConstraints(minWidth: 38, minHeight: 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(5),
                border: Border.all(
                  color: isAccent
                      ? AppColors.danger.withValues(alpha: 0.4)
                      : scheme.outlineVariant.withValues(alpha: 0.6),
                  width: 0.8,
                ),
              ),
              child: icon != null
                  ? Icon(
                      icon,
                      size: 14,
                      color: scheme.onSurfaceVariant,
                    )
                  : Text(
                      label ?? '',
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'monospace',
                        color: isAccent ? AppColors.danger : scheme.onSurface,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final bottomInset = mq.viewInsets.bottom;
    final bottomPadding = mq.padding.bottom;
    final scheme = Theme.of(context).colorScheme;

    // Détermination de l'état de connexion du terminal
    final bool isOffline = widget.api == null;
    final bool isPtyActive = _ptyId != null && !_ptyClosed;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.35,
      maxChildSize: 0.95,
      snap: true,
      snapSizes: const [0.35, 0.70, 0.95],
      builder: (context, scrollSheetController) {
        return Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            border: Border(
              top: BorderSide(color: scheme.outlineVariant, width: 1),
              left: BorderSide(color: scheme.outlineVariant, width: 1),
              right: BorderSide(color: scheme.outlineVariant, width: 1),
            ),
          ),
          child: Column(
            children: [
              // Drag handle tactile
              GestureDetector(
                behavior: HitTestBehavior.translucent,
                child: Container(
                  margin: const EdgeInsets.only(top: 8, bottom: 4),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: scheme.outline.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                const Icon(
                  Icons.terminal_rounded,
                  size: 18,
                  color: AppColors.positive,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Terminal — ${widget.projectName}',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: scheme.onSurface,
                                fontFamily: 'monospace',
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (widget.workspacePath.isNotEmpty)
                              Text(
                                widget.workspacePath,
                                style: TextStyle(
                                  fontSize: 10.5,
                                  color: scheme.onSurfaceVariant,
                                  fontFamily: 'monospace',
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Badge de statut
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 1.5,
                        ),
                        decoration: BoxDecoration(
                          color: isOffline
                              ? AppColors.danger.withValues(alpha: 0.15)
                              : isPtyActive
                                  ? AppColors.positive.withValues(alpha: 0.15)
                                  : AppColors.inkMuted.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(
                            color: isOffline
                                ? AppColors.danger.withValues(alpha: 0.4)
                                : isPtyActive
                                    ? AppColors.positive.withValues(alpha: 0.4)
                                    : scheme.outlineVariant,
                            width: 0.8,
                          ),
                        ),
                        child: Text(
                          isOffline
                              ? 'Hors ligne'
                              : isPtyActive
                                  ? 'PTY Live'
                                  : 'CLI',
                          style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w600,
                            fontFamily: 'monospace',
                            color: isOffline
                                ? AppColors.danger
                                : isPtyActive
                                    ? AppColors.positive
                                    : AppColors.inkMuted,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.delete_sweep_outlined,
                    size: 18,
                    color: AppColors.inkMuted,
                  ),
                  tooltip: 'Effacer l\'historique',
                  onPressed: _clearConsole,
                ),
                IconButton(
                  icon: const Icon(
                    Icons.close,
                    size: 18,
                    color: AppColors.inkMuted,
                  ),
                  tooltip: 'Fermer',
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),

          Divider(height: 1, color: scheme.outlineVariant),

          // Quick command pills
          SizedBox(
            height: 38,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              itemCount: _quickCommands.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (context, idx) {
                final cmd = _quickCommands[idx];
                return Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      _submitInput(cmd);
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainer,
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: scheme.outlineVariant,
                          width: 1,
                        ),
                      ),
                      child: Text(
                        cmd,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                          fontFamily: 'monospace',
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),

          Divider(height: 1, color: scheme.outlineVariant),

          // Console Output — en mode PTY, affiche le buffer live ; sinon
          // la liste commande→résultat existante.
          Expanded(
            child: _ptyId != null
                ? _buildPtyConsole(scheme)
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(12),
                    itemCount: _entries.length + (_isRunning ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == _entries.length && _isRunning) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation(
                                    AppColors.positive,
                                  ),
                                ),
                              ),
                              SizedBox(width: 8),
                              Text(
                                'Exécution en cours...',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: AppColors.inkMuted,
                                ),
                              ),
                            ],
                          ),
                        );
                      }

                      final entry = _entries[index];
                      return RepaintBoundary(
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (entry.command != 'init')
                                Row(
                                  children: [
                                    const Text(
                                      r'$ ',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.positive,
                                        fontFamily: 'monospace',
                                      ),
                                    ),
                                    Expanded(
                                      child: SelectableText(
                                        entry.command,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: scheme.onSurface,
                                          fontFamily: 'monospace',
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              if (entry.output.isNotEmpty) ...[
                                const SizedBox(height: 3),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: scheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(
                                      color: entry.isError
                                          ? AppColors.danger.withValues(alpha: 0.3)
                                          : scheme.outlineVariant,
                                      width: 0.8,
                                    ),
                                  ),
                                  child: SelectableText(
                                    entry.output,
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontFamily: 'monospace',
                                      color: entry.isError
                                          ? AppColors.danger
                                          : scheme.onSurfaceVariant,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),

          // Barre d'accessoires touches CLI
          _buildAccessoryBar(scheme),

          // Bottom Input bar avec prise en compte du SafeArea Android & clavier
          Container(
            padding: EdgeInsets.fromLTRB(
              10,
              8,
              10,
              bottomInset > 0 ? bottomInset + 4 : bottomPadding + 6,
            ),
            decoration: BoxDecoration(
              color: scheme.surfaceContainer,
              border: Border(
                top: BorderSide(color: scheme.outlineVariant, width: 1),
              ),
            ),
            child: Row(
              children: [
                const Text(
                  r'$ ',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: AppColors.positive,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(width: 2),
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    autofocus: false,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                      color: scheme.onSurface,
                    ),
                    decoration: InputDecoration(
                      hintText:
                          'Taper une commande (ex: git pull, npm test)...',
                      hintStyle: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant.withValues(alpha: 0.8),
                      ),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 6,
                      ),
                    ),
                    onSubmitted: (val) => _submitInput(val),
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.send_rounded,
                    size: 17,
                    color: AppColors.accentBlue,
                  ),
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    _submitInput(_inputController.text);
                  },
                  tooltip: 'Exécuter',
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
}
