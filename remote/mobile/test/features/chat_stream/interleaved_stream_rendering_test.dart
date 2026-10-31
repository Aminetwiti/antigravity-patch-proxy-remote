import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/features/chat_stream/widgets/execution_progress_view.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Interleaved stream deltas render sequential thoughts and paragraphs in ChatStreamScreen', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final out = <Map<String, dynamic>>[];
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        out.add(map);
        final reqId = map['requestId'] as String?;
        if (reqId != null) {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({'requestId': reqId, 'data': {'messages': []}}));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatStreamScreen(
            api: api,
            activeSessionId: 'test-session',
            activeProjectName: 'Test Project',
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));

    // 1. Envoyer un message via la barre de prompt
    await tester.enterText(find.byType(TextField), 'Test prompt');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pump();

    final reqId = out.last['requestId'] as String;

    // 2. Émettre un premier stream_delta avec une pensée/outil
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-session',
      'data': {
        'events': [
          {'kind': 'thinking', 'delta': 'Worked for 2m\nExplored 17 files'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // 3. Émettre un premier paragraphe de texte
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-session',
      'data': {
        'events': [
          {'kind': 'text', 'delta': 'Premier paragraphe intermédiaire.'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // 4. Émettre un second bloc de pensée / minuteur
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-session',
      'data': {
        'events': [
          {'kind': 'thinking', 'delta': 'Timed 10 seconds >'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // 5. Émettre un second paragraphe de texte
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-session',
      'data': {
        'events': [
          {'kind': 'text', 'delta': 'Deuxième paragraphe après le minuteur.'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // 6. Terminer le stream
    ctrl.add(jsonEncode({
      'type': 'stream_end',
      'requestId': reqId,
      'cascadeId': 'test-session',
      'data': {},
    }));
    await tester.pump(const Duration(milliseconds: 200));

    // Vérifier que les 2 blocs de pensées et les 2 paragraphes sont présents
    expect(find.byType(ExecutionProgressView), findsNWidgets(2));
    expect(find.textContaining('Premier paragraphe intermédiaire.'), findsOneWidget);
    expect(find.textContaining('Deuxième paragraphe après le minuteur.'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });

  testWidgets('sessions_updated does not wipe active streaming buffer or collapse thoughts', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final out = <Map<String, dynamic>>[];
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        out.add(map);
        final reqId = map['requestId'] as String?;
        if (reqId != null) {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({'requestId': reqId, 'data': {'messages': []}}));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatStreamScreen(
            api: api,
            activeSessionId: 'test-sess-preserve',
            activeProjectName: 'Test Project',
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 150));

    // 1. Envoyer un message
    await tester.enterText(find.byType(TextField), 'Test prompt with live steps');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pump();

    final reqId = out.last['requestId'] as String;

    // 2. Émettre un stream_delta avec une commande en cours d'exécution
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-sess-preserve',
      'data': {
        'events': [
          {'kind': 'thinking', 'delta': 'Run php vendor/bin/phpunit\nWorking..'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // Vérifier que la vue d'exécution est présente
    expect(find.byType(ExecutionProgressView), findsOneWidget);

    // 3. Simuler l'arrivée d'un événement sessions_updated pendant le streaming
    ctrl.add(jsonEncode({
      'type': 'sessions_updated',
      'data': {
        'sessions': [
          {
            'cascadeId': 'test-sess-preserve',
            'title': 'Test Session',
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': DateTime.now().toIso8601String(),
          }
        ]
      },
    }));
    await tester.pump(const Duration(milliseconds: 150));

    // Vérifier que la vue d'exécution N'A PAS été détruite ou vidée
    expect(find.byType(ExecutionProgressView), findsOneWidget);

    // 4. Continuer le flux avec de nouveaux deltas sans régression
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'test-sess-preserve',
      'data': {
        'events': [
          {'kind': 'text', 'delta': 'Tests passés avec succès.'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(ExecutionProgressView), findsOneWidget);
    expect(find.textContaining('Tests passés avec succès.'), findsOneWidget);

    // 5. Terminer proprement le stream
    ctrl.add(jsonEncode({
      'type': 'stream_end',
      'requestId': reqId,
      'cascadeId': 'test-sess-preserve',
      'data': {'outcome': 'completed'},
    }));
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('Tests passés avec succès.'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });
}
