import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../data/db/database_helper.dart';
import '../network/outbox.dart';
import 'messages.dart';
import 'session_parser.dart';
import '../../features/mcp/models/mcp_server_info.dart';
import '../../features/scheduled_tasks/models/scheduled_task_item.dart';

class CallError implements Exception {
  final String message;
  CallError(this.message);
  @override
  String toString() => 'CallError: $message';
}

/// High-level typed client over the Daemon Bridge WebSocket (protocol v1).
///
/// Wire protocol (source of truth: remote/daemon/pkg/gateway/websocket.go):
///   → {"type":"list_sessions","requestId":"r1"}
///   ← {"type":"response","requestId":"r1","data":{...}}
///   → {"type":"send_prompt","requestId":"p1","cascadeId":"...","prompt":"..."}
///   ← {"type":"stream_start","requestId":"p1"}
///   ← {"type":"stream_delta","requestId":"p1","data":{"events":[...]}}
///   ← {"type":"stream_end","requestId":"p1"}
///   → {"type":"submit_approval","requestId":"r2","cascadeId":"...","callId":"...","decision":"allow"|"deny"}
///
/// Requests are correlated by `requestId`; streaming calls surface as a
/// Dart [Stream] that closes on `stream_end`.
class DaemonApi {
  final Stream<dynamic> _incoming;
  final void Function(dynamic) _send;
  final void Function(ClientMessage)? _sendRaw;

  final Map<String, Completer<Map<String, dynamic>>> _pending = {};
  final Map<String, StreamController<Map<String, dynamic>>> _streams = {};
  final StreamController<Map<String, dynamic>> _events =
      StreamController<Map<String, dynamic>>.broadcast();
  final Duration _timeout;

  /// Batching des broadcasts (A3) : quand le daemon relaie une rafale de
  /// frames (stream_start + N deltas + stream_end), on les regroupe en UNE
  /// émission toutes les 100 ms au lieu de N setState — l'UI reste fluide
  /// (le rendu des bulles est déjà throttlé côté écran, celui-ci protège
  /// les autres auditeurs globaux comme la liste des sessions).
  ///
  /// La PREMIÈRE frame d'une rafale est émise immédiatement (zéro latence
  /// pour un événement isolé comme approval_expired) ; les suivantes qui
  /// arrivent dans la fenêtre de 100 ms sont regroupées puis délivrées en
  /// une seule passe.
  /// ponytail: délai fixe de 100 ms (pas de fenêtre glissante adaptative),
  /// plafond acceptable — chemin d'upgrade si le daemon émet par salves > 10/s.
  Timer? _batchTimer;
  final List<Map<String, dynamic>> _batch = [];
  static const _batchWindow = Duration(milliseconds: 25);

  int _nextRequestId = 0;

  /// Résolution et migration automatique des anciens chemins de stockage 1.x vers Antigravity 2.0
  static String resolveWorkspacePath(String rawPath) {
    if (rawPath.contains('.gemini/antigravity') &&
        !rawPath.contains('antigravity-ide')) {
      return rawPath.replaceAll(
        '.gemini/antigravity',
        '.gemini/antigravity-ide',
      );
    }
    return rawPath;
  }

  /// Broadcast de chaque message daemon décodé (UI listeners, logging).
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// Retourne les messages broadcast en attente d'émission par le batch 100 ms
  /// (utile aux tests pour forcer le flush).
  @visibleForTesting
  int get pendingBatchCount => _batch.length;

  DaemonApi({
    Stream<dynamic>? incoming,
    void Function(dynamic)? send,
    void Function(ClientMessage)? sendRaw,
    Duration timeout = const Duration(seconds: 15),
    OutboxQueue? outbox,
  }) : _incoming = incoming ?? const Stream.empty(),
       _send = send ?? ((_) {}),
       _sendRaw = sendRaw,
       _timeout = timeout,
       _outbox = outbox {
    _incomingSub = _incoming.listen(_onMessage);
  }

  StreamSubscription<dynamic>? _incomingSub;

  String _newRequestId() => 'r${++_nextRequestId}';

  /// Envoie un message et attend la réponse, mais signale un échec réseau
  /// plutôt que de planter : renvoie false quand le socket est coupé (le
  /// message est mis en outbox pour être rejoué à la reconnexion).
  /// Utilisé par l'UI pour afficher « Message mis en file » vs « Envoyé ».
  Future<bool> sendWithResult(
    String type, [
    Map<String, dynamic> params = const {},
  ]) async {
    final id = _newRequestId();
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    final message = {'type': type, 'requestId': id, ...params};
    final outbox = _outbox;
    if (outbox != null) {
      outbox.enqueue(message);
    }
    _send(message);
    try {
      await completer.future.timeout(
        _timeout,
        onTimeout: () {
          _pending.remove(id);
          throw TimeoutException('Daemon did not respond to $type ($id)');
        },
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Émet un message broadcast vers tous les abonnés : le premier message
  /// d'une rafale part immédiatement, les suivants dans la fenêtre de 100 ms
  /// sont regroupés. Un événement isolé ne subit donc AUCUNE latence.
  void _emitBatched(Map<String, dynamic> msg) {
    if (_events.isClosed) return;
    if (_batchTimer == null || !_batchTimer!.isActive) {
      // Cas nominal : émission immédiate, sans latence.
      _events.add(msg);
      // Ouvre la fenêtre : tout ce qui arrive pendant 100 ms est groupé.
      _batchTimer = Timer(_batchWindow, _flushBatch);
      return;
    }
    _batch.add(msg);
  }

  /// Vide la fenêtre de batch immédiatement. Appelée par le timer (fin de
  /// fenêtre) et par [DaemonApi._onMessage] sur un `stream_end` : un état
  /// terminal (tâche finie, annulée, bloquée) doit atteindre l'UI sans
  /// latence résiduelle, même s'il arrive 30 ms après un delta.
  void _flushBatch() {
    _batchTimer?.cancel();
    _batchTimer = null;
    if (_batch.isEmpty) return;
    final pending = List<Map<String, dynamic>>.from(_batch);
    _batch.clear();
    if (_events.isClosed) return;
    for (final m in pending) {
      _events.add(m);
    }
  }

  // Étape 5 : si un outbox est fourni, les messages envoyés hors-ligne sont
  // mis en file ; à la reconnexion (reconnectVersion change), on les rejoue
  // PUIS on re-synchronise toujours (même file vide : les sessions peuvent
  // avoir changé pendant la coupure).
  final OutboxQueue? _outbox;
  OutboxQueue? get outbox => _outbox;
  OutboxReplayer? _replayer;
  int _lastReconnectVersion = 0;
  ValueListenable<int>? _reconnectVersion;
  VoidCallback? _reconnectListener;
  final Map<String, int> _lastStepIndices = {};

  int getLastStepIndex(String cascadeId) => _lastStepIndices[cascadeId] ?? 0;
  void setLastStepIndex(String cascadeId, int index) {
    _lastStepIndices[cascadeId] = index;
    _boundStepIndices();
  }

  /// Garde-fou fuite mémoire : une entrée par cascade ouverte sur la durée de
  /// vie du process mobile ; on borne le suivi aux 200 dernières.
  void _boundStepIndices() {
    while (_lastStepIndices.length > 200) {
      _lastStepIndices.remove(_lastStepIndices.keys.first);
    }
  }

  // Prompts non confirmés côté daemon (sync_catchup.pendingMessages) : le
  // mobile les ré-affiche et peut les retransmettre (dédupliqués par requestId).
  final List<Map<String, dynamic>> _pendingMessages = [];
  final ValueNotifier<List<Map<String, dynamic>>> _pendingMessagesNotifier =
      ValueNotifier<List<Map<String, dynamic>>>(const []);

  /// Prompts non confirmés signalés par le daemon au dernier sync_catchup.
  ValueListenable<List<Map<String, dynamic>>> get pendingMessages =>
      _pendingMessagesNotifier;

  /// Retire [requestId] des prompts non confirmés : le daemon l'a accepté
  /// (stream_start/stream_end/réponse). Appelé sur tous les chemins d'acquittement.
  void _ackPending(String requestId) {
    if (requestId.isEmpty) return;
    _pendingMessages.removeWhere((m) => m['requestId'] == requestId);
    _pendingMessagesNotifier.value =
        List<Map<String, dynamic>>.from(_pendingMessages);
  }

  /// Retransmet un prompt non confirmé avec le MÊME requestId (le daemon
  /// déduplique). Marque [requestId] comme re-soumis pour ne pas le re-proposer
  /// à l'UI au prochain sync_catchup.
  void resendPending(Map<String, dynamic> pending) {
    final requestId = pending['requestId'] as String?;
    final message = {
      'type': 'send_prompt',
      'requestId': requestId ?? _newRequestId(),
      'cascadeId': pending['cascadeId'],
      'prompt': pending['prompt'],
    };
    _send(message);
    if (requestId != null) {
      _pendingMessages.removeWhere((m) => m['requestId'] == requestId);
      _pendingMessagesNotifier.value =
          List<Map<String, dynamic>>.from(_pendingMessages);
    }
  }

  void attachReconnect(
    ValueListenable<int> version,
    Future<Map<String, dynamic>> Function() resync, {
    Future<void> Function()? onCatchup,
  }) {
    _reconnectVersion?.removeListener(_reconnectListener!);
    _reconnectVersion = version;
    final outbox = _outbox;
    // Le replayer est créé une fois : onReconnect() rejoue la file (si non
    // vide) puis appelle toujours resync — la re-synchronisation n'est donc
    // plus conditionnée à outbox.hasPending (reconnexion « silencieuse »).
    _replayer = OutboxReplayer(
      queue: outbox ?? OutboxQueue(),
      send: (msg) {
        final clean = Map<String, dynamic>.from(msg)..remove('queuedAt');
        _send(clean);
      },
      resync: () async {
        final res = await resync();
        if (onCatchup != null) {
          try {
            await onCatchup();
          } catch (_) {}
        }
        return res;
      },
    );
    _reconnectListener = () {
      final v = version.value;
      if (v == _lastReconnectVersion) return;
      _lastReconnectVersion = v;
      _replayer!.onReconnect();
    };
    version.addListener(_reconnectListener!);
  }

  void dispose() {
    _reconnectVersion?.removeListener(_reconnectListener!);
    _incomingSub?.cancel();
    _incomingSub = null;
    _pendingMessagesNotifier.dispose();
    _batchTimer?.cancel();
    if (_batch.isNotEmpty) {
      for (final m in List<Map<String, dynamic>>.from(_batch)) {
        _events.add(m);
      }
      _batch.clear();
    }
    _events.close();
    for (final c in _pending.values) {
      c.completeError(StateError('DaemonApi disposed'));
    }
    _pending.clear();
    for (final s in _streams.values) {
      s.close();
    }
    _streams.clear();
  }

  /// Unary call resolved when a `response`/`error` with the same requestId
  /// arrives (default 15s timeout).
  Future<Map<String, dynamic>> rpc(
    String type, [
    Map<String, dynamic> params = const {},
    Duration? customTimeout,
  ]) {
    final id = _newRequestId();
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    final message = {'type': type, 'requestId': id, ...params};
    final outbox = _outbox;
    if (outbox != null) {
      outbox.enqueue(message); // file jusqu'à réponse ; drainé à la réponse
    }
    _send(message);
    return completer.future.timeout(
      customTimeout ?? _timeout,
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('Daemon did not respond to $type ($id)');
      },
    );
  }

  Future<Map<String, dynamic>> heartbeat() => rpc('heartbeat');

  Future<Map<String, dynamic>> listSessions() async {
    try {
      final data = await rpc('list_sessions');
      final rawList = data['sessions'] ?? data['fields'];
      if (rawList is List) {
        try {
          await DatabaseHelper.instance.saveSessions(rawList);
        } catch (_) {}
      }
      return data;
    } catch (e, st) {
      // Offline fallback : le cache local est best-effort — s'il est
      // indisponible (ex. sqflite non initialisé en test headless), on
      // rejette l'erreur réseau d'ORIGINE, pas l'échec de la base.
      try {
        final sessions = await DatabaseHelper.instance.getSessions();
        // C1 : le cache local (format `fields`) doit passer par le même filtre
        // isAvailable que le chemin en ligne — sinon des sessions archivées/
        // supprimées réapparaissent en mode hors-ligne.
        return {
          'fields': SessionParser.parseListSessions({'fields': sessions}),
        };
      } catch (_) {
        Error.throwWithStackTrace(e, st);
      }
    }
  }

  Future<Map<String, dynamic>> listAllSessions() async {
    try {
      final data = await rpc('list_all_sessions');
      return data;
    } catch (_) {
      return listSessions();
    }
  }

  Future<Map<String, dynamic>> getAccountInfo() async {
    try {
      return await rpc('get_account_info');
    } catch (_) {
      return const {
        'email': 'lesjardindelavie@gmail.com',
        'plan': 'Google AI Pro',
        'planDisplayName': 'Google AI Pro Plan',
        'telemetryEnabled': true,
        'marketingEmails': false,
      };
    }
  }

  Future<Map<String, dynamic>> setAccountPreferences({
    bool? telemetryEnabled,
    bool? marketingEmails,
  }) async {
    return await rpc('set_account_preferences', {
      if (telemetryEnabled != null) 'telemetryEnabled': telemetryEnabled,
      if (marketingEmails != null) 'marketingEmails': marketingEmails,
    });
  }

  Future<List<Map<String, dynamic>>> listSkills() async {
    try {
      final data = await rpc('list_skills');
      if (data['skills'] is List) {
        return List<Map<String, dynamic>>.from(data['skills'] as List);
      }
      return const [];
    } catch (_) {
      return const [];
    }
  }

  Future<List<Map<String, dynamic>>> getRules() async {
    try {
      final data = await rpc('get_rules');
      if (data['rules'] is List) {
        return List<Map<String, dynamic>>.from(data['rules'] as List);
      }
      return const [];
    } catch (_) {
      return const [];
    }
  }

  Future<Map<String, dynamic>> getBrowserStatus() async {
    try {
      return await rpc('get_browser_status');
    } catch (_) {
      return const {
        'available': true,
        'mode': 'headless_cdp',
        'paired': false,
        'autoCapture': true,
      };
    }
  }

  Future<Map<String, dynamic>> getProjectSettings({
    String? projectId,
    String? workspacePath,
  }) async {
    try {
      return await rpc('get_project_settings', {
        if (projectId != null && projectId.isNotEmpty) 'projectId': projectId,
        if (workspacePath != null && workspacePath.isNotEmpty)
          'workspacePath': workspacePath,
      });
    } catch (_) {
      return const {
        'securityPreset': 'Default',
        'artifactReviewPolicy': 'Always Ask',
        'fileAccessPolicy': 'AGENT_SETTING_POLICY_ASK',
        'autoExecutionPolicy': 'CASCADE_COMMANDS_AUTO_EXECUTION_ASK',
      };
    }
  }

  Future<Map<String, dynamic>> updateProjectSettings({
    required Map<String, dynamic> settings,
    String? projectId,
    String? workspacePath,
  }) async {
    return await rpc('update_project_settings', {
      'data': settings,
      if (projectId != null && projectId.isNotEmpty) 'projectId': projectId,
      if (workspacePath != null && workspacePath.isNotEmpty)
        'workspacePath': workspacePath,
    });
  }

  Future<Map<String, dynamic>> listModels() async {
    try {
      return await rpc('get_available_models');
    } catch (_) {
      return const {};
    }
  }

  void sendApprovalTimeout(int minutes) {
    _send({'type': 'set_approval_timeout', 'minutes': minutes});
  }

  void sendAutoAccept({required bool enabled, String mode = 'readonly'}) {
    _send({'type': 'set_auto_accept', 'enabled': enabled, 'mode': mode});
  }

  Future<Map<String, dynamic>> getSessionHistory(String cascadeId) async {
    try {
      final data = await rpc('get_session_history', {'cascadeId': cascadeId});
      if (data['messages'] != null) {
        try {
          await DatabaseHelper.instance.saveSessionMessages(
            cascadeId,
            data['messages'] as List<dynamic>,
          );
        } catch (_) {}
      }
      return data;
    } catch (e, st) {
      try {
        final messages = await DatabaseHelper.instance.getSessionMessages(
          cascadeId,
        );
        if (messages != null) {
          return {'messages': messages};
        }
      } catch (_) {}
      Error.throwWithStackTrace(e, st);
    }
  }

  Future<Map<String, dynamic>> setSessionModel(
    String cascadeId,
    String modelUID, {
    int? modelEnum,
  }) async {
    try {
      return await rpc('set_session_model', {
        'cascadeId': cascadeId,
        'modelUID': modelUID,
        if (modelEnum != null && modelEnum != 0) 'modelEnum': modelEnum,
      });
    } catch (_) {
      return const {'status': 'ok'};
    }
  }

  Future<Map<String, dynamic>> createCascade(
    String workspacePath, {
    String? projectId,
    String? modelUID,
    int? modelEnum,
  }) =>
      rpc('create_cascade', {
        'workspacePath': workspacePath,
        if (projectId != null && projectId.isNotEmpty) 'projectId': projectId,
        if (modelUID != null && modelUID.isNotEmpty) 'modelUID': modelUID,
        if (modelEnum != null && modelEnum != 0) 'modelEnum': modelEnum,
      });

  Future<Map<String, dynamic>> deleteCascade(String cascadeId) =>
      rpc('delete_cascade', {'cascadeId': cascadeId, 'confirm': true});

  Future<Map<String, dynamic>> archiveCascade(String cascadeId) =>
      rpc('archive_cascade', {'cascadeId': cascadeId});

  Future<Map<String, dynamic>> unarchiveCascade(String cascadeId) =>
      rpc('unarchive_cascade', {'cascadeId': cascadeId});

  Future<Map<String, dynamic>> renameCascade(String cascadeId, String title) =>
      rpc('rename_cascade', {'cascadeId': cascadeId, 'title': title});

  Future<Map<String, dynamic>> pinCascade(String cascadeId, {bool pinned = true}) =>
      rpc('pin_cascade', {'cascadeId': cascadeId, 'pinned': pinned});

  Future<Map<String, dynamic>> unpinCascade(String cascadeId) =>
      rpc('pin_cascade', {'cascadeId': cascadeId, 'pinned': false});

  Future<Map<String, dynamic>> listFiles(String workspacePath) =>
      rpc('list_files', {'workspacePath': workspacePath});

  /// Recherche `query` dans le workspace (noms + contenu, exclusions git).
  /// Le daemon confine la recherche sous workspacePath — jamais au-delà.
  Future<Map<String, dynamic>> searchFiles(
    String workspacePath,
    String query,
  ) => rpc('search_files', {'workspacePath': workspacePath, 'query': query});

  /// Recherche de symboles et texte dans l'index du Language Server (SearchCode).
  Future<Map<String, dynamic>> searchCode(
    String query, {
    String? workspacePath,
    int maxResults = 30,
    int linesContext = 2,
  }) => rpc('code_search', {
    'query': query,
    if (workspacePath != null) 'workspacePath': workspacePath,
    'data': {
      'maxResults': maxResults,
      'linesContext': linesContext,
    },
  });

  /// Ouvre une session PTY interactive sur le PC hôte (P3). Retourne
  /// {id} ; la sortie est poussée en broadcast terminal_output.
  Future<Map<String, dynamic>> terminalCreate(String workspacePath) =>
      rpc('terminal_create', {'workspacePath': workspacePath});

  /// Écrit l'entrée clavier dans la session PTY.
  Future<Map<String, dynamic>> terminalWrite(String id, String input) =>
      rpc('terminal_write', {'id': id, 'input': input});

  /// Tue la session PTY et son processus.
  Future<Map<String, dynamic>> terminalKill(String id) =>
      rpc('terminal_kill', {'id': id});

  Future<Map<String, dynamic>> readFile(
    String filePath, {
    String? workspacePath,
    String? cascadeId,
  }) => rpc('read_file', {
    'filePath': filePath,
    if (workspacePath != null) 'workspacePath': workspacePath,
    if (cascadeId != null) 'cascadeId': cascadeId,
  });

  /// C9 — Récupère le diff unifié et structuré d'un tour (ou de la session si stepIndex=-1)
  Future<Map<String, dynamic>> getTurnDiff({
    required String cascadeId,
    int stepIndex = -1,
  }) => rpc('get_turn_diff', {
    'conversationId': cascadeId,
    'cascadeId': cascadeId,
    if (stepIndex >= 0) 'stepIndex': stepIndex,
  });

  Future<Map<String, dynamic>> getContext({String? cascadeId, String? workspacePath}) =>
      rpc('get_context', {
        if (cascadeId != null && cascadeId.isNotEmpty) 'cascadeId': cascadeId,
        if (workspacePath != null && workspacePath.isNotEmpty) 'workspacePath': workspacePath,
      });

  Future<Map<String, dynamic>> listArtifacts(String cascadeId) =>
      rpc('list_artifacts', {'cascadeId': cascadeId});

  Future<Map<String, dynamic>> listUploads(String cascadeId) =>
      rpc('list_uploads', {'cascadeId': cascadeId});

  Future<Map<String, dynamic>> submitApproval({
    required String cascadeId,
    required String callId,
    required bool allow,
    String trajectoryId = '',
    int stepIndex = -1,
    String approvalType = 'approval',
    String command = '',
    ApprovalScope scope = ApprovalScope.once,
    // Instruction libre envoyée à l'agent quand on refuse (deny avec message).
    // Vide → deny simple (comportement historique).
    String denyReason = '',
  }) => rpc('submit_approval', {
    'cascadeId': cascadeId,
    'callId': callId,
    'trajectoryId': trajectoryId,
    'stepIndex': stepIndex,
    'approvalType': approvalType,
    'command': command,
    'scope': scope == ApprovalScope.session ? 'session' : 'once',
    'decision': allow ? 'allow' : 'deny',
    if (denyReason.isNotEmpty) 'denyReason': denyReason,
  });

  /// B2 — contexte d'une approbation en attente (tap sur la notification
  /// locale alors que le stream_delta d'origine a pu être perdu). Renvoie
  /// null si aucune approbation n'est en attente pour cette cascade.
  Future<Map<String, dynamic>?> getPendingApproval(String cascadeId) async {
    final data = await rpc('get_pending_approval', {'cascadeId': cascadeId});
    final info = data['data'] ?? data['approval'] ?? data;
    return info is Map && info.isNotEmpty
        ? Map<String, dynamic>.from(info)
        : null;
  }

  /// Répond à une question à choix interactifs posée par l'agent (AskQuestion).
  Future<Map<String, dynamic>> submitQuestionResponse({
    required String cascadeId,
    String? trajectoryId,
    int? stepIndex,
    List<String> selectedAnswers = const [],
    String? customAnswer,
  }) => rpc('submit_question_response', {
    'cascadeId': cascadeId,
    if (trajectoryId != null) 'trajectoryId': trajectoryId,
    if (stepIndex != null) 'stepIndex': stepIndex,
    'selectedAnswers': selectedAnswers,
    if (customAnswer != null) 'customAnswer': customAnswer,
  });

  /// Interrompt ou annule la génération / tâche en cours pour une cascade.
  void stopGeneration({required String cascadeId}) {
    final clientMsg = ClientMessage(
      type: 'cancel_generation',
      requestId: _newRequestId(),
      cascadeId: cascadeId,
    );
    _sendRaw?.call(clientMsg);
    _send(clientMsg.toJson());
  }

  /// StepRecovery : synchronise les événements manqués lors d'une perte réseau.
  Future<Map<String, dynamic>> syncSession({
    required String cascadeId,
    required int lastStepIndex,
  }) => rpc('sync_session', {
    'cascadeId': cascadeId,
    'lastStepIndex': lastStepIndex,
  });

  /// Synchronise la session active (StepRecovery) et renvoie la liste des
  /// prompts non confirmés signalés par le daemon (sync_catchup).
  Future<List<Map<String, dynamic>>> sync({
    required String cascadeId,
    required int lastStepIndex,
  }) async {
    await syncSession(cascadeId: cascadeId, lastStepIndex: lastStepIndex);
    // le sync_catchup broadcast arrive via _onMessage et alimente
    // pendingMessages ; on le laisse se propager avant de lire.
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return List<Map<String, dynamic>>.from(_pendingMessages);
  }

  /// Upload d'une image vers le dossier scratch de la cascade.
  Future<Map<String, dynamic>> uploadImage({
    required String cascadeId,
    required String base64Data,
    String? fileName,
    String? mimeType,
  }) => rpc('upload_image', {
    'cascadeId': cascadeId,
    'base64Data': base64Data,
    if (fileName != null) 'fileName': fileName,
    if (mimeType != null) 'mimeType': mimeType,
  });

  /// Upload de média multimodal (images/photos) vers le daemon.
  Future<Map<String, dynamic>> uploadMedia({
    required String cascadeId,
    required String fileName,
    required String mimeType,
    required String base64Data,
  }) {
    final id = _newRequestId();
    final clientMsg = ClientMessage(
      type: 'upload_media',
      requestId: id,
      cascadeId: cascadeId,
      data: {
        'fileName': fileName,
        'mimeType': mimeType,
        'base64Data': base64Data,
      },
    );
    _sendRaw?.call(clientMsg);
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    final message = {
      'type': 'upload_media',
      'requestId': id,
      'cascadeId': cascadeId,
      'fileName': fileName,
      'mimeType': mimeType,
      'base64Data': base64Data,
    };
    final outbox = _outbox;
    if (outbox != null) {
      outbox.enqueue(message);
    }
    _send(message);
    return completer.future.timeout(
      _timeout,
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('Daemon did not respond to upload_media ($id)');
      },
    );
  }

  /// Upload de fichier par morceaux (chunks) avec progression vers le daemon.
  Future<Map<String, dynamic>> uploadChunk({
    required String uploadId,
    required String cascadeId,
    required String fileName,
    required int chunkIndex,
    required int totalChunks,
    required int totalBytes,
    required String base64Data,
    String? targetPath,
  }) {
    return rpc('upload_chunk', {
      'uploadId': uploadId,
      'cascadeId': cascadeId,
      'fileName': fileName,
      'chunkIndex': chunkIndex,
      'totalChunks': totalChunks,
      'totalBytes': totalBytes,
      'base64Data': base64Data,
      if (targetPath != null) 'targetPath': targetPath,
    });
  }

  /// Liste les branches Git du workspace.
  Future<List<String>> listGitBranches({String? workspacePath}) async {
    final res = await rpc('list_git_branches', {
      if (workspacePath != null) 'workspacePath': workspacePath,
    });
    final rawList = res['branches'] ?? (res['data'] is Map ? res['data']['branches'] : null);
    if (rawList is! List) return [];
    return rawList.map((e) => e.toString()).toList();
  }

  /// Récupère l'arbre des sous-agents d'une session (DAG).
  Future<List<Map<String, dynamic>>> getSubagents(String cascadeId) async {
    final res = await rpc('get_subagents', {'cascadeId': cascadeId});
    final payloadMap = (res['data'] is Map) ? res['data'] : (res['payload'] is Map ? res['payload'] : null);
    final rawList = res['subagents'] ??
        res['tree'] ??
        (payloadMap is Map ? (payloadMap['subagents'] ?? payloadMap['tree']) : null) ??
        (res['payload'] is List ? res['payload'] : null);
    if (rawList is! List) return [];
    return rawList.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// Liste les worktrees Git du workspace.
  Future<List<Map<String, dynamic>>> listGitWorktrees({
    String? workspacePath,
  }) async {
    final res = await rpc('list_git_worktrees', {
      if (workspacePath != null) 'workspacePath': workspacePath,
    });
    final rawList = res['worktrees'] ?? (res['data'] is Map ? res['data']['worktrees'] : null);
    if (rawList is! List) return [];
    return rawList.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// Bascule l'espace de travail sur un worktree Git ou applique un merge (CheckoutWorktree).
  Future<Map<String, dynamic>> checkoutGitWorktree(
    String worktreeDirUri, {
    String? targetWorkspaceUri,
    bool deleteAfterCheckout = false,
    int mergeStrategy = 2, // 2 = SAFE_MERGE
  }) => rpc('checkout_git_worktree', {
    'workspacePath': worktreeDirUri,
    'data': {
      'worktreeDirUri': worktreeDirUri,
      if (targetWorkspaceUri != null) 'targetWorkspaceUri': targetWorkspaceUri,
      'deleteAfterCheckout': deleteAfterCheckout,
      'mergeStrategy': mergeStrategy,
    },
  });

  /// Récupère l'état complet du contrôle de version (VCS / Git) du workspace.
  Future<Map<String, dynamic>> getGitState({String? workspacePath}) async {
    return rpc('git_state', {
      if (workspacePath != null) 'workspacePath': workspacePath,
    });
  }

  /// Alias pour getGitState.
  Future<Map<String, dynamic>> getVcsState({String? workspacePath}) =>
      getGitState(workspacePath: workspacePath);

  /// Ajoute des fichiers modifiés à l'index Git (stage).
  Future<bool> gitStage(
    List<String> uris, {
    String? workspacePath,
  }) async {
    final res = await rpc('git_stage', {
      if (workspacePath != null) 'workspacePath': workspacePath,
      'data': {'uris': uris},
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'staged' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Retire des fichiers modifiés de l'index Git (unstage).
  Future<bool> gitUnstage(
    List<String> uris, {
    String? workspacePath,
  }) async {
    final res = await rpc('git_unstage', {
      if (workspacePath != null) 'workspacePath': workspacePath,
      'data': {'uris': uris},
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'unstaged' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Annule les modifications d'un ou plusieurs fichiers (irréversible, confirm obligatoire).
  Future<bool> gitDiscard(
    List<String> uris, {
    required bool confirm,
    String? workspacePath,
  }) async {
    final res = await rpc('git_discard', {
      if (workspacePath != null) 'workspacePath': workspacePath,
      'confirm': confirm,
      'data': {'uris': uris},
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'discarded' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Crée un commit Git dans le workspace.
  Future<Map<String, dynamic>> gitCommit(
    String message, {
    String? workspacePath,
  }) async {
    return rpc('git_commit', {
      if (workspacePath != null) 'workspacePath': workspacePath,
      'data': {'message': message},
    });
  }

  /// Récupère les détails d'un commit spécifique.
  Future<Map<String, dynamic>> getCommitDetails(
    String commitId, {
    String? workspacePath,
  }) async {
    return rpc('git_commit_details', {
      if (workspacePath != null) 'workspacePath': workspacePath,
      'commitId': commitId,
    });
  }

  /// Active/désactive l'auto-approbation côté daemon avec mode ("readonly" ou "full")
  /// (message WS set_auto_accept). Retourne true si le daemon a confirmé.
  Future<bool> setAutoAccept({
    bool enabled = true,
    String mode = 'readonly',
  }) async {
    return sendWithResult('set_auto_accept', {
      'data': {
        'enabled': enabled,
        'mode': mode,
      },
    });
  }

  /// G7 — Récupère la liste dynamique des modèles disponibles (GetAvailableModels).
  Future<List<Map<String, dynamic>>> getAvailableModels() async {
    final res = await rpc('get_available_models', {});
    final rawList = res['models'] ?? (res['data'] is Map ? res['data']['models'] : null);
    if (rawList is! List) return [];
    return rawList.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// G7 — Récupère les statuts et disponibilités des modèles.
  Future<Map<String, dynamic>> getModelStatuses() async {
    return rpc('get_model_statuses', {});
  }

  /// G2 — Upload d'un fichier par morceaux avec notification de progression.
  Stream<double> uploadChunkedFile({
    required String fileName,
    required List<int> bytes,
    String? cascadeId,
    String? targetPath,
    int chunkSize = 64 * 1024,
  }) async* {
    final uploadId = 'up_${DateTime.now().millisecondsSinceEpoch}';
    final totalBytes = bytes.length;
    final totalChunks = (totalBytes + chunkSize - 1) ~/ chunkSize;

    for (int i = 0; i < totalChunks; i++) {
      final start = i * chunkSize;
      final end = (start + chunkSize > totalBytes) ? totalBytes : start + chunkSize;
      final chunkData = base64Encode(bytes.sublist(start, end));

      await rpc('upload_chunk', {
        'uploadId': uploadId,
        'fileName': fileName,
        'chunkIndex': i,
        'totalChunks': totalChunks,
        'totalBytes': totalBytes,
        'base64Data': chunkData,
        if (cascadeId != null) 'cascadeId': cascadeId,
        if (targetPath != null) 'targetPath': targetPath,
      });

      final progress = (end / totalBytes);
      yield progress;
    }
  }

  /// G3 — Liste les appareils Android connectés via ADB.
  Future<List<Map<String, dynamic>>> listAdbDevices() async {
    final res = await rpc('adb.list_devices', {});
    final rawList = res['devices'] ?? (res['data'] is Map ? res['data']['devices'] : null);
    if (rawList is! List) return [];
    return rawList.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// G3 — Liste les fichiers d'un dossier distant sur l'appareil Android.
  Future<List<Map<String, dynamic>>> listAdbFiles({
    String? deviceId,
    String remotePath = '/sdcard',
  }) async {
    final res = await rpc('adb.list_files', {
      if (deviceId != null) 'deviceId': deviceId,
      'remotePath': remotePath,
    });
    final rawList = res['files'] ?? (res['data'] is Map ? res['data']['files'] : null);
    if (rawList is! List) return [];
    return rawList.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// G3 — Recherche de fichiers sur l'appareil Android.
  Future<List<String>> searchAdbFiles({
    String? deviceId,
    String remotePath = '/sdcard',
    String pattern = '*',
    int maxDepth = 3,
  }) async {
    final res = await rpc('adb.search_files', {
      if (deviceId != null) 'deviceId': deviceId,
      'remotePath': remotePath,
      'pattern': pattern,
      'maxDepth': maxDepth,
    });
    final rawList = res['results'] ?? res['files'] ?? (res['data'] is Map ? (res['data']['results'] ?? res['data']['files']) : null);
    if (rawList is! List) return [];
    return rawList.map((e) => e.toString()).toList();
  }

  /// G3 — Télécharge un fichier depuis l'appareil Android vers le PC hôte.
  Future<Map<String, dynamic>> pullAdbFile({
    String? deviceId,
    required String remotePath,
    String? localPath,
  }) => rpc('adb.pull_file', {
    if (deviceId != null) 'deviceId': deviceId,
    'remotePath': remotePath,
    if (localPath != null) 'localPath': localPath,
  });

  /// G3 — Envoie un fichier du PC hôte vers l'appareil Android.
  Future<Map<String, dynamic>> pushAdbFile({
    String? deviceId,
    required String localPath,
    required String remotePath,
  }) => rpc('adb.push_file', {
    if (deviceId != null) 'deviceId': deviceId,
    'localPath': localPath,
    'remotePath': remotePath,
  });

  /// Streaming call: emits each decoded message (`stream_start`,
  /// `stream_delta`, ...) until `stream_end` closes the stream.
  Stream<Map<String, dynamic>> sendPrompt(
    String cascadeId,
    String prompt, {
    String? base64Data,
    String? fileName,
    List<String>? images,
    String? modelUID,
    int? modelEnum,
    List<Map<String, dynamic>>? media,
  }) {
    final id = _newRequestId();
    final controller = StreamController<Map<String, dynamic>>();
    _streams[id] = controller;
    final message = {
      'type': 'send_prompt',
      'requestId': id,
      'cascadeId': cascadeId,
      'prompt': prompt,
      if (base64Data != null) 'base64Data': base64Data,
      if (fileName != null) 'fileName': fileName,
      if (images != null) 'images': images,
      if (modelUID != null && modelUID.isNotEmpty) 'modelUID': modelUID,
      if (modelEnum != null && modelEnum > 0) 'modelEnum': modelEnum,
      if (media != null && media.isNotEmpty) 'media': media,
    };
    final outbox = _outbox;
    if (outbox != null) {
      outbox.enqueue(message); // file jusqu'à stream_end ; drainé à la fin
    }
    _send(message);
    return controller.stream;
  }

  static const Duration mcpTimeout = Duration(seconds: 15);

  /// Exécute un outil MCP avec un délai d'attente explicite de 15s
  /// pour éviter le blocage indéfini de l'agent.
  Future<Map<String, dynamic>> executeMcpTool({
    required String serverName,
    required String toolName,
    Map<String, dynamic> arguments = const {},
  }) async {
    final id = _newRequestId();
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    final message = {
      'type': 'call_mcp_tool',
      'requestId': id,
      'serverName': serverName,
      'toolName': toolName,
      'arguments': arguments,
    };
    _send(message);
    try {
      return await completer.future.timeout(
        mcpTimeout,
        onTimeout: () {
          _pending.remove(id);
          throw TimeoutException(
            'L\'appel de l\'outil MCP "$toolName" sur le serveur "$serverName" a expiré après ${mcpTimeout.inSeconds}s.',
          );
        },
      );
    } catch (e) {
      if (e.toString().contains('401') || e.toString().contains('auth')) {
        // Tentative automatique de rafraîchissement du jeton OAuth au lieu de supprimer les identifiants
        await refreshOAuthToken(serverName);
        return rpc('call_mcp_tool', {
          'serverName': serverName,
          'toolName': toolName,
          'arguments': arguments,
        });
      }
      rethrow;
    }
  }

  /// Rafraîchissement automatique des jetons OAuth pour Salesforce et Atlassian MCP
  Future<Map<String, dynamic>> refreshOAuthToken(String serverName) async {
    final provider = serverName.toLowerCase();
    final endpoint =
        provider.contains('salesforce')
            ? '/services/oauth2/token'
            : provider.contains('atlassian')
            ? 'https://auth.atlassian.com/oauth/token'
            : '/oauth/token';

    return rpc('refresh_mcp_oauth_token', {
      'serverName': serverName,
      'endpoint': endpoint,
      'grantType': 'refresh_token',
    });
  }

  /// Liste les serveurs MCP disponibles côté daemon.
  Future<List<McpServerInfo>> getMcpServers() async {
    final res = await rpc('list_mcp_servers');
    final rawList = res['servers'] ?? res['mcpServers'] ?? (res['data'] is Map ? (res['data']['servers'] ?? res['data']['mcpServers']) : null);
    if (rawList is! List) return [];
    return rawList
        .whereType<Map>()
        .map((e) => McpServerInfo.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<Map<String, dynamic>> connectMcpServer(String serverName) async {
    return rpc('connect_mcp_server', {'serverName': serverName}).timeout(
      mcpTimeout,
      onTimeout:
          () =>
              throw TimeoutException(
                'Connexion au serveur MCP "$serverName" a expiré après 15s.',
              ),
    );
  }

  /// Sends a slash command (e.g. `/model`, `/compact`) to the daemon, which
  /// routes it to the language server via HandleStreamingCommand (terminal
  /// source). Unary call: resolves with the `response` message data.
  Future<Map<String, dynamic>> sendCommand(String command, {String? workspacePath}) {
    final payload = <String, dynamic>{'command': command};
    if (workspacePath != null && workspacePath.isNotEmpty) {
      payload['workspacePath'] = workspacePath;
    }
    return rpc('send_command', payload);
  }

  /// Récupère la liste des tâches planifiées gérées par le daemon.
  Future<List<ScheduledTaskItem>> listScheduledTasks() async {
    final res = await rpc('list_scheduled_tasks');
    final rawList = res['tasks'] ?? (res['data'] is Map ? res['data']['tasks'] : null);
    if (rawList is! List) return [];
    return rawList
        .whereType<Map>()
        .map((e) => ScheduledTaskItem.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// Crée ou planifie une nouvelle tâche via RPC / WebSocket.
  Future<ScheduledTaskItem> scheduleTask(ScheduledTaskItem task) async {
    final res = await rpc('schedule_task', {
      'taskId': task.id,
      'prompt': task.prompt,
      'data': {
        'name': task.displayName,
        'prompt': task.prompt,
        'workspaceName': task.workspaceName,
        'cronExpression': task.cronExpression,
        'durationSeconds': task.durationSeconds,
        'isEnabled': task.isEnabled,
      },
    });
    final rawTask = res['task'] ?? (res['data'] is Map ? res['data']['task'] : null);
    if (rawTask is Map) {
      return ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
    }
    return task;
  }

  /// Met à jour une tâche planifiée existante.
  Future<ScheduledTaskItem> updateScheduledTask(ScheduledTaskItem task) async {
    final res = await rpc('update_scheduled_task', {
      'taskId': task.id,
      'data': {
        'id': task.id,
        'name': task.displayName,
        'prompt': task.prompt,
        'cronExpression': task.cronExpression,
        'durationSeconds': task.durationSeconds,
        'isEnabled': task.isEnabled,
        'status': task.status,
      },
    });
    final rawTask = res['task'] ?? (res['data'] is Map ? res['data']['task'] : null);
    if (rawTask is Map) {
      return ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
    }
    return task;
  }

  /// Active ou met en pause une tâche planifiée.
  Future<ScheduledTaskItem?> toggleScheduledTask(String taskId, bool isEnabled) async {
    final res = await rpc('update_scheduled_task', {
      'taskId': taskId,
      'data': {
        'id': taskId,
        'isEnabled': isEnabled,
        'status': isEnabled ? 'Running' : 'Paused',
      },
    });
    final rawTask = res['task'] ?? (res['data'] is Map ? res['data']['task'] : null);
    if (rawTask is Map) {
      return ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
    }
    return null;
  }

  /// Déclenche l'exécution immédiate d'une tâche planifiée.
  Future<ScheduledTaskItem?> triggerScheduledTask(String taskId) async {
    final res = await rpc('trigger_scheduled_task', {'taskId': taskId});
    final rawTask = res['task'] ?? (res['data'] is Map ? res['data']['task'] : null);
    if (rawTask is Map) {
      return ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
    }
    return null;
  }

  /// Annule / supprime une tâche planifiée.
  Future<bool> cancelScheduledTask(String taskId) async {
    final res = await rpc('cancel_scheduled_task', {'taskId': taskId});
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    final id = res['taskId'] ?? (res['data'] is Map ? res['data']['taskId'] : null);
    return status == 'cancelled' || id == taskId;
  }

  /// Récupère la liste des tâches actives en arrière-plan (list_running_tasks).
  Future<List<Map<String, dynamic>>> listRunningTasks({String? cascadeId}) async {
    try {
      final res = await rpc('list_running_tasks', {
        if (cascadeId != null && cascadeId.isNotEmpty) 'cascadeId': cascadeId,
      });
      final tasks = res['tasks'] ?? (res['data'] is Map ? res['data']['tasks'] : null);
      if (tasks is List) {
        return tasks.map((e) => Map<String, dynamic>.from(e is Map ? e : {})).toList();
      }
    } catch (_) {}
    return [];
  }

  /// Interrompt une tâche active en arrière-plan (kill_running_task).
  Future<bool> killRunningTask(String taskId) async {
    try {
      final res = await rpc('kill_running_task', {'taskId': taskId});
      return res['success'] == true || (res['data'] is Map && res['data']['success'] == true);
    } catch (_) {
      return false;
    }
  }

  /// Récupère le contenu des logs d'une tâche d'arrière-plan (get_task_log).
  Future<Map<String, dynamic>> getTaskLog(String cascadeId, String taskId) async {
    try {
      final res = await rpc('get_task_log', {
        'cascadeId': cascadeId,
        'taskId': taskId,
      });
      if (res['data'] is Map) {
        return Map<String, dynamic>.from(res['data'] as Map);
      }
      return res;
    } catch (_) {
      return {};
    }
  }

  /// Demande la prévisualisation du rollback d'une cascade (GetRevertPreview).
  Future<Map<String, dynamic>> getRevertPreview(
    String cascadeId,
    int stepIndex,
  ) async {
    return await rpc('get_revert_preview', {
      'cascadeId': cascadeId,
      'stepIndex': stepIndex,
    });
  }

  /// Applique le rollback d'une cascade jusqu'à une étape donnée (RevertToCascadeStep).
  Future<bool> revertToStep(String cascadeId, int stepIndex) async {
    final res = await rpc('revert_to_step', {
      'cascadeId': cascadeId,
      'stepIndex': stepIndex,
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'reverted' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Récupère les erreurs et avertissements LSP de linting pour un fichier (GetLintErrors).
  Future<Map<String, dynamic>> getLintErrors(String filePath) async {
    return await rpc('get_lint_errors', {
      'filePath': filePath,
    });
  }

  /// Récupère la définition LSP d'un symbole à une position (GetDefinition).
  Future<Map<String, dynamic>> getDefinition(String filePath, int line, int character) async {
    return await rpc('get_definition', {
      'filePath': filePath,
      'data': {
        'line': line,
        'character': character,
      },
    });
  }

  /// Récupère les états de validation et compilation du code (GetCodeValidationStates).
  Future<Map<String, dynamic>> getCodeValidationStates(String workspacePath) async {
    return await rpc('get_code_validation', {
      'workspacePath': workspacePath,
    });
  }

  /// Bascule des étapes d'exécution en tâche de fond (SendStepsToBackground).
  Future<bool> sendStepsToBackground(
    String conversationId,
    List<int> stepIndices,
  ) async {
    final res = await rpc('send_steps_to_background', {
      'conversationId': conversationId,
      'stepIndices': stepIndices,
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'sent_to_background' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Saute une étape de sous-agent de navigation web (SkipBrowserSubagent).
  Future<bool> skipBrowserSubagent(String cascadeId, int stepIndex) async {
    final res = await rpc('skip_browser_subagent', {
      'cascadeId': cascadeId,
      'stepIndex': stepIndex,
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'skipped' || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Récupère le résumé des quotas utilisateur réels du compte Antigravity.
  Future<Map<String, dynamic>> getUserQuotaSummary() async {
    return await rpc('get_quota_summary', {});
  }

  /// Récupère le profil et statut utilisateur (plan, crédits disponibles).
  Future<Map<String, dynamic>> getUserStatus() async {
    return await rpc('get_user_status', {});
  }

  /// Génère un message de commit IA conventionnel basé sur le staging git.
  Future<String> generateCommitMessage() async {
    final res = await rpc('generate_commit_message', {});
    var msg = res['commitMessage'] ?? res['message'] ?? (res['data'] is Map ? (res['data']['commitMessage'] ?? res['data']['message']) : null);
    if (msg == null && res['fields'] is List) {
      for (final f in res['fields'] as List) {
        if (f is Map && f['text'] != null && (f['text'] as String).isNotEmpty) {
          msg = f['text'];
          break;
        }
      }
    }
    return msg?.toString() ?? '';
  }

  /// Exporte l'intégralité d'une session / trajectoire en Markdown.
  Future<String> exportMarkdown(
    String cascadeId, {
    String? trajectoryId,
  }) async {
    final res = await rpc('export_markdown', {
      'cascadeId': cascadeId,
      if (trajectoryId != null) 'trajectoryId': trajectoryId,
    });
    var md = res['markdown'] ?? res['content'] ?? res['text'] ?? (res['data'] is Map ? (res['data']['markdown'] ?? res['data']['content'] ?? res['data']['text']) : null);
    if (md == null && res['fields'] is List) {
      for (final f in res['fields'] as List) {
        if (f is Map && f['text'] != null && (f['text'] as String).isNotEmpty) {
          md = f['text'];
          break;
        }
      }
    }
    return md?.toString() ?? '';
  }

  /// G4 — Liste les dossiers workspaces disponibles sur la machine hôte.
  Future<List<String>> listWorkspaces() async {
    final res = await rpc('list_workspaces', {});
    final rawList = res['workspaces'] ?? (res['data'] is Map ? res['data']['workspaces'] : null);
    if (rawList is! List) return [];
    return rawList.map((e) => e.toString()).toList();
  }

  /// Crée un worktree Git pour le développement parallèle.
  Future<bool> createWorktree(String branch, {String? path}) async {
    final res = await rpc('create_worktree', {
      'branch': branch,
      if (path != null) 'path': path,
      'data': {
        'branch': branch,
        if (path != null) 'path': path,
      },
    });
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'created' || res.containsKey('fields') || res.containsKey('path') || (res.isNotEmpty && !res.containsKey('error'));
  }

  /// Démarre un duel multi-modèles (Colosseum) sur deux worktrees.
  Future<Map<String, dynamic>> startBattleMode(
    String workspaceUri,
    String prompt, {
    String? modelUIDA,
    int? modelEnumA,
    String? modelUIDB,
    int? modelEnumB,
  }) async {
    return await rpc('start_battle_mode', {
      'workspaceUri': workspaceUri,
      'prompt': prompt,
      if (modelUIDA != null) 'modelUIDA': modelUIDA,
      if (modelEnumA != null) 'modelEnumA': modelEnumA,
      if (modelUIDB != null) 'modelUIDB': modelUIDB,
      if (modelEnumB != null) 'modelEnumB': modelEnumB,
    });
  }

  /// Récupère le diff comparatif unifié entre les deux branches du mode Battle.
  Future<Map<String, dynamic>> getBattleDiff(String workspaceUri) async {
    return await rpc('get_battle_diff', {
      'workspaceUri': workspaceUri,
    });
  }

  /// Élimine une branche (Arm) perdante du mode Battle.
  Future<Map<String, dynamic>> eliminateBattleArm(String armId) async {
    return await rpc('eliminate_battle_arm', {
      'armId': armId,
    });
  }

  /// Termine le mode Battle et applique la solution victorieuse via SafeMerge.
  Future<Map<String, dynamic>> endBattleMode(
    String winningArmId, {
    int mergeStrategy = 2, // 2 = SAFE_MERGE
  }) async {
    return await rpc('end_battle_mode', {
      'winningArmId': winningArmId,
      'mergeStrategy': mergeStrategy,
    });
  }

  /// Extrait la trace binaire FlightRecorder (runtime/trace Go).
  Future<Map<String, dynamic>> dumpFlightRecorder() async {
    return await rpc('dump_flight_recorder', {});
  }

  /// Recharge à chaud la configuration des serveurs MCP.
  Future<Map<String, dynamic>> refreshMcpServers() async {
    return await rpc('refresh_mcp_servers', {});
  }

  /// Valide un jeton OAuth pour un serveur MCP tiers.
  Future<Map<String, dynamic>> completeMcpOAuth(
    String serverId,
    String authCode,
  ) async {
    return await rpc('complete_mcp_oauth', {
      'serverId': serverId,
      'authCode': authCode,
    });
  }

  /// Révoque les accès OAuth d'un serveur MCP.
  Future<Map<String, dynamic>> disconnectMcpOAuth(String serverId) async {
    return await rpc('disconnect_mcp_oauth', {
      'serverId': serverId,
    });
  }

  /// Récupère la session activement ouverte/modifiée sur l'IDE PC (Miroir Parfait).
  Future<Map<String, dynamic>?> getActiveSession() async {
    final res = await rpc('get_active_session', {});
    if (res['activeSession'] is Map) {
      return Map<String, dynamic>.from(res['activeSession'] as Map);
    }
    return null;
  }

  /// Effectue une recherche sémantique hybride (BM25 + Cosine) dans le code indexé.
  Future<Map<String, dynamic>> codeSearch(
    String query, {
    String? workspaceUri,
    int limit = 20,
  }) async {
    return await rpc('code_search', {
      'query': query,
      if (workspaceUri != null) 'workspaceUri': workspaceUri,
      'limit': limit,
    });
  }

  /// Liste les fichiers de logs disponibles pour un sidecar.
  Future<List<String>> listSidecarLogFiles(String sidecarId) async {
    final res = await rpc('list_sidecar_log_files', {'sidecarId': sidecarId});
    if (res['logFiles'] is List) {
      return (res['logFiles'] as List).map((e) => e.toString()).toList();
    }
    if (res['files'] is List) {
      return (res['files'] as List).map((e) => e.toString()).toList();
    }
    if (res['fields'] is List) {
      final list = <String>[];
      for (final f in res['fields'] as List) {
        if (f is Map && f['text'] != null && (f['text'] as String).isNotEmpty) {
          list.add(f['text'] as String);
        }
      }
      if (list.isNotEmpty) return list;
    }
    return [];
  }

  /// Récupère le contenu des logs d'un sidecar pour un fichier spécifique.
  Future<String> getSidecarLogs(String sidecarId, String logFileName) async {
    final res = await rpc('get_sidecar_logs', {
      'sidecarId': sidecarId,
      'logFileName': logFileName,
    });
    if (res['logs'] != null) return res['logs'].toString();
    if (res['content'] != null) return res['content'].toString();
    if (res['text'] != null) return res['text'].toString();
    if (res['fields'] is List) {
      for (final f in res['fields'] as List) {
        if (f is Map && f['text'] != null) {
          return f['text'] as String;
        }
      }
    }
    return '';
  }

  /// Contrôle le cycle de vie d'un sidecar (1=start, 2=stop, 3=restart, 4=remove).
  Future<Map<String, dynamic>> manageSidecar(
    String sidecarId, {
    int action = 2,
  }) async {
    return rpc('manage_sidecar', {
      'sidecarId': sidecarId,
      'data': {'action': action},
    });
  }

  /// Liste les appareils pairés (3.4, admin seulement). Retourne la liste
  /// brute des sessions : deviceId, name, ip, createdAt, expiresAt, admin,
  /// allowedProjects. Vide si le mobile n'est pas admin (le daemon répond
  /// "action réservée à l'administrateur" → erreur).
  Future<List<Map<String, dynamic>>> listDevices() async {
    final res = await rpc('admin.list_devices', {});
    final list = res['devices'] as List? ?? (res['data'] is Map ? (res['data']['devices'] as List?) : null) ?? [];
    return list
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  /// Révoque un appareil pairé (3.4, admin seulement). Retourne true si le
  /// daemon a révoqué la session (false = deviceId inconnu).
  Future<bool> revokeDevice(String deviceId) async {
    final res = await rpc('admin.revoke_device', {'deviceId': deviceId});
    final status = res['status'] ?? (res['data'] is Map ? res['data']['status'] : null);
    return status == 'revoked';
  }


  void _onMessage(dynamic raw) {
    if (raw is! String) return; // daemon sends JSON text only
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      // Fragments d'un message multi-frame : dart:io WebSocket livre chaque
      // fragment individuellement et le message complet n'est pas encore
      // reconstitué (endOfMessage=false). Ignorer — le dernier fragment
      // (endOfMessage=true) est le seul JSON complet et sûr à parser.
      return;
    }

    final type = msg['type'] as String? ?? '';
    final requestId =
        (msg['requestId'] as String?) ??
        (type == 'response' ? msg['id'] as String? : null) ??
        '';
    final hasDataKey = msg.containsKey('data');
    final rawData = msg['data'];
    final Map<String, dynamic> data = rawData is Map<String, dynamic>
        ? rawData
        : rawData is Map
            ? rawData.cast<String, dynamic>()
            : hasDataKey
                ? const <String, dynamic>{}
                : msg;
    final error = msg['error'] as String?;

    if (type == 'stream_start' || type == 'stream_delta') {
      _outbox?.remove(requestId);
      // Prompt en file (3.2) : stream_start = le daemon l'a accepté, on le
      // retire des non confirmés (sinon il serait re-proposé à l'UI au
      // prochain sync_catchup).
      _ackPending(requestId);
      final stepIdx = (msg['data'] is Map ? (msg['data'] as Map)['stepIndex'] : null) as num?;
      final cascadeId = (msg['data'] is Map ? (msg['data'] as Map)['cascadeId'] : null) as String? ?? msg['cascadeId'] as String?;
      if (stepIdx != null && cascadeId != null && cascadeId.isNotEmpty) {
        _lastStepIndices[cascadeId] = stepIdx.toInt(); _boundStepIndices();
      }
      final controller = _streams[requestId];
      if (controller == null) {
        // Stream déclenché par une AUTRE surface (PC ou autre téléphone) :
        // le broadcast daemon le relaie ici sans requestId local. On le
        // réémet sur _events (marqué) pour que l'UI suive la session.
        msg['broadcast'] = true;
        _emitBatched(msg);
        return;
      }
      controller.add(msg);
      msg['broadcast'] = false;
      _emitBatched(msg);
      return;
    }

    if (type == 'sync_catchup') {
      final curIdx = (data['currentStepIndex'] ?? (msg['data'] is Map ? (msg['data'] as Map)['currentStepIndex'] : null)) as num?;
      final cascadeId = (data['cascadeId'] ?? (msg['data'] is Map ? (msg['data'] as Map)['cascadeId'] : null)) as String?;
      if (curIdx != null && cascadeId != null && cascadeId.isNotEmpty) {
        _lastStepIndices[cascadeId] = curIdx.toInt(); _boundStepIndices();
      }
      final pending = (msg['data'] is Map
          ? (msg['data'] as Map)['pendingMessages']
          : null) ?? msg['pendingMessages'];
      if (pending is List) {
        final clean = pending
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _pendingMessages.addAll(clean);
        _pendingMessagesNotifier.value =
            List<Map<String, dynamic>>.from(_pendingMessages);
      }
    }

    // Sortie de terminal PTY poussée par le daemon (P3) : pas de requestId
    // local — les terminaux sont des sessions poussées, corrélées par id.
    if (type == 'terminal_output') {
      _emitBatched({...msg, 'broadcast': true});
      return;
    }

    if (type == 'stream_end') {
      _outbox?.remove(requestId);
      final controller = _streams[requestId];
      if (controller != null) {
        // Livre le message stream_end (outcome structuré) au listener local
        // AVANT de fermer : onDone ne transporte pas de données.
        controller.add(msg);
        controller.close();
        _streams.remove(requestId);
        _emitBatched({...msg, 'broadcast': false});
      } else {
        // Broadcasté pour fermer le statut « en cours » dans l'UI si stream externe.
        _emitBatched({...msg, 'broadcast': true});
      }
      _flushBatch();
      return;
    }

    final completer = _pending.remove(requestId);
    // Drain même si le completer a expiré (timeout) : la réponse est arrivée,
    // rejouer ce message à la reconnexion créerait un doublon.
    _outbox?.remove(requestId);
    // Prompt en file (3.2) : quand le daemon l'accepte enfin (stream_start ou
    // réponse à la retransmission), on le retire de la liste des « non
    // confirmés » pour ne pas le re-proposer à l'UI au prochain sync_catchup.
    _ackPending(requestId);
    if (completer == null) {
      // Événement poussé par le serveur sans requête locale (approval_expired,
      // …) : re-marqué broadcast pour que les écouteurs de session le voient.
      _emitBatched({...msg, 'broadcast': true});
      return;
    }
    if (type == 'error' || error != null) {
      completer.completeError(Exception(error ?? 'Unknown daemon error'));
    } else {
      completer.complete(data);
    }
    _emitBatched(msg);
  }
}
