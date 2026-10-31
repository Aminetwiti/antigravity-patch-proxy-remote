import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

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
      final type = map['type'] as String?;
      if (reqId != null &&
          (type == 'get_session_history' ||
              type == 'read_file' ||
              type == 'list_files' ||
              type == 'get_context' ||
              type == 'get_git_state' ||
              type == 'get_vcs_state' ||
              type == 'submit_approval')) {
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
  required String activeSessionId,
}) async {
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
          activeProjectName: 'TestProject',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('Multi-Session Concurrency & Event Isolation Tests', () {
    testWidgets('Background session events do not contaminate active session UI',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-B');

      // Émission d'un flux complet pour la session A en arrière-plan
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-A',
        'requestId': 'req-A-1',
      }));
      await tester.pump(const Duration(milliseconds: 50));

      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-A',
        'requestId': 'req-A-1',
        'data': {
          'events': [
            {
              'kind': 'text',
              'delta': 'SECRET_TOKEN_FROM_SESSION_A',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Session B ne doit JAMAIS afficher le token de session A
      expect(find.textContaining('SECRET_TOKEN_FROM_SESSION_A'), findsNothing);

      // Émission d'un token pour la session B (active)
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-B',
        'requestId': 'req-B-1',
      }));
      await tester.pump(const Duration(milliseconds: 50));

      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-B',
        'requestId': 'req-B-1',
        'data': {
          'events': [
            {
              'kind': 'text',
              'delta': 'TOKEN_FOR_SESSION_B',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Session B affiche son token
      expect(find.textContaining('TOKEN_FOR_SESSION_B'), findsOneWidget);
      expect(find.textContaining('SECRET_TOKEN_FROM_SESSION_A'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Approvals from session A do not appear in session B',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-B');

      // Approbation envoyée pour session A
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-A',
        'requestId': 'req-A-2',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'call-A-approval',
              'tool': 'run_command',
              'detail': '{"command_line":"rm -rf /tmp/test-A"}',
              'cascadeId': 'session-A',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Dans session B, aucune carte d'approbation pour session A
      expect(find.textContaining('rm -rf /tmp/test-A'), findsNothing);
      expect(find.byType(ToolApprovalCard), findsNothing);

      // Approbation envoyée pour session B
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-B',
        'requestId': 'req-B-2',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'callId': 'call-B-approval',
              'tool': 'run_command',
              'detail': '{"command_line":"npm test session-B"}',
              'cascadeId': 'session-B',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Dans session B, la carte d'approbation et la commande de B sont affichées
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.textContaining('npm test session-B'), findsWidgets);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Un-scoped events without cascadeId are ignored and do not pollute active session',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-C');

      // Événement orphelin sans cascadeId
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'requestId': 'req-orphan-1',
        'data': {
          'events': [
            {
              'kind': 'text',
              'delta': 'ORPHAN_CONTAMINATION_TEXT',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      expect(find.textContaining('ORPHAN_CONTAMINATION_TEXT'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 1: Desktop sends message in Y while Flutter is on X -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // Événement message utilisateur / stream_start sur Y
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-msg',
      }));
      await tester.pump(const Duration(milliseconds: 50));

      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-msg',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'Message from session Y'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Flutter doit rester sur X et ne pas afficher le contenu de Y
      expect(find.textContaining('Message from session Y'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 2: Search action runs in Y while Flutter is on X -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // Action search exécutée dans Y
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-search',
        'data': {
          'events': [
            {
              'kind': 'tool_call',
              'tool': 'search_web',
              'args': '{"query":"flutter stream isolation"}',
            },
            {
              'kind': 'text',
              'delta': 'Searching documentation in Y...',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      expect(find.textContaining('Searching documentation in Y...'), findsNothing);
      expect(find.textContaining('search_web'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 3: Runner action runs in Y while Flutter is on X -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // Action runner exécutée dans Y
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-runner',
        'data': {
          'events': [
            {
              'kind': 'tool_call',
              'tool': 'run_command',
              'args': '{"CommandLine":"pytest -v"}',
            },
            {
              'kind': 'text',
              'delta': 'Running test suite in Y...',
            }
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      expect(find.textContaining('Running test suite in Y...'), findsNothing);
      expect(find.textContaining('pytest -v'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 4: Tokens streaming in Y while Flutter is on X -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // Streaming continu de tokens dans Y
      for (var i = 0; i < 5; i++) {
        ctrl.add(jsonEncode({
          'broadcast': true,
          'type': 'stream_delta',
          'cascadeId': 'session-Y',
          'requestId': 'req-Y-stream',
          'data': {
            'events': [
              {'kind': 'text', 'delta': ' Chunk $i of Y response '}
            ],
          },
        }));
        await tester.pump(const Duration(milliseconds: 50));
      }

      // X ne contient aucun chunk de Y
      expect(find.textContaining('Chunk'), findsNothing);
      expect(find.textContaining('response'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 5: Y finishes (stream_end) -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_end',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-stream',
        'data': {'outcome': 'done'},
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Flutter est toujours actif sur X
      expect(find.byType(ChatStreamScreen), findsOneWidget);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 6: Multiple chained actions in Y -> Flutter stays on X throughout execution',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // 1. Démarrage
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-multi',
      }));
      await tester.pump(const Duration(milliseconds: 50));

      // 2. Recherche
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-multi',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'Searching files...'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 50));

      // 3. Outil de modification
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-multi',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'Writing to file...'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 50));

      // 4. Génération de tokens
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-multi',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'Completed task successfully!'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 50));

      // 5. Fin
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_end',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-multi',
        'data': {'outcome': 'done'},
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Aucune trace des étapes de Y dans X
      expect(find.textContaining('Searching files...'), findsNothing);
      expect(find.textContaining('Writing to file...'), findsNothing);
      expect(find.textContaining('Completed task successfully!'), findsNothing);

      api.dispose();
      await ctrl.close();
    });

    testWidgets('Cas 7: Concurrent events from Y and Z -> Flutter stays on X',
        (WidgetTester tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, activeSessionId: 'session-X');

      // Événements simultanés sur Y et Z
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-conc',
      }));
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_start',
        'cascadeId': 'session-Z',
        'requestId': 'req-Z-conc',
      }));
      await tester.pump(const Duration(milliseconds: 50));

      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Y',
        'requestId': 'req-Y-conc',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'DELTA_FROM_Y'}
          ],
        },
      }));
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-Z',
        'requestId': 'req-Z-conc',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'DELTA_FROM_Z'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // Ni Y ni Z ne doivent polluer l'UI de X
      expect(find.textContaining('DELTA_FROM_Y'), findsNothing);
      expect(find.textContaining('DELTA_FROM_Z'), findsNothing);

      // Maintenant X reçoit son propre événement
      ctrl.add(jsonEncode({
        'broadcast': true,
        'type': 'stream_delta',
        'cascadeId': 'session-X',
        'requestId': 'req-X-conc',
        'data': {
          'events': [
            {'kind': 'text', 'delta': 'MY_OWN_DELTA_IN_X'}
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));

      // X affiche uniquement son delta
      expect(find.textContaining('MY_OWN_DELTA_IN_X'), findsOneWidget);
      expect(find.textContaining('DELTA_FROM_Y'), findsNothing);
      expect(find.textContaining('DELTA_FROM_Z'), findsNothing);

      api.dispose();
      await ctrl.close();
    });
  });
}
