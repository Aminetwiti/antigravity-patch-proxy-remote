import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/background_tasks_bar.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:mobile/widgets/tool_approval_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Keyboard Layout & Overflow Resilience Tests', () {
    testWidgets('ChatInputBar hides action pills & folder when keyboard is active without overflow', (tester) async {
      // Écran mobile standard avec clavier virtuel ouvert (viewInsets.bottom = 320)
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1.0;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                const Expanded(child: SizedBox()),
                ChatInputBar(
                  projectName: 'MyProject',
                  isConnected: true,
                  onSend: (text, {bool queued = false, String? modelUID, int? modelEnum, List<String>? images, String? base64Data, String? fileName, List<Map<String, dynamic>>? media}) {},
                ),
              ],
            ),
          ),
        ),
      );

      await tester.pump();

      // Les action pills et le dossier projet sont cachés pour éviter l'overflow
      expect(find.text('/btw'), findsNothing);
      expect(find.text('MyProject'), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('BackgroundTasksBar auto-collapses on keyboard open without overflow', (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1.0;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackgroundTasksBar(
              runningTasks: const ['flutter analyze', 'flutter test --exclude-tags=live'],
            ),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('2 tasks running'), findsOneWidget);
      // Rendu compact, pas d'overflow
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('ChatStreamScreen handles software keyboard without bottom overflow', (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1.0;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          final map = d as Map<String, dynamic>;
          final reqId = map['requestId'] as String?;
          if (reqId != null) {
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
              }
            });
          }
        },
      );

      final oldOnError = FlutterError.onError;
      final errors = <String>[];
      FlutterError.onError = (details) {
        errors.add(details.toString());
      };
      addTearDown(() => FlutterError.onError = oldOnError);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'sess-kb-1',
              activeProjectName: 'Antigravity Workspace',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 300));

      if (errors.isNotEmpty) {
        for (final e in errors) {
          // ignore: avoid_print
          print('CHAT SCREEN OVERFLOW:\n$e');
        }
      }

      // Vérification qu'aucun RenderFlex overflow n'a été levé
      expect(errors, isEmpty);
      expect(find.byType(ChatInputBar), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });

    testWidgets('ChatStreamScreen does not overflow with 10 running tasks and pending approval concurrently', (tester) async {
      tester.view.physicalSize = const Size(360, 600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          final map = d as Map<String, dynamic>;
          final reqId = map['requestId'] as String?;
          if (reqId != null) {
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
              }
            });
          }
        },
      );

      final oldOnError = FlutterError.onError;
      final errors = <String>[];
      FlutterError.onError = (details) {
        errors.add(details.toString());
      };
      addTearDown(() => FlutterError.onError = oldOnError);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'sess-kb-2',
              activeProjectName: 'Antigravity Workspace',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 100));

      // Émet 10 tâches de fond actives
      for (int i = 0; i < 10; i++) {
        ctrl.add(jsonEncode({
          'type': 'task_started',
          'cascadeId': 'sess-kb-2',
          'data': {
            'id': 'task-$i',
            'command': 'powershell -Command "Test-Path script-$i.ps1"',
            'cascadeId': 'sess-kb-2',
          },
        }));
      }

      // Émet une approbation d'outil bloquante
      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'cascadeId': 'sess-kb-2',
        'data': {
          'callId': 'call-node-1',
          'approvalType': 'run_command',
          'tool': 'run_command',
          'command': 'node -e "try { const m = require(\'./dist/proxy/modelLoader\'); } catch (e) {}"',
          'cascadeId': 'sess-kb-2',
        },
      }));

      await tester.pump(const Duration(milliseconds: 300));

      FlutterError.onError = oldOnError;

      // Vérification qu'aucun débordement RenderFlex n'a été levé
      expect(errors, isEmpty);
      expect(find.text('10 tasks running'), findsOneWidget);
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.byType(ChatInputBar), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });

    testWidgets('ChatStreamScreen does not overflow with concurrent Approval Card, Background Task, and 401 Error Banner', (tester) async {
      tester.view.physicalSize = const Size(360, 600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          final map = d as Map<String, dynamic>;
          final reqId = map['requestId'] as String?;
          if (reqId != null) {
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
              }
            });
          }
        },
      );

      final oldOnError = FlutterError.onError;
      final errors = <String>[];
      FlutterError.onError = (details) {
        errors.add(details.toString());
      };
      addTearDown(() => FlutterError.onError = oldOnError);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'sess-kb-3',
              activeProjectName: 'Antigravity Workspace',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 100));

      // 1. Émet 1 tâche active
      ctrl.add(jsonEncode({
        'type': 'task_started',
        'cascadeId': 'sess-kb-3',
        'data': {
          'id': 'task-go-1',
          'command': 'go test ./pkg/gateway/ -count=1',
          'cascadeId': 'sess-kb-3',
        },
      }));

      // 2. Émet une approbation bloquante
      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'cascadeId': 'sess-kb-3',
        'data': {
          'callId': 'call-go-1',
          'approvalType': 'run_command',
          'tool': 'run_command',
          'command': 'go test ./pkg/gateway/ -count=1',
          'cascadeId': 'sess-kb-3',
        },
      }));

      // 3. Émet une erreur HTTP 401
      ctrl.add(jsonEncode({
        'type': 'stream_event',
        'cascadeId': 'sess-kb-3',
        'data': {
          'type': 'error',
          'content': 'HTTP 401 Unauthorized: invalid_api_key provided for OpenAI',
        },
      }));

      await tester.pump(const Duration(milliseconds: 300));

      FlutterError.onError = oldOnError;

      // Zéro overflow
      expect(errors, isEmpty);
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.byType(BackgroundTasksBar), findsOneWidget);
      expect(find.byType(ChatInputBar), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });
  });
}
