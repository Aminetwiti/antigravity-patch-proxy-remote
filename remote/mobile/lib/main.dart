import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'config/env_config.dart';
import 'core/network/outbox.dart';
import 'core/network/websocket_client.dart';
import 'core/notifications/approval_notifier.dart';
import 'core/protocol/daemon_api.dart';
import 'core/protocol/messages.dart';
import 'core/protocol/session_parser.dart';
import 'core/protocol/workspace_path.dart';
import 'features/chat_stream/chat_stream_screen.dart';
import 'features/discovery/discovery_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/workspace/workspace_screen.dart';
import 'theme/app_theme.dart';
import 'features/sessions/sessions_list.dart';
import 'features/sessions/conversation_history_screen.dart';
import 'features/scheduled_tasks/scheduled_tasks_screen.dart';
import 'features/battle_arena/battle_arena_screen.dart';
import 'features/sidecars/sidecars_dashboard_screen.dart';
import 'services/settings_store.dart';
import 'widgets/remote_terminal_sheet.dart';
import 'widgets/right_sidebar_drawer.dart';

void main() {
  FlutterError.onError = (FlutterErrorDetails details) {
    debugPrint('FLUTTER_ERROR: ${details.exceptionAsString()}');
    debugPrint('STACK_TRACE: ${details.stack}');
    FlutterError.presentError(details);
  };
  ErrorWidget.builder = (FlutterErrorDetails details) {
    return Material(
      color: Colors.transparent,
      child: Container(
        color: const Color(0xFF1E1E24), // Fallback dark surface
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            const Text(
              'Erreur de rendu UI',
              style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              details.exceptionAsString(),
              style: const TextStyle(color: Colors.white70, fontSize: 12),
              textAlign: TextAlign.center,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  };
  runApp(const AntigravityRemoteApp());
}

class AntigravityRemoteApp extends StatefulWidget {
  const AntigravityRemoteApp({super.key});

  @override
  State<AntigravityRemoteApp> createState() => _AntigravityRemoteAppState();
}

class _AntigravityRemoteAppState extends State<AntigravityRemoteApp> {
  int _themeModeIndex = 2; // 0: system, 1: light, 2: dark — AG2.0 dark-first

  @override
  void initState() {
    super.initState();
    _loadTheme();
  }

  Future<void> _loadTheme() async {
    try {
      final s = await SettingsStore.load();
      if (!mounted) return;
      setState(() => _themeModeIndex = (s['themeMode'] as int?) ?? 2);
    } catch (_) {
      // Tests sans mock SharedPreferences : thème système par défaut.
    }
  }

  @override
  Widget build(BuildContext context) {
    final idx = (_themeModeIndex >= 0 && _themeModeIndex < 3) ? _themeModeIndex : 0;
    return MaterialApp(
      title: 'Antigravity Mobile',
      debugShowCheckedModeBanner: false,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Feature #6 : respecter les préférences système (clair/sombre) au lieu
      // de forcer le dark mode. ThemeMode.system délègue à MediaQuery.
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.values[idx],
      home: AntigravityMainScreen(
        themeModeIndex: idx,
        onThemeModeChanged: (i) => setState(() => _themeModeIndex = i),
      ),
    );
  }
}

class AntigravityMainScreen extends StatefulWidget {
  const AntigravityMainScreen({
    super.key,
    this.themeModeIndex = 0,
    required this.onThemeModeChanged,
  });

  final int themeModeIndex;
  final ValueChanged<int> onThemeModeChanged;

  @override
  State<AntigravityMainScreen> createState() => _AntigravityMainScreenState();
}

class _AntigravityMainScreenState extends State<AntigravityMainScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final DaemonWebSocketClient _wsClient = DaemonWebSocketClient();

  String _activeSessionId = '';
  String _activeSessionTitle = '';

  DaemonApi? _api;
  Map<String, dynamic> _contextStats = {};

  final OutboxQueue _outbox = OutboxQueue();

  List<CascadeSession> _sessions = const [];
  List<ProjectItem> _projects = const [];
  bool _isIdeConnected = true;
  bool _activeSessionIsArchived = false;
  // Bug #15 : guard pour éviter le double fetch concurrent de sessions.
  bool _sessionsFetching = false;
  int _lastStateVersion = 0;
  // P3 : timestamp de la dernière sync sessions réussie (push ou poll) —
  // permet au timer de polling de se mettre en veille quand le push est actif.
  DateTime? _lastSessionsSyncAt;

  /// Garde-fou anti-fantôme : quand la session active disparaît des listes
  /// daemon (archivée/supprimée depuis l'IDE desktop), on la préserve
  /// temporairement — une session flambant neuve peut mettre ~10 s à
  /// apparaître dans les résumés du Language Server — puis on honore
  /// l'exclusion définitive du daemon.
  DateTime? _activeMissingSince;
  bool get _activeGhostExpired =>
      _activeMissingSince != null &&
      DateTime.now().difference(_activeMissingSince!) >
          const Duration(seconds: 45);

  ConnectionStatus _prevStatus = ConnectionStatus.disconnected;

  Map<String, dynamic> _savedSettings = const {};
  StreamSubscription<Map<String, dynamic>>? _notifTapSub;
  Timer? _sessionsPollTimer;

  @override
  void initState() {
    super.initState();
    _prevStatus = _wsClient.statusNotifier.value;
    _wsClient.statusNotifier.addListener(_onStatusChanged);
    // Sauvegarde la session à chaque connexion réussie : URL ws complète + token
    // (le tunnel Cloudflare change d'URL à chaque redémarrage du daemon).
    _wsClient.onSessionEstablished = (url, token) {
      SettingsStore.saveSession(wsUrl: url, token: token, sessionId: _activeSessionId);
    };
    // Token rejeté : affiche le statut erreur pour inviter à scanner le QR ou saisir le PIN.
    _wsClient.onAuthRejected = () async {
      // Pas de boucle infinie : l'utilisateur peut entrer le PIN ou scanner le QR.
    };
    _wsClient.onEndpointDead = () async {
      _connectWithSavedSettings();
    };
    ApprovalNotifier.instance.init();
    _notifTapSub = ApprovalNotifier.instance.taps.listen((tap) {
      final cascadeId = tap['cascadeId'] as String? ?? '';
      if (cascadeId.isNotEmpty && mounted) {
        setState(() {
          _activeSessionId = cascadeId;
          final s = _sessions.firstWhere(
            (e) => e.id == cascadeId,
            orElse: () => CascadeSession(
              id: cascadeId,
              title: 'Session',
              workspacePath: '',
              status: 'CASCADE_STATUS_READY',
              time: '',
            ),
          );
          _activeSessionTitle = s.title;
        });
        _refreshContext();
      }
    });
    // Restaure la dernière session active (si encore valide) sans attendre
    // la liste distante — l'UI affiche immédiatement le bon contexte.
    SettingsStore.loadSession().then((s) {
      if (!mounted || s.isEmpty) return;
      final sid = s['sessionId'] as String? ?? '';
      if (sid.isNotEmpty) {
        setState(() => _activeSessionId = sid);
      }
    });
    // Auto-connexion : session persistée < 24 h en priorité (reconnexion
    // directe au tunnel), sinon réglages host/port/ssl/token, sinon repli sur
    // la config d'environnement. `adb reverse tcp:8090` + jeton par défaut
    // restent le chemin dev.
    // ponytail: plafond connu — la session expire après 24 h; le QR /
    // discovery reste le chemin de re-appairage.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _connectWithSavedSettings();
    });
  }

  Future<void> _connectWithSavedSettings() async {
    try {
      // Priorité 1 : session < 24 h → reconnexion directe au tunnel
      // sauvegardé (URL Cloudflare complète + token), sans re-scan QR.
      final session = await SettingsStore.loadSession();
      if (mounted && session.isNotEmpty) {
        final url = session['wsUrl'] as String? ?? '';
        final token = session['token'] as String? ?? '';
        if (url.isNotEmpty) {
          _wsClient.connect(
            customUrl: url,
            authToken: token.isNotEmpty ? token : EnvConfig.authToken,
          );
          return;
        }
      }
      // Priorité 2 : réglages persistés (host/port/ssl/token).
      final s = await SettingsStore.load();
      if (!mounted) return;
      _savedSettings = s;
      final host = (s['host'] as String?)?.trim() ?? '';
      final port = (s['port'] as int?) ?? EnvConfig.daemonPort;
      final ssl = (s['ssl'] as bool?) ?? false;
      final csrf = (s['csrf'] as String?)?.trim() ?? '';
      if (host.isEmpty) {
        _wsClient.connect(authToken: EnvConfig.authToken);
        return;
      }
      final url = '${ssl ? 'wss' : 'ws'}://$host:$port/ws';
      _wsClient.connect(
        customUrl: url,
        authToken: csrf.isNotEmpty ? csrf : EnvConfig.authToken,
      );
    } catch (_) {
      // Tests sans mock SharedPreferences : repli sur la config par défaut.
      if (mounted) _wsClient.connect(authToken: EnvConfig.authToken);
    }
  }

  static String _formatWsUrl(String host, int port) {
    final cleanHost = host.trim();
    if (cleanHost.startsWith('ws://') || cleanHost.startsWith('wss://')) {
      return cleanHost.endsWith('/ws') ? cleanHost : '$cleanHost/ws';
    }
    if (cleanHost.startsWith('https://')) {
      final bare = cleanHost.substring('https://'.length);
      return 'wss://$bare/ws';
    }
    if (cleanHost.startsWith('http://')) {
      final bare = cleanHost.substring('http://'.length);
      return 'ws://$bare/ws';
    }
    if (port == 443 || cleanHost.contains('trycloudflare.com') || cleanHost.contains('pinggy')) {
      return 'wss://$cleanHost/ws';
    }
    return 'ws://$cleanHost:$port/ws';
  }

  /// Applique les réglages daemon sauvegardés depuis Settings : reconnexion
  /// immédiate sur la nouvelle cible.
  void _applyDaemonSettings(Map<String, dynamic> v) {
    setState(() => _savedSettings = v);
    final host = (v['host'] as String?)?.trim() ?? '';
    final port = (v['port'] as int?) ?? EnvConfig.daemonPort;
    final ssl = (v['ssl'] as bool?) ?? false;
    final csrf = (v['csrf'] as String?)?.trim() ?? '';
    final url = '${ssl ? 'wss' : 'ws'}://$host:$port/ws';
    _wsClient.disconnect();
    _wsClient.connect(
      customUrl: url,
      authToken: csrf.isNotEmpty ? csrf : EnvConfig.authToken,
    );
  }

  void _onStatusChanged() {
    if (!mounted) return;
    
    final currentStatus = _wsClient.statusNotifier.value;
    if (_prevStatus != currentStatus) {
      if (currentStatus == ConnectionStatus.disconnected || currentStatus == ConnectionStatus.error) {
        HapticFeedback.heavyImpact();
      } else if (currentStatus == ConnectionStatus.connected) {
        HapticFeedback.lightImpact();
      }
      _prevStatus = currentStatus;
    }

    setState(() {});
    if (currentStatus == ConnectionStatus.connected) {
      // Persiste la session (URL tunnel + token + sessionId) : le tunnel
      // Cloudflare change d'URL à chaque redémarrage du daemon, on re-sauvegarde
      // donc à chaque connexion réussie, y compris les reconnexions.
      SettingsStore.saveSession(
        wsUrl: _wsClient.targetUrl,
        token: _wsClient.authToken ?? '',
        sessionId: _activeSessionId,
      );
      _api?.dispose();
      _api = DaemonApi(
        incoming: _wsClient.stream,
        send: _wsClient.send,
        outbox: _outbox,
      );
      _api!.attachReconnect(
        _wsClient.reconnectVersion,
        _resyncSessions,
        onCatchup: () async {
          if (_api == null) return;
          final sessionsToSync = <String>{};
          if (_activeSessionId.isNotEmpty) sessionsToSync.add(_activeSessionId);
          for (final s in _sessions) {
            if (s.status == 'CASCADE_STATUS_RUNNING' || s.status == 'CASCADE_STATUS_WAITING_USER') {
              sessionsToSync.add(s.id);
            }
          }
          for (final cid in sessionsToSync) {
            final lastStep = _api!.getLastStepIndex(cid);
            try {
              await _api!.syncSession(
                cascadeId: cid,
                lastStepIndex: lastStep,
              );
            } catch (_) {}
          }
        },
      );
      _watchSessionEvents();
      _refreshSessions();
      _refreshContext();
      _applySavedApprovalSettings();
      _autoDockActiveSession();
      _sessionsPollTimer?.cancel();
      _sessionsPollTimer = Timer.periodic(const Duration(seconds: 15), (_) {
        if (mounted && _wsClient.statusNotifier.value == ConnectionStatus.connected) {
          // P3 : filet de sécurité, pas une source primaire — le daemon pousse
          // déjà `sessions_updated`. On saute le poll si une sync (push ou
          // refresh manuel) a eu lieu il y a moins de 12 s pour éviter le
          // double-chargement réseau + re-parse de la liste complète.
          final lastSync = _lastSessionsSyncAt;
          if (lastSync != null &&
              DateTime.now().difference(lastSync) < const Duration(seconds: 12)) {
            return;
          }
          _refreshSessions();
        }
      });
    } else {
      _sessionsPollTimer?.cancel();
      _sessionsPollTimer = null;
    }
  }

  /// Arrimage initial : au connect, synchronise l'application mobile sur la
  /// session active de l'IDE PC UNIQUEMENT si aucune session n'est encore
  /// active/sélectionnée sur le mobile. Si une session est déjà active,
  /// elle ne doit JAMAIS être écrasée (Règle fondamentale).
  Future<void> _autoDockActiveSession() async {
    final api = _api;
    if (api == null) return;
    try {
      if (_activeSessionId.isNotEmpty) return;
      final active = await api.getActiveSession();
      if (active != null && mounted && _activeSessionId.isEmpty) {
        final cid = active['cascadeId'] as String? ?? '';
        final title = active['title'] as String? ?? '';
        if (cid.isNotEmpty) {
          setState(() {
            _activeSessionId = cid;
            if (title.isNotEmpty) _activeSessionTitle = title;
          });
          _refreshContext();
          SettingsStore.saveSession(
            wsUrl: _wsClient.targetUrl,
            token: _wsClient.authToken ?? '',
            sessionId: _activeSessionId,
          );
        }
      }
    } catch (_) {}
  }

  /// Re-synchronise les réglages d'approbation persistés vers le daemon à
  /// chaque (re)connexion : le daemon ne persiste rien, il faut donc lui
  /// ré-appliquer le délai d'auto-refus et l'auto-accept read-only après un
  /// redémarrage (du daemon ou de l'app).
  Future<void> _applySavedApprovalSettings() async {
    final api = _api;
    if (api == null) return;
    try {
      final s = await SettingsStore.load();
      final timeout = (s['approvalTimeoutMinutes'] as int?) ?? 5;
      await api.sendWithResult('set_approval_timeout', {
        'data': {'minutes': timeout},
      });
      final autoAccept = (s['autoAcceptEnabled'] as bool?) ?? false;
      final mode = (s['autoAcceptMode'] as String?) ?? 'readonly';
      await api.setAutoAccept(enabled: autoAccept, mode: mode);
    } catch (_) {
      // Réglages décoratifs : sans daemon, on ignore silencieusement.
    }
  }

  Future<void> _refreshContext() async {
    final api = _api;
    if (api == null) return;
    try {
      final activeWs = _sessions
              .where((s) => s.id == _activeSessionId)
              .map((s) => s.workspacePath)
              .firstWhere((p) => p.isNotEmpty, orElse: () => '')
          .isNotEmpty
          ? _sessions
              .where((s) => s.id == _activeSessionId)
              .first
              .workspacePath
          : (_projects.isNotEmpty ? _projects.first.path : '');

      final stats = await api.getContext(
        cascadeId: _activeSessionId,
        workspacePath: activeWs,
      );
      if (mounted) {
        setState(() {
          _contextStats = stats;
        });
      }
    } catch (e) {
      // C3 (audit clean-code-guard) : silencieux auparavant — le contexte
      // (compteurs sidebar droite) est décoratif, on logge sans alerter.
      debugPrint('refreshContext failed: $e');
    }
  }

  bool _isCreatingSession = false;

  /// Crée une nouvelle conversation (bouton « + » de la barre latérale ET des
  /// onglets de session) puis bascule dessus. Workflow partagé entre
  /// LeftSidebarDrawer et ChatStreamScreen.
  Future<void> _createNewConversation([ProjectItem? targetProject]) async {
    if (_isCreatingSession) return;
    _isCreatingSession = true;
    final api = _api;
    if (api == null) {
      _isCreatingSession = false;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)?.notConnectedToDaemon ?? '⚠️ Non connecté au serveur daemon'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
      return;
    }
    try {
      HapticFeedback.lightImpact();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                ),
                SizedBox(width: 12),
                Text(AppLocalizations.of(context)?.creatingNewConversation ?? 'Création de la nouvelle conversation...'),
              ],
            ),
            duration: const Duration(milliseconds: 1500),
          ),
        );
      }
      var ws = targetProject?.path ?? '';
      if (ws.isEmpty && targetProject != null) {
        ws = targetProject.folderUri.isNotEmpty ? targetProject.folderUri : targetProject.name;
      }
      var projId = targetProject?.id ?? '';

      // Si aucun projet/workspace cible n'est spécifié (bouton général), utiliser le workspace actif courant
      if (ws.isEmpty) {
        if (_activeSessionId.isNotEmpty) {
          final cur = _sessions.where((s) => s.id == _activeSessionId);
          if (cur.isNotEmpty && cur.first.workspacePath.isNotEmpty) {
            ws = cur.first.workspacePath;
            projId = cur.first.projectId ?? '';
          }
        }
        if (ws.isEmpty) {
          if (_projects.isNotEmpty) {
            ws = _projects.first.path.isNotEmpty ? _projects.first.path : _projects.first.folderUri;
            projId = _projects.first.id;
          } else if (_sessions.isNotEmpty) {
            ws = _sessions.first.workspacePath;
            projId = _sessions.first.projectId ?? '';
          }
        }
      }
      if (projId.isEmpty && ws.isNotEmpty && _projects.isNotEmpty) {
        for (final p in _projects) {
          if (p.id.isNotEmpty && (p.path == ws || p.folderUri == ws || WorkspacePath.isSameWorkspace(p.path, ws) || WorkspacePath.isSameWorkspace(p.folderUri, ws))) {
            projId = p.id;
            break;
          }
        }
      }
      final res = await api.createCascade(ws, projectId: projId);
      final data = (res['data'] is Map<String, dynamic>)
          ? (res['data'] as Map<String, dynamic>)
          : (res['data'] is Map ? Map<String, dynamic>.from(res['data'] as Map) : res);

      String newId = '';
      if (data['cascadeId'] is String && (data['cascadeId'] as String).isNotEmpty) {
        newId = data['cascadeId'] as String;
      } else if (data['id'] is String && (data['id'] as String).isNotEmpty) {
        newId = data['id'] as String;
      } else if (data['fields'] is List) {
        for (final f in data['fields']) {
          if (f is Map && f['text'] is String && (f['text'] as String).isNotEmpty) {
            newId = f['text'] as String;
            break;
          }
        }
      }
      if (newId.isEmpty) {
        newId = 'cascade-${DateTime.now().millisecondsSinceEpoch}';
      }

      if (mounted) {
        final newSession = CascadeSession(
          id: newId,
          workspacePath: ws,
          title: 'Nouvelle conversation',
          status: 'CASCADE_STATUS_READY',
          time: 'Maintenant',
          projectId: projId,
        );
        setState(() {
          _activeSessionId = newId;
          _activeSessionTitle = 'Nouvelle conversation';
          _sessions = [newSession, ..._sessions.where((s) => s.id != newId)];
          _contextStats = {};
        });
        SettingsStore.saveSession(
          wsUrl: _wsClient.targetUrl,
          token: _wsClient.authToken ?? '',
          sessionId: newId,
        );
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)?.newConversationOpened(newId) ?? '✨ Nouvelle conversation ouverte ($newId)'),
            backgroundColor: const Color(0xFF1E88E5),
            duration: const Duration(seconds: 2),
          ),
        );
        await _refreshContext();
      }
    } catch (e) {
      debugPrint('createCascade failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)?.failedToCreateSession(e.toString()) ?? '❌ Échec création session: $e'),
            backgroundColor: Colors.red.shade800,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } finally {
      _isCreatingSession = false;
    }
  }

  Future<void> _refreshSessions() async {
    // Bug #15 : évite le double appel concurrent (connexion + reconnectVersion).
    if (_sessionsFetching) return;
    _sessionsFetching = true;
    final api = _api;
    if (api == null) { _sessionsFetching = false; return; }
    try {
      final data = await api.listSessions();
      final version = (data['version'] as num?)?.toInt() ?? 0;
      if (version > 0 && version < _lastStateVersion) {
        // Réponse plus ancienne qu'un push plus récent — ignorer pour éviter la régression
        return;
      }
      if (version > 0) {
        _lastStateVersion = version;
      }

      final sessions = await SessionParser.parseListSessionsAsync(data);

      List<ProjectItem> projects = [];
      if (data['projects'] is List) {
        projects = (data['projects'] as List)
            .whereType<Map>()
            .map((p) => ProjectItem.fromJson(Map<String, dynamic>.from(p)))
            .toList();
      }

      if (mounted) {
        setState(() {
          if (projects.isNotEmpty) {
            _projects = projects;
          }
          if (sessions.isNotEmpty) {
            final stillActive = sessions.any((s) => s.id == _activeSessionId);
            if (_activeSessionId.isNotEmpty && stillActive) {
              _activeMissingSince = null;
              _sessions = sessions;
              final cur = sessions.firstWhere((s) => s.id == _activeSessionId);
              _activeSessionTitle = cur.title.isNotEmpty
                  ? cur.title
                  : (_activeSessionTitle.isNotEmpty ? _activeSessionTitle : 'Nouvelle conversation');
            } else if (_activeSessionId.isNotEmpty && !_activeGhostExpired) {
              _activeMissingSince ??= DateTime.now();
              // Préserve la session active en tête de liste si c'est une nouvelle session
              final existingPending = _sessions.where((s) => s.id == _activeSessionId);
              final activeItem = existingPending.isNotEmpty
                  ? existingPending.first
                  : CascadeSession(
                      id: _activeSessionId,
                      workspacePath: _projects.isNotEmpty ? _projects.first.path : '',
                      title: _activeSessionTitle.isNotEmpty ? _activeSessionTitle : 'Nouvelle conversation',
                      status: 'CASCADE_STATUS_READY',
                      time: 'Maintenant',
                    );
              _sessions = [activeItem, ...sessions.where((s) => s.id != _activeSessionId)];
            } else {
              _activeMissingSince = null;
              _sessions = sessions;
              _activeSessionId = sessions.first.id;
              _activeSessionTitle = sessions.first.title;
            }
          } else if (_activeSessionId.isNotEmpty) {
            final existingPending = _sessions.where((s) => s.id == _activeSessionId);
            if (existingPending.isNotEmpty) {
              _sessions = [existingPending.first];
            }
          } else {
            _sessions = const [];
            _activeSessionId = '';
            _activeSessionTitle = 'Nouvelle conversation';
          }
          _lastSessionsSyncAt = DateTime.now();
        });
        if (_activeSessionId.isNotEmpty) {
          SettingsStore.saveSession(
            wsUrl: _wsClient.targetUrl,
            token: _wsClient.authToken ?? '',
            sessionId: _activeSessionId,
          );
        }
      }
    } catch (_) {
    } finally {
      _sessionsFetching = false;
    }
  }

  /// Rafraîchit la liste des sessions à chaque événement daemon (stream_end,
  /// approval_expired, …) pour que le sidebar reste synchronisé en direct.
  /// ponytail: rafraîchissement plein — pas de delta — plafond acceptable pour
  /// un volume faible de sessions ; à affiner si le daemon émet > 5 events/s.
  StreamSubscription<Map<String, dynamic>>? _sessionsSub;

  void _watchSessionEvents() {
    _sessionsSub?.cancel();
    _sessionsSub = _api?.events.listen((msg) async {
      if (!mounted) return;
      final type = msg['type'] as String?;
      final cascadeId = (msg['cascadeId'] ?? msg['data']?['cascadeId']) as String? ?? '';

      if (type == 'stream_start') {
        if (cascadeId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cascadeId) {
                return s.copyWith(status: 'CASCADE_STATUS_RUNNING');
              }
              return s;
            }).toList();
          });
        }
        return;
      }

      if (type == 'approval_pending' || type == 'approval_required') {
        if (cascadeId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cascadeId) {
                return s.copyWith(status: 'CASCADE_STATUS_WAITING_FOR_USER_ACTION');
              }
              return s;
            }).toList();
          });
        }
        return;
      }

      if (type == 'approval_expired' || type == 'approval_resolved') {
        if (cascadeId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cascadeId) {
                return s.copyWith(status: 'CASCADE_STATUS_READY');
              }
              return s;
            }).toList();
          });
        }
        return;
      }

      if (type == 'stream_error') {
        if (cascadeId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cascadeId) {
                return s.copyWith(status: 'CASCADE_STATUS_ERROR');
              }
              return s;
            }).toList();
          });
        }
        return;
      }

      if (type == 'stream_end') {
        if (cascadeId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cascadeId) {
                return s.copyWith(
                  status: 'CASCADE_STATUS_READY',
                  hasUnread: cascadeId != _activeSessionId,
                );
              }
              return s;
            }).toList();
          });
        }
        _refreshSessions();
        return;
      }

      if (type == 'session_status_update') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final status = (data['status'] ?? '').toString();
        final cid = (msg['cascadeId'] ?? data['cascadeId'] ?? cascadeId).toString();
        if (cid.isNotEmpty && status.isNotEmpty) {
          setState(() {
            _sessions = _sessions.map((s) {
              if (s.id == cid) {
                return s.copyWith(status: status);
              }
              return s;
            }).toList();
          });
        }
        return;
      }

      // session_focus_changed : un événement distant ne doit JAMAIS changer
      // automatiquement la session active de l'UI Flutter (Règle fondamentale).
      // On met à jour les métadonnées de la session dans _sessions si présente,
      // sans toucher à _activeSessionId.
      if (type == 'session_focus_changed') {
        final data = msg['data'];
        if (data is Map) {
          final cid = (data['cascadeId'] ?? data['focusedCascadeId']) as String? ?? '';
          final title = data['title'] as String? ?? '';
          if (cid.isNotEmpty && title.isNotEmpty) {
            setState(() {
              _sessions = _sessions.map((s) {
                if (s.id == cid) {
                  return s.copyWith(title: title);
                }
                return s;
              }).toList();
            });
          }
        }
        return;
      }

      if (type == 'session_deleted') {
        final deletedId = msg['cascadeId'] as String? ?? (msg['data'] is Map ? msg['data']['cascadeId']?.toString() : null);
        if (deletedId != null && deletedId.isNotEmpty) {
          setState(() {
            _sessions = _sessions.where((s) => s.id != deletedId).toList();
            if (_activeSessionId == deletedId) {
              if (_sessions.isNotEmpty) {
                _activeSessionId = _sessions.first.id;
                _activeSessionTitle = _sessions.first.title;
              } else {
                _activeSessionId = '';
                _activeSessionTitle = 'Nouvelle conversation';
              }
              _refreshContext();
            }
          });
        }
        return;
      }

      // sessions_updated : push réactif du daemon (flux Jetbox) — payload
      // complet au format list_sessions. Évite le rechargement réseau complet
      // (et la latence GetAllCascades) ; met à jour la sidebar en place
      // SANS changer la session active sélectionnée dans l'UI.
      if (type == 'sessions_updated') {
        final data = msg['data'];
        if (data is Map) {
          final dataMap = Map<String, dynamic>.from(data);
          final version = (dataMap['version'] as num?)?.toInt() ?? 0;
          if (version > 0 && version < _lastStateVersion) {
            // Événement obsolète arrivé dans le désordre — ignorer
            return;
          }
          if (version > 0) {
            _lastStateVersion = version;
          }

          List<ProjectItem> projects = [];
          if (dataMap['projects'] is List) {
            projects = (dataMap['projects'] as List)
                .whereType<Map>()
                .map((p) => ProjectItem.fromJson(Map<String, dynamic>.from(p)))
                .toList();
          }

          final parsed = await SessionParser.parseListSessionsAsync(dataMap);

          setState(() {
            if (projects.isNotEmpty) {
              _projects = projects;
            }
            if (parsed.isNotEmpty) {
              final stillActive = parsed.any((s) => s.id == _activeSessionId);
              if (_activeSessionId.isNotEmpty && stillActive) {
                _activeMissingSince = null;
                _sessions = parsed;
                final current = parsed.firstWhere((s) => s.id == _activeSessionId);
                _activeSessionTitle = current.title.isNotEmpty
                    ? current.title
                    : (_activeSessionTitle.isNotEmpty ? _activeSessionTitle : 'Nouvelle conversation');
              } else if (_activeSessionId.isNotEmpty && !_activeGhostExpired) {
                _activeMissingSince ??= DateTime.now();
                // Préserve la session active en tête de liste si c'est une nouvelle session
                // qui n'est pas encore synchronisée dans les résumés distants
                final existingPending = _sessions.where((s) => s.id == _activeSessionId);
                final activeItem = existingPending.isNotEmpty
                    ? existingPending.first
                    : CascadeSession(
                        id: _activeSessionId,
                        workspacePath: _projects.isNotEmpty ? _projects.first.path : '',
                        title: _activeSessionTitle.isNotEmpty ? _activeSessionTitle : 'Nouvelle conversation',
                        status: 'CASCADE_STATUS_READY',
                        time: 'Maintenant',
                      );
                _sessions = [activeItem, ...parsed.where((s) => s.id != _activeSessionId)];
              } else {
                _activeMissingSince = null;
                _sessions = parsed;
                _activeSessionId = parsed.first.id;
                _activeSessionTitle = parsed.first.title;
                _refreshContext();
              }
            } else if (_activeSessionId.isNotEmpty) {
              final existingPending = _sessions.where((s) => s.id == _activeSessionId);
              if (existingPending.isNotEmpty) {
                _sessions = [existingPending.first];
              }
            } else {
              // Liste vide : toutes les sessions ont été supprimées/archivées
              _sessions = const [];
              _activeSessionId = '';
              _activeSessionTitle = 'Nouvelle conversation';
              _contextStats = {};
            }
            _lastSessionsSyncAt = DateTime.now();
          });
          return;
        }
        return;
      }

      if (type == 'ide_status') {
        final data = msg['data'];
        if (data is Map) {
          final running = data['running'] == true;
          if (_isIdeConnected != running) {
            setState(() {
              _isIdeConnected = running;
            });
          }
        }
        return;
      }
    });
  }

  Future<Map<String, dynamic>> _resyncSessions() async {
    final api = _api;
    if (api == null) return const {};
    try {
      await _refreshSessions();
      return const {'ok': true};
    } catch (_) {
      return const {};
    }
  }

  void _showSessionHistory() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ConversationHistoryScreen(
          api: _api,
          sessions: _sessions,
          projects: _projects,
          activeSessionId: _activeSessionId,
          onRefresh: _refreshSessions,
          onRestoreSession: _restoreSession,
          onSessionSelected: (id) async {
            CascadeSession? target;
            final existing = _sessions.where((s) => s.id == id);
            if (existing.isNotEmpty) {
              target = existing.first;
            } else {
              try {
                final allRes = await _api?.listAllSessions();
                if (allRes != null) {
                  final parsed = SessionParser.parseListSessions(allRes, includeArchived: true);
                  final match = parsed.where((s) => s.id == id);
                  if (match.isNotEmpty) target = match.first;
                }
              } catch (_) {}
            }
            final isArchived = target?.isArchived == true || target?.status == 'CASCADE_STATUS_ARCHIVED';
            setState(() {
              _activeSessionId = id;
              _activeSessionIsArchived = isArchived;
              _activeMissingSince = null;
              _contextStats = {};
              if (target != null) {
                _activeSessionTitle = target.title;
              }
            });
            _refreshContext();
            SettingsStore.saveSession(
              wsUrl: _wsClient.targetUrl,
              token: _wsClient.authToken ?? '',
              sessionId: id,
            );
          },
          onDeleteSession: _deleteSession,
        ),
      ),
    );
  }

  Future<void> _restoreSession(String id) async {
    final api = _api;
    if (api == null) return;
    try {
      await api.unarchiveCascade(id);
      if (mounted) {
        setState(() {
          if (_activeSessionId == id) {
            _activeSessionIsArchived = false;
          }
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Conversation restaurée'),
            duration: Duration(seconds: 2),
          ),
        );
      }
      await _refreshSessions();
      if (_activeSessionId == id) {
        await _refreshContext();
      }
    } catch (e) {
      debugPrint('Failed to unarchive cascade: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erreur lors de la restauration: $e'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  Future<void> _deleteSession(String id) async {
    final api = _api;
    if (api == null) return;
    try {
      final wasActive = (id == _activeSessionId);
      if (mounted) {
        setState(() {
          _sessions = _sessions.where((s) => s.id != id).toList();
          if (wasActive) {
            if (_sessions.isNotEmpty) {
              _activeSessionId = _sessions.first.id;
              _activeSessionTitle = _sessions.first.title;
            } else {
              _activeSessionId = '';
              _activeSessionTitle = 'Nouvelle conversation';
            }
          }
        });
      }
      await api.deleteCascade(id);
      await _refreshSessions();
      if (wasActive) {
        await _refreshContext();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Conversation supprimée'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      debugPrint('Failed to delete cascade: $e');
    }
  }

  Future<void> _archiveSession(String id) async {
    final api = _api;
    if (api == null) return;
    try {
      final wasActive = (id == _activeSessionId);
      if (mounted) {
        setState(() {
          _sessions = _sessions.where((s) => s.id != id).toList();
          if (wasActive) {
            _activeSessionIsArchived = true;
          }
        });
      }
      await api.archiveCascade(id);
      await _refreshSessions();
      if (wasActive) {
        await _refreshContext();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Conversation archivée'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      debugPrint('Failed to archive cascade: $e');
    }
  }

  Future<void> _renameSession(String id, String newTitle) async {
    final api = _api;
    if (api == null) return;
    try {
      await api.renameCascade(id, newTitle);
    } catch (_) {
      try {
        await api.sendCommand('/rename $newTitle');
      } catch (_) {}
    }
    if (mounted) {
      setState(() {
        _sessions = _sessions
            .map((s) => s.id == id ? s.copyWith(title: newTitle) : s)
            .toList();
        if (_activeSessionId == id) {
          _activeSessionTitle = newTitle;
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Conversation renommée'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _exportSession(CascadeSession session) async {
    final api = _api;
    if (api == null) return;
    try {
      final md = await api.exportMarkdown(session.id);
      if (md.isNotEmpty) {
        await Clipboard.setData(ClipboardData(text: md));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Markdown de la conversation copié !'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Aucun contenu à exporter'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Échec de l\'export: $e'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  /// Stub scheduled tasks : la liste est vide tant que le daemon n'expose pas
  /// de RPC tasks ; l'écran affiche l'empty state et les callbacks sont des
  /// no-ops sûrs.
  /// ponytail: stub volontaire (M5) — pas de tâches planifiées réelles côté
  /// daemon aujourd'hui ; à brancher sur un RPC `list_scheduled_tasks` quand
  /// il existera, sans changer la signature de ScheduledTasksScreen.
  void _showScheduledTasks() {
    final workspaces = _sessions
        .map((s) {
          var clean = s.workspacePath.replaceAll('\\', '/');
          if (clean.startsWith('file:///')) clean = clean.substring(8);
          if (clean.startsWith('file://')) clean = clean.substring(7);
          final segs = clean.split('/').where((p) => p.isNotEmpty).toList();
          return segs.isNotEmpty ? segs.last : 'Outside of Project';
        })
        .toSet()
        .toList();

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ScheduledTasksScreen(
          tasks: const [],
          api: _api,
          workspaces: workspaces.isNotEmpty ? workspaces : const ['Workspace'],
          onTriggerNow: (id) => _api?.triggerScheduledTask(id),
          onCancelTask: (id) => _api?.cancelScheduledTask(id),
          onToggleTask: (id, enabled) => _api?.toggleScheduledTask(id, enabled),
          onAddTask: (task) => _api?.scheduleTask(task),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _sessionsPollTimer?.cancel();
    _notifTapSub?.cancel();
    _wsClient.statusNotifier.removeListener(_onStatusChanged);
    _sessionsSub?.cancel();
    _api?.dispose();
    _wsClient.dispose();
    super.dispose();
  }

  Widget _buildSidebar(bool isConnected) {
    return LeftSidebarDrawer(
      api: _api,
      activeSessionId: _activeSessionId,
      sessions: _sessions,
      projects: _projects,
      isConnected: isConnected,
      isIdeConnected: _isIdeConnected,
      onToggleConnection: () {
        if (isConnected) {
          _wsClient.disconnect();
        }
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => DiscoveryScreen(
              onConnect: (host, port, token) async {
                final url = _formatWsUrl(host, port);
                _wsClient.disconnect();
                await _wsClient.connect(customUrl: url, authToken: token);
                final ok = _wsClient.statusNotifier.value == ConnectionStatus.connected;
                if (ok) {
                  SettingsStore.saveSession(
                    wsUrl: url,
                    token: token,
                    sessionId: _activeSessionId,
                  );
                }
                return ok;
              },
            ),
          ),
        );
      },
      onSessionSelected: (id) {
        setState(() {
          _activeSessionId = id;
          _activeMissingSince = null;
          _contextStats = {};
          _sessions = _sessions.map((s) {
            if (s.id == id) {
              return s.copyWith(hasUnread: false);
            }
            return s;
          }).toList();
          final s = _sessions.firstWhere((s) => s.id == id, orElse: () => const CascadeSession(id: '', workspacePath: '', title: 'Session', status: '', time: ''));
          _activeSessionTitle = s.title;
        });
        _refreshContext();
        SettingsStore.saveSession(
          wsUrl: _wsClient.targetUrl,
          token: _wsClient.authToken ?? '',
          sessionId: id,
        );
      },
      onNewConversation: _createNewConversation,
      onDeleteSession: _deleteSession,
      onArchiveSession: _archiveSession,
      onRenameSession: _renameSession,
      onExportSession: _exportSession,
      onConversationHistory: _showSessionHistory,
      onScheduledTasks: _showScheduledTasks,
      onOpenBattleArena: () {
        if (_api == null) return;
        final s = _sessions.firstWhere(
          (s) => s.id == _activeSessionId,
          orElse: () => const CascadeSession(id: '', workspacePath: '', title: '', status: '', time: ''),
        );
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => BattleArenaScreen(
              api: _api!,
              workspaceUri: s.workspacePath.isNotEmpty ? s.workspacePath : '.',
            ),
          ),
        );
      },
      onOpenSidecars: () {
        if (_api == null) return;
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => SidecarsDashboardScreen(
              api: _api!,
            ),
          ),
        );
      },
      onOpenSettings: () {
        final s = _sessions.firstWhere(
          (s) => s.id == _activeSessionId,
          orElse: () => const CascadeSession(id: '', workspacePath: '', title: '', status: '', time: ''),
        );
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => SettingsScreen(
              initialSettings: _savedSettings,
              onThemeModeChanged: widget.onThemeModeChanged,
              onDaemonSaved: _applyDaemonSettings,
              onDiscover: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => DiscoveryScreen(
                      onConnect: (host, port, token) async {
                        final url = _formatWsUrl(host, port);
                        _wsClient.disconnect();
                        await _wsClient.connect(customUrl: url, authToken: token);
                        final ok = _wsClient.statusNotifier.value == ConnectionStatus.connected;
                        if (ok) {
                          SettingsStore.saveSession(
                            wsUrl: url,
                            token: token,
                            sessionId: _activeSessionId,
                          );
                        }
                        return ok;
                      },
                    ),
                  ),
                );
              },
              api: _api,
              notifier: ApprovalNotifier.instance,
              workspacePath: s.workspacePath,
            ),
          ),
        );
      },
      onDiscover: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => DiscoveryScreen(
              onConnect: (host, port, token) async {
                final url = _formatWsUrl(host, port);
                _wsClient.disconnect();
                await _wsClient.connect(customUrl: url, authToken: token);
                final ok = _wsClient.statusNotifier.value == ConnectionStatus.connected;
                if (ok) {
                  // Persiste l'appairage : le tunnel Cloudflare peut avoir
                  // changé d'URL depuis la dernière sauvegarde.
                  SettingsStore.saveSession(
                    wsUrl: url,
                    token: token,
                    sessionId: _activeSessionId,
                  );
                }
                return ok;
              },
            ),
          ),
        );
      },
      onOpenWorkspace: () {
        final activeSession = _sessions.firstWhere(
          (s) => s.id == _activeSessionId,
          orElse: () => const CascadeSession(id: '', workspacePath: '.', title: '', status: '', time: ''),
        );
        var path = activeSession.workspacePath;
        if (path.startsWith('file:///')) {
          path = path.substring(8);
        } else if (path.startsWith('file://')) {
          path = path.substring(7);
        }
        
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (context) => WorkspaceScreen(
              api: _api,
              workspacePath: path,
              projects: _projects,
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = _wsClient.statusNotifier.value;
    final isConnected = status == ConnectionStatus.connected;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final isUltraWide = screenWidth >= 1280;
    final isWideScreen = screenWidth >= 840;
    final sidebar = _buildSidebar(isConnected);

    // Workspace racine de la session active : git_state / list_git_branches
    // exigent un workspacePath côté daemon (sinon "workspacePath requis").
    final activeWs = _sessions
            .where((s) => s.id == _activeSessionId)
            .map((s) => s.workspacePath)
            .firstWhere((p) => p.isNotEmpty, orElse: () => '')
        .isNotEmpty
        ? _sessions
            .where((s) => s.id == _activeSessionId)
            .first
            .workspacePath
        : (_projects.isNotEmpty ? _projects.first.path : '');

    var cleanActiveWs = activeWs;
    if (cleanActiveWs.startsWith('file:///')) {
      cleanActiveWs = cleanActiveWs.substring(8);
    } else if (cleanActiveWs.startsWith('file://')) {
      cleanActiveWs = cleanActiveWs.substring(7);
    }

    final activeProjectDisplayName = WorkspacePath.displayName(
      activeWs,
      fallback: _projects.isNotEmpty ? _projects.first.name : 'Workspace',
    );

    final chatStream = ChatStreamScreen(
      api: _api,
      activeSessionId: _activeSessionId,
      activeProjectName: activeProjectDisplayName,
      activeSessionTitle: _activeSessionTitle,
      workspacePath: activeWs,
      projects: _projects,
      onSelectProject: (p) => _createNewConversation(p),
      onNewConversation: _createNewConversation,
      onOpenSessionsDrawer: () => _scaffoldKey.currentState?.openDrawer(),
      isConnected: isConnected,
      isArchived: _activeSessionIsArchived,
      onRestoreSession: () => _restoreSession(_activeSessionId),
      wsClient: _wsClient,
      onStreamingSessionChanged: (sessionId, isStreaming) {
        if (!mounted) return;
        setState(() {
          _sessions = _sessions.map((s) {
            if (s.id == sessionId) {
              return s.copyWith(status: isStreaming ? 'CASCADE_STATUS_RUNNING' : 'CASCADE_STATUS_READY');
            }
            return s;
          }).toList();
        });
      },
    );

    final contextDrawer = RightSidebarDrawer(
      api: _api,
      activeSessionId: _activeSessionId,
      workspacePath: activeWs,
      subagentsCount: _contextStats['subagentsCount'] as int? ?? 0,
      filesChangedCount: _contextStats['filesChangedCount'] as int? ?? 0,
      artifactsCount: _contextStats['artifactsCount'] as int? ?? 0,
      uploadsCount: _contextStats['uploadsCount'] as int? ?? 0,
      backgroundTasksCount: _contextStats['backgroundTasksCount'] as int? ?? 0,
      scheduledTasksCount: _contextStats['scheduledTasksCount'] as int? ?? 0,
      mcpServersCount: _contextStats['mcpServersCount'] as int? ?? 0,
    );

    final isDark = Theme.of(context).brightness == Brightness.dark;

    final scaffold = Scaffold(
      key: _scaffoldKey,
      extendBodyBehindAppBar: false,
      drawer: isWideScreen ? null : sidebar,
      endDrawer: isUltraWide ? null : contextDrawer,
      drawerScrimColor: isDark
          ? Colors.black.withValues(alpha: 0.75)
          : Colors.black.withValues(alpha: 0.65),
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.surface,
        elevation: 0,
        scrolledUnderElevation: 1,
        surfaceTintColor: Colors.transparent,
        leading: isWideScreen
            ? null
            : IconButton(
                icon: Icon(Icons.dock_outlined, size: 20, color: Theme.of(context).colorScheme.onSurface),
                onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                tooltip: 'Ouvrir le menu gauche',
              ),
        title: InkWell(
          onTap: () => _scaffoldKey.currentState?.openDrawer(),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        flex: 2,
                        child: Text(
                          activeProjectDisplayName.isNotEmpty
                              ? activeProjectDisplayName
                              : 'Antigravity',
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                            color: Theme.of(context).colorScheme.onSurface,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (_activeSessionTitle.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: Text(
                            '›',
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark ? AppColors.inkMuted : Theme.of(context).colorScheme.outlineVariant,
                            ),
                          ),
                        ),
                        Flexible(
                          flex: 3,
                          child: Text(
                            _activeSessionTitle,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w400,
                              color: isDark ? AppColors.inkSecondary : Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                      const SizedBox(width: 3),
                      Icon(
                        Icons.unfold_more_rounded,
                        size: 13,
                        color: isDark ? AppColors.inkMuted : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                InkWell(
                  onTap: () {
                    if (isConnected) {
                      _wsClient.disconnect();
                      SettingsStore.clearSession();
                    } else {
                      _wsClient.connect();
                    }
                  },
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                    decoration: BoxDecoration(
                      color: (isConnected ? AppColors.positive : AppColors.danger).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      border: Border.all(
                        color: (isConnected ? AppColors.positive : AppColors.danger).withValues(alpha: 0.25),
                        width: 0.8,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ValueListenableBuilder<int?>(
                          valueListenable: _wsClient.latencyMsNotifier,
                          builder: (context, latency, _) {
                            final label = isConnected
                                ? (latency != null ? '${latency}ms' : 'Connecté')
                                : 'Hors ligne';
                            // P2: 3-tier latency color thresholds
                            final Color badgeColor;
                            if (!isConnected) {
                              badgeColor = AppColors.danger;
                            } else if (latency == null || latency < 250) {
                              badgeColor = AppColors.positive;
                            } else if (latency < 500) {
                              badgeColor = AppColors.warning;
                            } else {
                              badgeColor = AppColors.danger;
                            }
                            return Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 6,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    color: badgeColor,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 5),
                                Text(
                                  label,
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: badgeColor,
                                    fontWeight: FontWeight.w600,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.terminal_rounded, size: 20, color: Theme.of(context).colorScheme.onSurface),
            onPressed: () {
              HapticFeedback.selectionClick();
              RemoteTerminalSheet.show(
                context,
                api: _api,
                projectName: activeProjectDisplayName,
                workspacePath: cleanActiveWs.isNotEmpty ? cleanActiveWs : activeWs,
              );
            },
            tooltip: 'Ouvrir le terminal distant',
          ),
          if (!isUltraWide)
            IconButton(
              icon: Icon(Icons.vertical_split_outlined, size: 20, color: Theme.of(context).colorScheme.onSurface),
              onPressed: () => _scaffoldKey.currentState?.openEndDrawer(),
              tooltip: 'Ouvrir le panneau contexte',
            ),
        ],
      ),
      body: isUltraWide
          ? Row(
              children: [
                SizedBox(
                  width: 280,
                  child: Material(
                    color: Theme.of(context).colorScheme.surfaceContainer,
                    child: sidebar,
                  ),
                ),
                VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                Expanded(child: chatStream),
                VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                SizedBox(
                  width: 320,
                  child: Material(
                    color: Theme.of(context).colorScheme.surfaceContainer,
                    child: contextDrawer,
                  ),
                ),
              ],
            )
          : isWideScreen
              ? Row(
                  children: [
                    SizedBox(
                      width: 320,
                      child: Material(
                        color: Theme.of(context).colorScheme.surfaceContainer,
                        child: sidebar,
                      ),
                    ),
                    VerticalDivider(
                      width: 1,
                      thickness: 1,
                      color: Theme.of(context).colorScheme.outlineVariant,
                    ),
                    Expanded(child: chatStream),
                  ],
                )
              : chatStream,
    );

    return PopScope(
      canPop: !(_scaffoldKey.currentState?.isDrawerOpen ?? false) &&
          !(_scaffoldKey.currentState?.isEndDrawerOpen ?? false),
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_scaffoldKey.currentState?.isDrawerOpen ?? false) {
          _scaffoldKey.currentState?.closeDrawer();
        } else if (_scaffoldKey.currentState?.isEndDrawerOpen ?? false) {
          _scaffoldKey.currentState?.closeEndDrawer();
        }
      },
      child: CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.escape): () {
            if (_scaffoldKey.currentState?.isDrawerOpen ?? false) {
              _scaffoldKey.currentState?.closeDrawer();
            } else if (_scaffoldKey.currentState?.isEndDrawerOpen ?? false) {
              _scaffoldKey.currentState?.closeEndDrawer();
            }
          },
        },
        child: Focus(
          autofocus: false,
          child: scaffold,
        ),
      ),
    );
  }
}



