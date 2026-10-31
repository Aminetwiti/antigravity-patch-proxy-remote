import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/features/chat_stream/widgets/queued_messages_card.dart';

({DaemonApi api, StreamController<dynamic> ctrl, List<Map<String, dynamic>> out})
    _mkApi() {
  final out = <Map<String, dynamic>>[];
  final ctrl = StreamController<dynamic>.broadcast();
  final api = DaemonApi(
    incoming: ctrl.stream,
    send: (d) {
      final map = d as Map<String, dynamic>;
      out.add(map);
      final reqId = map['requestId'] as String?;
      if (reqId != null && map['type'] != 'send_prompt') {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
          }
        });
      }
    },
  );
  return (api: api, ctrl: ctrl, out: out);
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required DaemonApi api,
  required StreamController<dynamic> ctrl,
  String activeSessionId = 'c1',
  bool isConnected = true,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(api.dispose);
  addTearDown(ctrl.close);

  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5CF6),
          brightness: Brightness.dark,
        ),
      ),
      home: Scaffold(
        body: ChatStreamScreen(
          api: api,
          activeSessionId: activeSessionId,
          activeProjectName: 'TestProj',
          isConnected: isConnected,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  group('Scénarios de Concurrence, Race Conditions & États Partagés (Queued Messages)', () {
    testWidgets('Scénario 1 : Envoi pendant streaming met automatiquement en file sans collision', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // 1. Premier prompt envoyé quand idle -> part immédiatement vers le daemon
      await tester.enterText(find.byType(TextField), 'Premier message');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump(const Duration(milliseconds: 350));

      expect(out.any((m) => m['type'] == 'send_prompt' && m['prompt'] == 'Premier message'), isTrue);
      final reqId = out.firstWhere((m) => m['type'] == 'send_prompt')['requestId'] as String;

      // Le stream est maintenant actif
      ctrl.add(jsonEncode({
        'type': 'stream_delta',
        'requestId': reqId,
        'cascadeId': 'c1',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'Traitement en cours...'}
          ]
        }
      }));
      await tester.pump(const Duration(milliseconds: 50));

      // 2. Deuxième prompt saisi pendant que le stream tourne
      await tester.enterText(find.byType(TextField), 'Deuxième message en file');
      await tester.pump(const Duration(milliseconds: 50));

      // Le bouton d'envoi en file est affiché
      expect(find.byIcon(Icons.playlist_add_check), findsOneWidget);
      await tester.tap(find.byIcon(Icons.playlist_add_check));
      await tester.pump(const Duration(milliseconds: 50));

      // Vérification : la carte QueuedMessagesCard est visible avec le message en file
      expect(find.byType(QueuedMessagesCard), findsOneWidget);
      expect(find.text('Queued Messages'), findsOneWidget);
      expect(find.text('Deuxième message en file'), findsOneWidget);

      // 3. Le premier stream se termine avec succès (outcome = done)
      ctrl.add(jsonEncode({
        'type': 'stream_end',
        'requestId': reqId,
        'cascadeId': 'c1',
        'data': {
          'outcome': 'done',
          'cascadeId': 'c1',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      // Vérification : le 2ème prompt a été dépilé et envoyé automatiquement
      final prompts = out.where((m) => m['type'] == 'send_prompt').toList();
      expect(prompts.length, equals(2));
      expect(prompts[1]['prompt'], equals('Deuxième message en file'));
      // La carte disparaît car la file a été consommée
      expect(find.byType(QueuedMessagesCard), findsNothing);
    });

    testWidgets('Scénario 2 : Annulation (Emergency Stop) ne déclenche PAS le message en file', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // Envoi prompt 1
      await tester.enterText(find.byType(TextField), 'Tâche longue');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump(const Duration(milliseconds: 350));

      final reqId = out.firstWhere((m) => m['type'] == 'send_prompt')['requestId'] as String;

      // Enfilement prompt 2
      await tester.enterText(find.byType(TextField), 'Tâche suivante');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.playlist_add_check));
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byType(QueuedMessagesCard), findsOneWidget);

      // Clic sur Emergency Stop
      expect(find.byKey(const Key('stop-generation-button')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stop-generation-button')));
      await tester.pump(const Duration(milliseconds: 50));

      // Signal stream_end avec outcome cancelled
      ctrl.add(jsonEncode({
        'type': 'stream_end',
        'requestId': reqId,
        'cascadeId': 'c1',
        'data': {
          'outcome': 'cancelled',
          'cascadeId': 'c1',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      // Vérification : aucun 2ème prompt n'a été envoyé accidentellement
      final prompts = out.where((m) => m['type'] == 'send_prompt').toList();
      expect(prompts.length, equals(1));

      // Le message reste dans la file
      expect(find.byType(QueuedMessagesCard), findsOneWidget);
      expect(find.text('Tâche suivante'), findsOneWidget);
    });

    testWidgets('Scénario 3 : Action "Edit" retire de la file et restaure dans le TextField', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // Prompt 1
      await tester.enterText(find.byType(TextField), 'Prompt 1');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump(const Duration(milliseconds: 350));

      // Prompt 2 en file
      await tester.enterText(find.byType(TextField), 'Prompt 2 avec fote');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.playlist_add_check));
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byType(QueuedMessagesCard), findsOneWidget);

      // Clic sur "Edit"
      await tester.tap(find.byTooltip('Edit message'));
      await tester.pump(const Duration(milliseconds: 100));

      // La file est vide et le texte est rechargé dans l'input
      expect(find.byType(QueuedMessagesCard), findsNothing);
      expect(find.text('Prompt 2 avec fote'), findsOneWidget);
    });

    testWidgets('Scénario 4 : Action "Delete" supprime sans envoyer', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // Prompt 1
      await tester.enterText(find.byType(TextField), 'Prompt 1');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump(const Duration(milliseconds: 350));

      final reqId = out.firstWhere((m) => m['type'] == 'send_prompt')['requestId'] as String;

      // Prompt 2 en file
      await tester.enterText(find.byType(TextField), 'Prompt à supprimer');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tap(find.byIcon(Icons.playlist_add_check));
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.byType(QueuedMessagesCard), findsOneWidget);

      // Clic sur "Delete"
      await tester.tap(find.byTooltip('Delete from queue'));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(QueuedMessagesCard), findsNothing);

      // Fin du stream
      ctrl.add(jsonEncode({
        'type': 'stream_end',
        'requestId': reqId,
        'cascadeId': 'c1',
        'data': {
          'outcome': 'done',
          'cascadeId': 'c1',
        }
      }));
      await tester.pump(const Duration(milliseconds: 300));

      // Un seul prompt a été envoyé au daemon
      final prompts = out.where((m) => m['type'] == 'send_prompt').toList();
      expect(prompts.length, equals(1));
    });
  });
}
