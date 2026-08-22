import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/background_tasks_bar.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
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
  });
}
