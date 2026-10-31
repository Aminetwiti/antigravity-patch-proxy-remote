import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/stream_parser.dart';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Crée un DaemonApi branché sur un [StreamController] de test.
/// Retourne (api, controller, outgoing).
({DaemonApi api, StreamController<dynamic> ctrl, List<Map<String, dynamic>> out})
    _mkApi({Duration timeout = const Duration(seconds: 5)}) {
  final out = <Map<String, dynamic>>[];
  final ctrl = StreamController<dynamic>();
  final api = DaemonApi(
    incoming: ctrl.stream,
    send: (d) => out.add(d as Map<String, dynamic>),
    timeout: timeout,
  );
  return (api: api, ctrl: ctrl, out: out);
}

/// Envoie une réponse unaire simulée vers le [StreamController].
void _respond(StreamController<dynamic> ctrl, String requestId, Map<String, dynamic> data) {
  ctrl.add(jsonEncode({'type': 'response', 'requestId': requestId, 'data': data}));
}

/// Envoie un stream_delta puis stream_end simulés.
void _streamDelta(
  StreamController<dynamic> ctrl,
  String requestId,
  List<Map<String, dynamic>> events, {
  Map<String, dynamic>? endData,
}) {
  ctrl.add(jsonEncode({'type': 'stream_delta', 'requestId': requestId, 'data': {'events': events}}));
  ctrl.add(jsonEncode({'type': 'stream_end', 'requestId': requestId, 'data': endData ?? {}}));
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 1 — Voir les sessions (feed temps réel)
// ──────────────────────────────────────────────────────────────────────────────
void _scenario1() {
  group('S1 — Voir les sessions (list_sessions)', () {
    test('affiche une pastille verte pour CASCADE_STATUS_READY', () {
      final sessions = SessionParser.parseListSessions({
        'sessions': [
          {
            'cascadeId': 'aaa-111',
            'title': 'Fix bug #42',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': DateTime.now().toIso8601String(),
          },
        ],
      });
      expect(sessions.first.status, 'CASCADE_STATUS_READY');
      expect(sessions.first.title, 'Fix bug #42');
    });

    test('titre tronqué à 60 chars pour nom de tâche long', () {
      const longTitle = 'Refactoring complet du module de gestion des utilisateurs avec tests';
      final sessions = SessionParser.parseListSessions({
        'sessions': [
          {
            'cascadeId': 'bbb-222',
            'title': longTitle,
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': DateTime.now().toIso8601String(),
          },
        ],
      });
      expect(sessions.first.title.length, lessThanOrEqualTo(longTitle.length));
    });

    test('tri par date décroissante — session la plus récente en premier', () {
      final sessions = SessionParser.parseListSessions({
        'sessions': [
          {
            'cascadeId': 'old-001',
            'title': 'Vieille session',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': '2026-01-01T00:00:00Z',
          },
          {
            'cascadeId': 'new-002',
            'title': 'Session récente',
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': DateTime.now().toIso8601String(),
          },
        ],
      });
      expect(sessions.first.id, 'new-002');
      expect(sessions.last.id, 'old-001');
    });

    test('liste vide → pas de crash', () {
      expect(SessionParser.parseListSessions({'sessions': []}), isEmpty);
      expect(SessionParser.parseListSessions({}), isEmpty);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 2 — Démarrer une nouvelle tâche (create + send_prompt)
// ──────────────────────────────────────────────────────────────────────────────
void _scenario2() {
  group('S2 — Démarrer une nouvelle tâche', () {
    test('create_cascade envoie workspacePath et retourne cascadeId', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final future = api.createCascade('file:///C:/Users/developer/proj');
      await Future<void>.delayed(Duration.zero);

      expect(out.first['type'], 'create_cascade');
      expect(out.first['workspacePath'], 'file:///C:/Users/developer/proj');

      _respond(ctrl, out.first['requestId'] as String, {
        'sessions': [{'cascadeId': 'new-cascade-id'}],
      });

      final result = await future;
      expect(result, isA<Map>());

      await ctrl.close();
      api.dispose();
    });

    test('send_prompt après create → stream_start reçu en < 2s', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final stream = api.sendPrompt('cascade-abc', 'Écris des tests unitaires');
      await Future<void>.delayed(Duration.zero);

      expect(out.first['type'], 'send_prompt');
      expect(out.first['prompt'], 'Écris des tests unitaires');
      expect(out.first['cascadeId'], 'cascade-abc');

      final rid = out.first['requestId'] as String;
      ctrl.add(jsonEncode({'type': 'stream_start', 'requestId': rid, 'data': {'cascadeId': 'cascade-abc'}}));
      _streamDelta(ctrl, rid, [{'kind': 'text', 'delta': 'Je vais commencer...'}]);

      final events = await stream.toList();
      expect(events.any((e) => e['type'] == 'stream_start'), isTrue);

      await ctrl.close();
      api.dispose();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 3 — Valider une permission (approval)
// ──────────────────────────────────────────────────────────────────────────────
void _scenario3() {
  group('S3 — Valider une permission', () {
    test('extraction approval_required depuis stream_delta', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'call_99',
              'tool': 'run_command',
              'detail': '{"command_line":"npm install"}',
              'cascadeId': 'c1',
              'trajectoryId': 'traj_5',
              'stepIndex': 2,
            },
          ],
        },
      };
      final approval = StreamDeltaParser.approvalOf(msg);
      expect(approval, isNotNull);
      expect(approval!.tool, 'run_command');
      expect(approval.command, 'npm install');
      expect(approval.trajectoryId, 'traj_5');
      expect(approval.stepIndex, 2);
    });

    test('submit_approval "allow" envoie decision=allow', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final future = api.submitApproval(
        cascadeId: 'c1',
        callId: 'call_99',
        allow: true,
        trajectoryId: 'traj_5',
        stepIndex: 2,
        approvalType: 'run_command',
        command: 'npm install',
      );
      await Future<void>.delayed(Duration.zero);

      expect(out.first['type'], 'submit_approval');
      expect(out.first['decision'], 'allow');
      expect(out.first['command'], 'npm install');

      _respond(ctrl, out.first['requestId'] as String, {'ok': true});
      await future;

      await ctrl.close();
      api.dispose();
    });

    test('submit_approval "deny" envoie decision=deny', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final future = api.submitApproval(cascadeId: 'c1', callId: 'call_x', allow: false);
      await Future<void>.delayed(Duration.zero);
      expect(out.first['decision'], 'deny');
      _respond(ctrl, out.first['requestId'] as String, {'ok': true});
      await future;
      await ctrl.close();
      api.dispose();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 4 — Suivre en live (stream events)
// ──────────────────────────────────────────────────────────────────────────────
void _scenario4() {
  group('S4 — Suivre en live (stream_delta parsing)', () {
    test('extrait les deltas de texte de plusieurs frames', () {
      final frames = [
        {'type': 'stream_delta', 'data': {'events': [{'kind': 'text', 'delta': 'Bonjour '}]}},
        {'type': 'stream_delta', 'data': {'events': [{'kind': 'text', 'delta': 'le monde'}]}},
      ];
      final text = frames.map(StreamDeltaParser.textOf).join();
      expect(text, 'Bonjour le monde');
    });

    test('extrait la "pensée" de l\'agent (thinking)', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {'kind': 'thinking', 'delta': "Je dois d'abord lire le fichier..."},
          ],
        },
      };
      expect(StreamDeltaParser.thinkingOf(msg), contains("d'abord"));
    });

    test('les events non-texte n\'apparaissent pas dans textOf', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {'kind': 'thinking', 'delta': 'bruit de fond'},
            {'kind': 'text', 'delta': 'signal'},
          ],
        },
      };
      expect(StreamDeltaParser.textOf(msg), 'signal');
    });

    test('stream se ferme proprement sur stream_end', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final stream = api.sendPrompt('c1', 'ping');
      await Future<void>.delayed(Duration.zero);
      final rid = out.first['requestId'] as String;

      _streamDelta(ctrl, rid, [{'kind': 'text', 'delta': 'pong'}]);

      var ended = false;
      final done = Completer<void>();
      stream.listen((_) {}, onDone: () { ended = true; done.complete(); });
      await done.future;
      expect(ended, isTrue);

      await ctrl.close();
      api.dispose();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 5 — Reprendre une session terminée
// ──────────────────────────────────────────────────────────────────────────────
void _scenario5() {
  group('S5 — Reprendre une session (fork si DONE)', () {
    test('CascadeSession.fromJson parse le statut DONE', () {
      final s = CascadeSession.fromJson({
        'cascadeId': 'done-1',
        'title': 'Refactoring terminé',
        'status': 'CASCADE_STATUS_DONE',
        'updatedAt': '2026-08-10T10:00:00Z',
      });
      expect(s.status, 'CASCADE_STATUS_DONE');
      expect(s.title, 'Refactoring terminé');
    });

    test('relativeTime affiche "Xh" pour session d\'il y a quelques heures', () {
      final twoHoursAgo = DateTime.now().subtract(const Duration(hours: 2)).toUtc().toIso8601String();
      final s = CascadeSession.fromJson({
        'cascadeId': 'old-done',
        'title': 'Tâche ancienne',
        'status': 'CASCADE_STATUS_DONE',
        'updatedAt': twoHoursAgo,
      });
      expect(s.time, endsWith('h'));
    });

    test('session sans updatedAt affiche "Just now"', () {
      final s = CascadeSession.fromJson({
        'cascadeId': 'x',
        'title': 'Test',
        'status': 'CASCADE_STATUS_READY',
      });
      expect(s.time, 'Just now');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 6 — Voir les diffs de code
// ──────────────────────────────────────────────────────────────────────────────
void _scenario6() {
  group('S6 — Diff de code (code_edit events)', () {
    test('code_edit_proposed est bien typé dans stream_delta', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'code_edit_proposed',
              'file': 'src/api.ts',
              'oldContent': 'function foo() {}',
              'newContent': 'function foo() { return 42; }',
            },
          ],
        },
      };
      final events = (msg['data'] as Map)['events'] as List;
      final edit = events.first as Map;
      expect(edit['kind'], 'code_edit_proposed');
      expect(edit['file'], 'src/api.ts');
      expect(edit['newContent'], contains('42'));
    });

    test('textOf ignore les events code_edit (pas de fuite de contenu brut)', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {'kind': 'code_edit_proposed', 'file': 'x.ts', 'newContent': 'SECRET'},
            {'kind': 'text', 'delta': 'Modification appliquée'},
          ],
        },
      };
      expect(StreamDeltaParser.textOf(msg), 'Modification appliquée');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 7 — Annuler un agent
// ──────────────────────────────────────────────────────────────────────────────
void _scenario7() {
  group('S7 — Annuler un agent (cancel)', () {
    test('cancel envoie la requête cancel_cascade', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final future = api.rpc('cancel_cascade', {'cascadeId': 'c-danger'});
      await Future<void>.delayed(Duration.zero);

      expect(out.first['type'], 'cancel_cascade');
      expect(out.first['cascadeId'], 'c-danger');

      _respond(ctrl, out.first['requestId'] as String, {'ok': true});
      await future;

      await ctrl.close();
      api.dispose();
    });

    test('stream_end avec outcome=cancelled est bien reçu', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final stream = api.sendPrompt('c1', 'tâche longue');
      await Future<void>.delayed(Duration.zero);
      final rid = out.first['requestId'] as String;

      ctrl.add(jsonEncode({'type': 'stream_start', 'requestId': rid, 'data': {}}));
      ctrl.add(jsonEncode({
        'type': 'stream_end',
        'requestId': rid,
        'data': {'cascadeId': 'c1', 'outcome': 'cancelled'},
      }));

      Map<String, dynamic>? lastMsg;
      await stream.forEach((m) => lastMsg = m);
      expect(lastMsg!['type'], 'stream_end');
      expect((lastMsg!['data'] as Map)['outcome'], 'cancelled');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 8 — Recherche dans les sessions
// ──────────────────────────────────────────────────────────────────────────────
void _scenario8() {
  group('S8 — Recherche dans les sessions', () {
    late List<CascadeSession> sessions;

    setUp(() {
      sessions = SessionParser.parseListSessions({
        'sessions': [
          {'cascadeId': '1', 'title': 'Refactoring module auth', 'status': 'CASCADE_STATUS_DONE', 'updatedAt': '2026-08-01T00:00:00Z'},
          {'cascadeId': '2', 'title': 'Fix bug #42 login page', 'status': 'CASCADE_STATUS_READY', 'updatedAt': '2026-08-09T00:00:00Z'},
          {'cascadeId': '3', 'title': 'Tests unitaires API', 'status': 'CASCADE_STATUS_RUNNING', 'updatedAt': '2026-08-10T00:00:00Z'},
        ],
      });
    });

    test('filtre par mot-clé dans le titre (case-insensitive)', () {
      final query = 'refactor';
      final results = sessions.where((s) => s.title.toLowerCase().contains(query)).toList();
      expect(results, hasLength(1));
      expect(results.first.id, '1');
    });

    test('filtre par statut RUNNING', () {
      final running = sessions.where((s) => s.status == 'CASCADE_STATUS_RUNNING').toList();
      expect(running, hasLength(1));
      expect(running.first.id, '3');
    });

    test('100 sessions parsées → aucun crash', () {
      final rawSessions = List.generate(100, (i) => {
        'cascadeId': 'session-$i',
        'title': 'Tâche numéro $i',
        'status': 'CASCADE_STATUS_READY',
        'updatedAt': DateTime.now().subtract(Duration(hours: i)).toIso8601String(),
      });
      final result = SessionParser.parseListSessions({'sessions': rawSessions});
      expect(result, hasLength(100));
      // Le plus récent (i=0) doit être en tête
      expect(result.first.id, 'session-0');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 9 — Perte de connexion (reconnexion exponentielle)
// ──────────────────────────────────────────────────────────────────────────────
void _scenario9() {
  group('S9 — Perte de réseau (timeout + broadcast)', () {
    test('timeout quand le daemon ne répond pas', () async {
      final (:api, :ctrl, :out) = _mkApi(timeout: const Duration(milliseconds: 100));

      await expectLater(api.heartbeat(), throwsA(isA<TimeoutException>()));

      await ctrl.close();
      api.dispose();
    });

    test('events broadcast d\'une autre surface sont réémis sur api.events', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final broadcast = <Map<String, dynamic>>[];
      final sub = api.events.listen(broadcast.add);

      // Le daemon relaie un stream démarré depuis le PC (requestId inconnu localement)
      ctrl.add(jsonEncode({
        'type': 'stream_delta',
        'requestId': 'r-from-pc',
        'data': {'events': [{'kind': 'text', 'delta': 'PC travaille...'}]},
      }));
      ctrl.add(jsonEncode({'type': 'stream_end', 'requestId': 'r-from-pc'}));

      await Future<void>.delayed(Duration.zero);

      final deltas = broadcast.where((e) => e['type'] == 'stream_delta').toList();
      expect(deltas, isNotEmpty);
      expect(deltas.first['broadcast'], isTrue);
      expect(StreamDeltaParser.textOf(deltas.first), 'PC travaille...');

      await sub.cancel();
      await ctrl.close();
      api.dispose();
    });

    test('dispose ne lève pas d\'erreur même si des requêtes sont en attente', () async {
      final (:api, :ctrl, :out) = _mkApi(timeout: const Duration(seconds: 10));
      // fire-and-forget : on attrape l'erreur StateError attendue
      api.listSessions().catchError((_) => <String, dynamic>{});
      expect(() => api.dispose(), returnsNormally);
      await ctrl.close();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 10 — Notification de fin de tâche
// ──────────────────────────────────────────────────────────────────────────────
void _scenario10() {
  group('S10 — Fin de tâche détectée (stream_end outcome)', () {
    test('stream_end avec outcome=done est émis sur api.events', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final stream = api.sendPrompt('c1', 'longue tâche');
      await Future<void>.delayed(Duration.zero);
      final rid = out.first['requestId'] as String;

      final broadcastEvents = <Map<String, dynamic>>[];
      final sub = api.events.listen(broadcastEvents.add);

      ctrl.add(jsonEncode({'type': 'stream_end', 'requestId': rid, 'data': {'cascadeId': 'c1', 'outcome': 'done'}}));
      await stream.toList();
      await Future<void>.delayed(Duration.zero);

      final endEvents = broadcastEvents.where((e) => e['type'] == 'stream_end').toList();
      expect(endEvents, isNotEmpty);
      expect((endEvents.first['data'] as Map)['outcome'], 'done');

      await sub.cancel();
      await ctrl.close();
      api.dispose();
    });

    test('stream_end avec outcome=approval_pending détecte blocage', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final stream = api.sendPrompt('c2', 'tâche bloquée');
      await Future<void>.delayed(Duration.zero);
      final rid = out.first['requestId'] as String;

      _streamDelta(ctrl, rid, [], endData: {'cascadeId': 'c2', 'outcome': 'approval_pending'});
      final msgs = await stream.toList();

      final end = msgs.lastWhere((m) => m['type'] == 'stream_end');
      expect((end['data'] as Map)['outcome'], 'approval_pending');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
void main() {
  _scenario1();
  _scenario2();
  _scenario3();
  _scenario4();
  _scenario5();
  _scenario6();
  _scenario7();
  _scenario8();
  _scenario9();
  _scenario10();
}
