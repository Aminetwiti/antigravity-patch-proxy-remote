import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show ValueNotifier;
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/outbox.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/stream_parser.dart';

// ──────────────────────────────────────────────────────────────────────────────
// 20 scénarios avancés : bugs, problèmes et conflits réels du protocole.
//   A1–A8   → conflits de concurrence (streams, broadcast, cancel, dispose)
//   A9–A11  → outbox offline-first (double replay, expiration, timeout)
//   A12–A20 → résilience aux données corrompues / inattendues
// ──────────────────────────────────────────────────────────────────────────────

({DaemonApi api, StreamController<dynamic> ctrl, List<Map<String, dynamic>> out})
    _mkApi({Duration timeout = const Duration(seconds: 5), OutboxQueue? outbox}) {
  final out = <Map<String, dynamic>>[];
  final ctrl = StreamController<dynamic>();
  final api = DaemonApi(
    incoming: ctrl.stream,
    send: (d) => out.add(d as Map<String, dynamic>),
    timeout: timeout,
    outbox: outbox,
  );
  return (api: api, ctrl: ctrl, out: out);
}

void _respond(StreamController<dynamic> ctrl, String requestId, Map<String, dynamic> data) {
  ctrl.add(jsonEncode({'type': 'response', 'requestId': requestId, 'data': data}));
}

void _delta(StreamController<dynamic> ctrl, String requestId, List<Map<String, dynamic>> events) {
  ctrl.add(jsonEncode({'type': 'stream_delta', 'requestId': requestId, 'data': {'events': events}}));
}

void _end(StreamController<dynamic> ctrl, String requestId, [Map<String, dynamic>? data]) {
  ctrl.add(jsonEncode({'type': 'stream_end', 'requestId': requestId, 'data': data ?? {}}));
}

// ══════════════════════════════════════════════════════════════════════════════
// A1 — CONFLIT : deux prompts simultanés sur la MÊME cascade
// ══════════════════════════════════════════════════════════════════════════════
void _a1() {
  group('A1 — Conflit : deux prompts simultanés sur la même cascade', () {
    test('chaque stream ne reçoit QUE ses propres frames (isolation requestId)', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final s1 = api.sendPrompt('c1', 'prompt A');
      final s2 = api.sendPrompt('c1', 'prompt B');
      await Future<void>.delayed(Duration.zero);

      expect(out, hasLength(2));
      final id1 = out[0]['requestId'] as String;
      final id2 = out[1]['requestId'] as String;
      expect(id1, isNot(id2));

      final got1 = <String>[];
      final got2 = <String>[];
      final done1 = Completer<void>();
      final done2 = Completer<void>();
      s1.listen((m) => got1.add(StreamDeltaParser.textOf(m)), onDone: done1.complete);
      s2.listen((m) => got2.add(StreamDeltaParser.textOf(m)), onDone: done2.complete);

      // Frames CROISÉES (désordre) pour piéger les buffers partagés.
      _delta(ctrl, id2, [{'kind': 'text', 'delta': 'B1'}]);
      _delta(ctrl, id1, [{'kind': 'text', 'delta': 'A1'}]);
      _delta(ctrl, id1, [{'kind': 'text', 'delta': 'A2'}]);
      _end(ctrl, id1);
      _end(ctrl, id2);

      await done1.future;
      await done2.future;
      expect(got1.join(), 'A1A2');
      expect(got2.join(), 'B1');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A2 — BUG : réponse tardive (après timeout) — ne doit ni crasher ni réveiller
// ══════════════════════════════════════════════════════════════════════════════
void _a2() {
  group('A2 — Bug : réponse tardive après timeout', () {
    test('une response avec un requestId expiré ne lève pas d\'erreur', () async {
      final (:api, :ctrl, :out) = _mkApi(timeout: const Duration(milliseconds: 100));

      final future = api.listSessions().catchError((_) => <String, dynamic>{});
      await expectLater(api.heartbeat(), throwsA(isA<TimeoutException>()));

      // La réponse arrive APRÈS le timeout — ne doit ni crasher ni résoudre.
      final id = out.first['requestId'] as String;
      _respond(ctrl, id, {'sessions': []});
      await future;

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A3 — CONFLIT : broadcast d'une autre surface (PC) mélangé au stream local
// ══════════════════════════════════════════════════════════════════════════════
void _a3() {
  group('A3 — Conflit : broadcast externe mélangé au stream local', () {
    test('les frames externes (requestId inconnu) ne polluent pas le stream local', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final s = api.sendPrompt('c1', 'local');
      await Future<void>.delayed(Duration.zero);
      final localId = out.first['requestId'] as String;

      final localFrames = <String>[];
      final external = <Map<String, dynamic>>[];
      final subExt = api.events.where((e) => e['broadcast'] == true).listen(external.add);
      final done = Completer<void>();
      s.listen((m) => localFrames.add(StreamDeltaParser.textOf(m)), onDone: done.complete);

      // Frame du PC (autre surface)
      _delta(ctrl, 'r-external', [{'kind': 'text', 'delta': 'PC: refactoring...'}]);
      // Frame locale
      _delta(ctrl, localId, [{'kind': 'text', 'delta': 'mobile: réponse'}]);
      _end(ctrl, localId);

      await done.future;
      expect(localFrames.join(), 'mobile: réponse');
      expect(localFrames.join(), isNot(contains('PC')));
      // Fenêtre de batch 100 ms (UX) : attendre le flush du broadcast.
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(external, isNotEmpty);
      expect(StreamDeltaParser.textOf(external.first), 'PC: refactoring...');

      await subExt.cancel();
      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A4 — BUG : stream_end manquant → stream orphelin (fuite bornée, pas de crash)
// ══════════════════════════════════════════════════════════════════════════════
void _a4() {
  group('A4 — Bug : stream_end manquant (stream orphelin)', () {
    test('un stream sans stream_end reste ouvert sans crasher', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final s = api.sendPrompt('c1', 'prompt');
      await Future<void>.delayed(Duration.zero);

      var done = false;
      s.listen((_) {}, onDone: () => done = true);

      // stream_start arrive, puis plus rien (daemon mort silencieusement).
      final id = out.first['requestId'] as String;
      ctrl.add(jsonEncode({'type': 'stream_start', 'requestId': id, 'data': {}}));
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(done, isFalse, reason: 'le stream doit rester ouvert en attendant stream_end');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A5 — BUG : frames malformées (JSON invalide, mauvais types) ignorées
// ══════════════════════════════════════════════════════════════════════════════
void _a5() {
  group('A5 — Bug : frames malformées', () {
    test('JSON invalide et types non-string sont ignorés, l\'API reste fonctionnelle', () async {
      final (:api, :ctrl, :out) = _mkApi();

      final future = api.listSessions();
      await Future<void>.delayed(Duration.zero);
      final id = out.first['requestId'] as String;

      ctrl.add('not json {{{');
      ctrl.add(12345);
      ctrl.add(null);
      ctrl.add(jsonEncode({'type': 'response'})); // sans requestId

      _respond(ctrl, id, {'sessions': []});
      final result = await future;
      expect(result, isA<Map>());

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A6 — BUG : event kind inconnu (compatibilité forward avec le daemon)
// ══════════════════════════════════════════════════════════════════════════════
void _a6() {
  group('A6 — Bug : event kind inconnu', () {
    test('un kind futur (ex: telepathy) est ignoré sans crash', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {'kind': 'telepathy', 'delta': 'bzzz'},
            {'kind': 'text', 'delta': 'réponse normale'},
          ],
        },
      };
      expect(StreamDeltaParser.textOf(msg), 'réponse normale');
      expect(StreamDeltaParser.thinkingOf(msg), isEmpty);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A7 — CONFLIT : approbations de cascades différentes en parallèle
// ══════════════════════════════════════════════════════════════════════════════
void _a7() {
  group('A7 — Conflit : approbations multi-cascades', () {
    test('chaque delta porte l\'approbation de SA cascade (pas de mélange)', () {
      final m1 = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'call-a',
              'tool': 'run_command',
              'detail': '{"command_line":"rm -rf build"}',
              'cascadeId': 'cascade-A',
              'trajectoryId': 't1',
              'stepIndex': 0,
            },
          ],
        },
      };
      final m2 = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'call-b',
              'tool': 'run_command',
              'detail': '{"command_line":"git push"}',
              'cascadeId': 'cascade-B',
              'trajectoryId': 't2',
              'stepIndex': 1,
            },
          ],
        },
      };
      final a1 = StreamDeltaParser.approvalOf(m1)!;
      final a2 = StreamDeltaParser.approvalOf(m2)!;
      expect(a1.cascadeId, 'cascade-A');
      expect(a1.command, 'rm -rf build');
      expect(a2.cascadeId, 'cascade-B');
      expect(a2.command, 'git push');
      expect(a1.cascadeId == a2.cascadeId, isFalse,
          reason: 'la décision allow d\'un mobile doit cibler la bonne cascade');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A8 — CONFLIT : cancel pendant un stream actif (deltas encore en vol)
// ══════════════════════════════════════════════════════════════════════════════
void _a8() {
  group('A8 — Conflit : cancel pendant un stream actif', () {
    test('cancel + deltas entrelacés + stream_end cancelled = fin propre', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final s = api.sendPrompt('c1', 'longue tâche');
      await Future<void>.delayed(Duration.zero);
      final sid = out[0]['requestId'] as String;

      final msgs = <Map<String, dynamic>>[];
      final done = Completer<void>();
      s.listen(msgs.add, onDone: done.complete);

      _delta(ctrl, sid, [{'kind': 'text', 'delta': 'première étape'}]);
      // L'utilisateur annule pendant que les deltas continuent d'arriver.
      final cancelFuture = api.rpc('cancel_cascade', {'cascadeId': 'c1'});
      await Future<void>.delayed(Duration.zero);
      _respond(ctrl, out[1]['requestId'] as String, {'ok': true});
      await cancelFuture;

      _delta(ctrl, sid, [{'kind': 'text', 'delta': 'dernière frame'}]);
      _end(ctrl, sid, {'cascadeId': 'c1', 'outcome': 'cancelled'});
      await done.future;

      final ends = msgs.where((m) => m['type'] == 'stream_end').toList();
      expect(ends, hasLength(1));
      expect((ends.first['data'] as Map)['outcome'], 'cancelled');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A9 — BUG : double replay de l'outbox (drainé OU déjà rejoué → jamais renvoyé)
// ══════════════════════════════════════════════════════════════════════════════
void _a9() {
  group('A9 — Bug : double replay outbox', () {
    test('shouldSkip ignore les messages drainés ET déjà rejoués', () {
      final q = OutboxQueue();
      q.enqueue({'requestId': 'r1'});
      q.enqueue({'requestId': 'r2'});
      q.enqueue({'requestId': 'r3'});

      q.remove('r1'); // drainé (réponse reçue avant la coupe)
      q.markReplayed('r2'); // déjà rejoué

      expect(q.shouldSkip('r1'), isTrue);
      expect(q.shouldSkip('r2'), isTrue);
      expect(q.shouldSkip('r3'), isFalse);
      expect(q.pendingCount, 2);
    });

    test('le replayer ne renvoie pas un message déjà drainé', () async {
      final q = OutboxQueue();
      final sent = <Map<String, dynamic>>[];
      var resyncs = 0;

      final replayer = OutboxReplayer(
        queue: q,
        send: sent.add,
        resync: () async {
          resyncs++;
          return const {'ok': true};
        },
      );

      q.enqueue({'requestId': 'r1', 'type': 'send_prompt'});
      q.remove('r1'); // la réponse est arrivée avant la reconnexion

      replayer.onReconnect();
      await Future<void>.delayed(Duration.zero);

      expect(sent, isEmpty, reason: 'un message drainé ne doit JAMAIS être rejoué');
      expect(resyncs, 1);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A10 — BUG : expiration des messages périmés de l'outbox
// ══════════════════════════════════════════════════════════════════════════════
void _a10() {
  group('A10 — Bug : outbox expiration', () {
    test('takeExpired purge les messages plus vieux que maxAge', () {
      final q = OutboxQueue(maxAge: const Duration(seconds: -1)); // tout est périmé
      q.enqueue({'requestId': 'old-1'});
      q.enqueue({'requestId': 'old-2'});

      final expired = q.takeExpired();
      expect(expired, hasLength(2));
      expect(q.hasPending, isFalse);
      expect(q.pendingCount, 0);
    });

    test('un message récent n\'est pas expiré', () {
      final q = OutboxQueue(maxAge: const Duration(minutes: 5));
      q.enqueue({'requestId': 'fresh'});
      expect(q.takeExpired(), isEmpty);
      expect(q.pendingCount, 1);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A11 — CONFLIT : timeout unary vs outbox offline-first
//   Le message timeout HORS-LIGNE survit, est rejoué à la reconnexion,
//   puis DRAINÉ quand la réponse (même tardive) arrive.
// ══════════════════════════════════════════════════════════════════════════════
void _a11() {
  group('A11 — Conflit : timeout vs outbox (offline-first gagne)', () {
    test('requête timeout hors-ligne → rejouée à la reconnexion → drainée à la réponse', () async {
      final q = OutboxQueue();
      final out = <Map<String, dynamic>>[];
      final ctrl = StreamController<dynamic>();
      var online = false;

      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          if (online) out.add(d as Map<String, dynamic>);
        },
        timeout: const Duration(milliseconds: 50),
        outbox: q,
      );
      final version = ValueNotifier<int>(0);
      api.attachReconnect(version, () async => const {'ok': true});

      // Hors-ligne : le call timeout mais le message RESTE dans l'outbox.
      await expectLater(api.listSessions(), throwsA(isA<TimeoutException>()));
      expect(q.pendingCount, 1, reason: 'le message doit survivre au timeout pour être rejoué');

      // Reconnexion : replay + resync.
      online = true;
      version.value = 1;
      await Future<void>.delayed(Duration.zero);
      expect(out, hasLength(1));
      expect(out.first['type'], 'list_sessions');

      // Réponse tardive → drain : plus jamais rejoué (sinon doublon).
      _respond(ctrl, out.first['requestId'] as String, {'sessions': []});
      await Future<void>.delayed(Duration.zero);
      expect(q.pendingCount, 0, reason: 'la réponse doit drainer l\'outbox même après timeout');

      await ctrl.close();
      api.dispose();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A12 — BUG : session sans cascadeId (clé primaire manquante)
// ══════════════════════════════════════════════════════════════════════════════
void _a12() {
  group('A12 — Bug : session sans cascadeId', () {
    test('une entrée sans cascadeId est ignorée (pas de session inutilisable)', () {
      final sessions = SessionParser.parseListSessions({
        'sessions': [
          {'title': 'Orpheline sans id', 'status': 'CASCADE_STATUS_READY'},
          {'cascadeId': 'real-1', 'title': 'Session valide', 'status': 'CASCADE_STATUS_READY'},
        ],
      });
      expect(sessions, hasLength(1));
      expect(sessions.first.id, 'real-1');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A13 — BUG : workspacePath vide / absent
// ══════════════════════════════════════════════════════════════════════════════
void _a13() {
  group('A13 — Bug : workspacePath vide', () {
    test('une session sans workspace est affichée sans crash (titre conservé)', () {
      final s = CascadeSession.fromJson({
        'cascadeId': 'ws-empty',
        'title': 'Tâche sans workspace',
        'status': 'CASCADE_STATUS_RUNNING',
      });
      expect(s.workspacePath, '');
      expect(s.title, 'Tâche sans workspace');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A14 — BUG : titres avec emojis / caractères spéciaux
// ══════════════════════════════════════════════════════════════════════════════
void _a14() {
  group('A14 — Bug : titres emoji/caractères spéciaux', () {
    test('le titre préserve les emojis et n\'est pas tronqué brutalement', () {
      const title = '🚀 Déployer la v2 🎉 [ci] #42';
      final s = CascadeSession.fromJson({
        'cascadeId': 'emoji-1',
        'title': title,
        'status': 'CASCADE_STATUS_READY',
      });
      expect(s.title, title);
      expect(s.title.contains('🚀'), isTrue);
    });

    test('fallback legacy : le titre nettoyé ignore le préfixe JSON', () {
      final data = {
        'fields': [
          {
            'field': 1,
            'text': '{"trajectory":{"trajectoryId":"a1b2c3d4-1111-4a1a-9b2b-000000000001"}} 🚀 Déployer',
          },
        ],
      };
      final sessions = SessionParser.parseListSessions(data);
      expect(sessions, hasLength(1));
      expect(sessions.first.title, contains('Déployer'));
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A15 — BUG : clock skew (horloge décalée) → temps relatif négatif
// ══════════════════════════════════════════════════════════════════════════════
void _a15() {
  group('A15 — Bug : clock skew', () {
    test('updatedAt dans le futur → "Just now" (pas de temps négatif)', () {
      final future = DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String();
      final s = CascadeSession.fromJson({
        'cascadeId': 'skew-1',
        'title': 'Horloge décalée',
        'status': 'CASCADE_STATUS_READY',
        'updatedAt': future,
      });
      expect(s.time, 'Just now');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A16 — CONFLIT : 200 sessions mélangées → tri stable, pas de crash
// ══════════════════════════════════════════════════════════════════════════════
void _a16() {
  group('A16 — Conflit : 200 sessions', () {
    test('tri décroissant stable sur 200 entrées mélangées', () {
      final now = DateTime.now();
      final raw = List.generate(200, (i) {
        return {
          'cascadeId': 's-$i',
          'title': 'Tâche $i',
          'status': i.isEven ? 'CASCADE_STATUS_READY' : 'CASCADE_STATUS_DONE',
          'updatedAt': now.subtract(Duration(minutes: i * 3)).toUtc().toIso8601String(),
        };
      })..shuffle();

      final sessions = SessionParser.parseListSessions({'sessions': raw});
      expect(sessions, hasLength(200));
      // updatedAt strictement décroissant avec i → le tri doit rendre s-0..s-199.
      for (var i = 0; i < sessions.length; i++) {
        expect(sessions[i].id, 's-$i', reason: 'tri décroissant violé à l\'index $i');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A17 — BUG : commandes shell avec échappements (round-trip exact)
// ══════════════════════════════════════════════════════════════════════════════
void _a17() {
  group('A17 — Bug : commandes shell échappées', () {
    test('extraction round-trip d\'une commande avec guillemets échappés', () {
      final msg = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'c1',
              'tool': 'run_command',
              'detail': r'{"command_line":"git commit -m \"fix\" && git push"}',
            },
          ],
        },
      };
      final a = StreamDeltaParser.approvalOf(msg)!;
      expect(a.command, r'git commit -m \"fix\" && git push',
          reason: 'le JSON échappé doit être préservé tel quel pour le round-trip vers le daemon');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A18 — BUG : approval générique sans détail JSON (fallback)
// ══════════════════════════════════════════════════════════════════════════════
void _a18() {
  group('A18 — Bug : approval générique (fallback)', () {
    test('tool inconnu → approvalType "approval" + fallback ligne de texte', () {
      final msg = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'c2',
              'tool': 'generic_tool',
              'detail': 'Voulez-vous continuer ?',
            },
          ],
        },
      };
      final a = StreamDeltaParser.approvalOf(msg)!;
      expect(a.approvalType, 'approval');
      expect(a.command, 'Voulez-vous continuer ?');
    });

    test('détail JSON sans command_line → command vide (pas de crash)', () {
      final msg = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'c3',
              'tool': 'run_command',
              'detail': '{"message":"pas de commande"}',
            },
          ],
        },
      };
      final a = StreamDeltaParser.approvalOf(msg)!;
      expect(a.command, isEmpty);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A19 — CONFLIT : dispose pendant un stream actif
// ══════════════════════════════════════════════════════════════════════════════
void _a19() {
  group('A19 — Conflit : dispose pendant un stream actif', () {
    test('dispose ferme les streams actifs (onDone), sans fuite', () async {
      final (:api, :ctrl, :out) = _mkApi();
      final s = api.sendPrompt('c1', 'prompt');
      await Future<void>.delayed(Duration.zero);

      var done = false;
      final doneCompleter = Completer<void>();
      s.listen((_) {}, onDone: () {
        done = true;
        doneCompleter.complete();
      });

      api.dispose();
      await doneCompleter.future;
      expect(done, isTrue);

      await ctrl.close();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// A20 — BUG : types inattendus dans le payload (défense en profondeur)
// ══════════════════════════════════════════════════════════════════════════════
void _a20() {
  group('A20 — Bug : types inattendus', () {
    test('liste de sessions contenant des éléments non-map est filtrée sans crash', () {
      final sessions = SessionParser.parseListSessions({
        'sessions': [
          'garbage string',
          42,
          {'cascadeId': 'real-2', 'title': 'Valide', 'status': 'CASCADE_STATUS_READY'},
        ],
      });
      expect(sessions, hasLength(1));
      expect(sessions.first.id, 'real-2');
    });

    test('stepIndex en string ne crash pas (coercé via num)', () {
      final msg = {
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'c4',
              'tool': 'run_command',
              'detail': '{"command_line":"ls"}',
              'stepIndex': '3', // type inattendu côté serveur
            },
          ],
        },
      };
      final a = StreamDeltaParser.approvalOf(msg)!;
      expect(a.stepIndex, -1, reason: 'pas un num → défaut -1, pas de crash');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
void main() {
  _a1();
  _a2();
  _a3();
  _a4();
  _a5();
  _a6();
  _a7();
  _a8();
  _a9();
  _a10();
  _a11();
  _a12();
  _a13();
  _a14();
  _a15();
  _a16();
  _a17();
  _a18();
  _a19();
  _a20();
}
