@Tags(['live'])
library;

// Test d'intégration Flutter RÉEL : branche la vraie pile réseau Dart
// (DaemonWebSocketClient + DaemonApi) sur le daemon en cours (port 8090),
// ouvre la session 8849c879-2e81-4871-998e-5fbf3eb0a5b6 et envoie "je suis là".
//
// Nécessite le daemon lancé :  daemon.exe --port 8090 --auth-token n2o75pct
// Run : flutter test test/live_ws_open_session_test.dart --dart-define=DAEMON_PORT=8090
//       (--dart-define=AUTH_TOKEN=n2o75pct si le token par défaut diffère)
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/config/env_config.dart';
import 'package:mobile/core/network/websocket_client.dart';
import 'package:mobile/core/protocol/daemon_api.dart';

const _cascadeId = '8849c879-2e81-4871-998e-5fbf3eb0a5b6';

void main() {
  test(
    'WS réel : ouvre la session et envoie "je suis là" via DaemonApi',
    () async {
    // 1) Vraie connexion WebSocket (dart:io) vers le daemon local.
    final ws = DaemonWebSocketClient();
    await ws.connect(authToken: EnvConfig.authToken);
    if (ws.status != ConnectionStatus.connected) {
      // ignore: avoid_print
      print('⚠️ Daemon non démarré sur port ${EnvConfig.daemonPort}, test live ignoré');
      return;
    }
    try {
      // ignore: avoid_print
      print('✅ WS connecté au daemon (${ws.targetUrl})');

      // 2) DaemonApi branché sur la vraie pile.
      final api = DaemonApi(
        incoming: ws.stream,
        send: ws.send,
        timeout: const Duration(seconds: 10),
      );

      // 3) Vérifie que le daemon voit bien la session distante (list_sessions).
      final sessions = await api.listSessions();
      final ids = <String>[];
      for (final s in (sessions['sessions'] as List? ?? const [])) {
        final m = s as Map;
        ids.add(m['cascadeId']?.toString() ?? '');
      }
      // ignore: avoid_print
      print('📋 Sessions distantes : ${ids.length}');
      expect(ids, contains(_cascadeId),
          reason: 'La cascade cible doit exister côté daemon');

      // 4) Envoie le prompt en streaming (send_prompt → stream_start → delta → end).
      final stream = api.sendPrompt(
        _cascadeId,
        'je suis là',
        modelUID: 'gemini-3.7-flash',
        modelEnum: 312,
      );
      final types = <String>[];
      final done = Completer<void>();
      var outcome = '';
      stream.listen((msg) {
        final t = msg['type']?.toString() ?? '';
        types.add(t);
        if (t == 'stream_end') {
          final d = msg['data'];
          if (d is Map) outcome = d['outcome']?.toString() ?? '';
        }
      }, onDone: done.complete, onError: (e) {
        done.completeError(e);
      });

      // 5) Attente du stream complet (30 s max, comme le test E2E live).
      await done.future.timeout(const Duration(seconds: 30),
          onTimeout: () => throw TimeoutException(
              'Pas de stream_end en 30 s — reçus: $types'));

      // ignore: avoid_print
      print('📡 Types reçus : $types');
      expect(types, contains('stream_start'));
      expect(types, contains('stream_delta'));
      expect(types, contains('stream_end'));
      // ignore: avoid_print
      print('🎉 "je suis là" envoyé dans $_cascadeId — outcome=$outcome');

      api.dispose();
    } finally {
      ws.disconnect();
    }
  }, tags: 'live', timeout: const Timeout(Duration(seconds: 60)));
}
