import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/theme/app_theme.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'session_model_sess-history-1': 'claude-3-7-sonnet',
    });
  });

  group('Session Model Switching on Existing Conversation History', () {
    testWidgets('ChatInputBar setModel updates UI pill and internal model IDs immediately', (WidgetTester tester) async {
      String? selectedModelName;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              cascadeId: 'sess-history-2',
              initialModel: 'claude-3-7-sonnet',
              onModelChanged: (m) => selectedModelName = m,
              onSend: (_, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      final inputState = tester.state<ChatInputBarState>(find.byType(ChatInputBar));
      inputState.setModel('gpt-4o');
      await tester.pump();

      expect(selectedModelName, 'gpt-4o');
      expect(find.textContaining('gpt-4o', findRichText: true), findsWidgets);

      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('ChatInputBar loads session-persisted model from SharedPreferences', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              cascadeId: 'sess-history-1',
              onSend: (_, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('claude', findRichText: true), findsWidgets);

      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Switching model in active session with existing history sends new modelUID', (WidgetTester tester) async {
      final ctrl = StreamController<dynamic>.broadcast();
      final outgoing = <Map<String, dynamic>>[];

      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (data) {
          final map = data as Map<String, dynamic>;
          outgoing.add(map);
          final reqId = map['requestId'] as String?;
          final type = map['type'] as String?;
          if (reqId != null) {
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                if (type == 'get_session_history') {
                  ctrl.add(jsonEncode({
                    'type': 'response',
                    'requestId': reqId,
                    'data': {
                      'messages': [
                        {
                          'id': 'm1',
                          'sender': 'user',
                          'text': 'Bonjour, peux-tu analyser ce code ?',
                          'timestamp': '10:00',
                        },
                        {
                          'id': 'm2',
                          'sender': 'assistant',
                          'text': 'Bien sûr ! Voici l\'analyse...',
                          'timestamp': '10:01',
                          'modelLabel': 'Claude 3.7 Sonnet',
                        },
                      ],
                    },
                  }));
                } else {
                  ctrl.add(jsonEncode({
                    'type': 'response',
                    'requestId': reqId,
                    'data': {'status': 'ok'},
                  }));
                }
              }
            });
          }
        },
      );

      // 1. Ouvrir une session existante avec historique
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'sess-history-1',
              activeProjectName: 'Historical Session Proj',
              isConnected: true,
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));

      // 2. Vérifier que les messages de l'historique sont affichés
      expect(find.text('Bonjour, peux-tu analyser ce code ?'), findsOneWidget);
      expect(find.text('Bien sûr ! Voici l\'analyse...'), findsOneWidget);

      // 3. Changer de modèle vers GPT-4o dans ChatInputBar
      final inputState = tester.state<ChatInputBarState>(find.byType(ChatInputBar));
      inputState.setModel('gpt-4o');
      await tester.pump();

      // 4. Envoyer un nouveau message de suite dans la conversation
      await tester.enterText(find.byType(TextField), 'Génère les tests pour ce module');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump();

      // 5. Vérifier que la requête send_prompt utilise bien le nouveau modèle GPT-4o
      final sendPromptReq = outgoing.firstWhere((m) => m['type'] == 'send_prompt');
      expect(sendPromptReq['cascadeId'], 'sess-history-1');
      expect(sendPromptReq['prompt'], 'Génère les tests pour ce module');
      expect(sendPromptReq['modelUID'], 'gpt-4o');

      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
      await ctrl.close();
    });
  });
}
