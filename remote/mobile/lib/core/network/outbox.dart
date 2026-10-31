import 'dart:async';

/// Étape 5 — Re-sync offline-first : outbox des messages non délivrés.
///
/// Quand le WebSocket coupe pendant un `send_prompt` (ou un appel unary),
/// le message partant est mis en attente ici. À la reconnexion, la queue est
/// rejouée dans l'ordre — le daemon envoie ensuite `list_sessions` + les
/// streams relancés — et les doublons sont évités côté serveur par requestId
/// (le mobile garde les requestId rejoués pour ne pas relancer deux fois un
/// prompt déjà arrivé).
///
/// `ponytail:` plafond — on ne persiste pas l'outbox sur disque : si l'app est
/// tuée, la queue est perdue (l'utilisateur revoit simplement le prompt dans
/// l'historique). Chemin d'upgrade : serializer l'outbox dans shared_preferences
/// et la rejouer à froid au démarrage.
class OutboxQueue {
  // P3 (mémoire) : les sets de dedup ne doivent pas croître à vie — au-delà
  // de [_maxIdMemory] entrées, les plus anciens sont évacués (FIFO). Un
  // requestId évacué après ce délai ne peut plus être rejoué en doublon : la
  // queue elle-même expire après [_maxAge] (5 min), très en-deçà du plafond.
  static const int _maxIdMemory = 1024;

  final List<Map<String, dynamic>> _pending = [];
  final Set<String> _replayedRequestIds = {};
  final Set<String> _drainedRequestIds = {};
  final Duration _maxAge;

  OutboxQueue({Duration maxAge = const Duration(minutes: 5)}) : _maxAge = maxAge;

  void _rememberId(Set<String> ids, String requestId) {
    if (requestId.isEmpty) return;
    ids.add(requestId);
    while (ids.length > _maxIdMemory) {
      ids.remove(ids.first);
    }
  }

  bool get hasPending {
    takeExpired();
    return _pending.isNotEmpty;
  }

  int get pendingCount {
    takeExpired();
    return _pending.length;
  }

  void enqueue(Map<String, dynamic> message) {
    _pending.add({
      ...message,
      'queuedAt': DateTime.now().toIso8601String(),
    });
  }

  void remove(String requestId) {
    _rememberId(_drainedRequestIds, requestId);
    _pending.removeWhere((m) => m['requestId'] == requestId);
  }

  void markReplayed(String requestId) {
    _rememberId(_replayedRequestIds, requestId);
  }

  /// La queue rejouée doit ignorer les requestId qui ont déjà été drainés
  /// (réponse reçue avant la coupe) ou déjà rejoués — le daemon n'a pas de
  /// queue, rejouer deux fois = prompt exécuté deux fois.
  bool shouldSkip(String requestId) =>
      _drainedRequestIds.contains(requestId) ||
      _replayedRequestIds.contains(requestId);

  List<Map<String, dynamic>> takeExpired() {
    final cutoff = DateTime.now().subtract(_maxAge);
    final expired = _pending
        .where((m) {
          final t = DateTime.tryParse(m['queuedAt'] as String? ?? '');
          return t == null || t.isBefore(cutoff);
        })
        .toList();
    if (expired.isNotEmpty) {
      final expiredSet = expired.toSet();
      _pending.removeWhere((m) => expiredSet.contains(m));
    }
    return expired;
  }

  void clear() {
    _pending.clear();
    _replayedRequestIds.clear();
    _drainedRequestIds.clear();
  }

  List<Map<String, dynamic>> snapshot() => List.unmodifiable(_pending);
}

/// Rejoueur d'outbox branché sur [DaemonApi] : au premier envoi, si le socket
/// est coupé, le message est mis en file. À la (re)connexion, la file est
/// rejouée dans l'ordre, puis `list_sessions` est relancé pour re-synchroniser
/// l'état (Étape 5).
class OutboxReplayer {
  final OutboxQueue _queue;
  final void Function(Map<String, dynamic>) _send;
  final Future<Map<String, dynamic>> Function() _resync;
  bool _flushing = false;

  OutboxReplayer({
    required OutboxQueue queue,
    required void Function(Map<String, dynamic>) send,
    required Future<Map<String, dynamic>> Function() resync,
  })  : _queue = queue,
        _send = send,
        _resync = resync;

  void onReconnect() {
    if (_flushing) return;
    _flushing = true;
    unawaited(_flush().whenComplete(() => _flushing = false));
  }

  Future<void> _flush() async {
    final batch = _queue.snapshot();
    for (final msg in batch) {
      final requestId = msg['requestId'] as String? ?? '';
      if (requestId == '' || _queue.shouldSkip(requestId)) {
        if (requestId != '') _queue.remove(requestId);
        continue;
      }
      _queue.markReplayed(requestId);
      _send(msg);
      _queue.remove(requestId);
    }
    try {
      await _resync(); // list_sessions → état complet rejoué côté UI
    } catch (_) {
      // le daemon n'est pas prêt — la prochaine reconnexion rejouera
    }
  }
}
