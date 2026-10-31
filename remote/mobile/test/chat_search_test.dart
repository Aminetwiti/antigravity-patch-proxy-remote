import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('ChatStreamScreen In-Chat Search Tests', () {
    testWidgets('toggles search bar, searches messages, and navigates results', (tester) async {
      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          final map = d as Map<String, dynamic>;
          final reqId = map['requestId'] as String?;
          final type = map['type'] as String?;
          if (type == 'get_session_history' && reqId != null) {
            final msgs = [
              {'id': 'msg-1', 'sender': 'user', 'text': 'Bonjour, peux-tu refactoriser la fonction login() ?', 'timestamp': '10:00'},
              {'id': 'msg-2', 'sender': 'assistant', 'text': 'Voici la nouvelle implémentation de login() sécurisée avec token JWT.', 'timestamp': '10:01'},
              {'id': 'msg-3', 'sender': 'user', 'text': 'Parfait, ajoute maintenant des tests unitaires.', 'timestamp': '10:02'},
              {'id': 'msg-4', 'sender': 'assistant', 'text': 'Tests ajoutés avec succès pour login().', 'timestamp': '10:03'},
            ];
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                ctrl.add(jsonEncode({
                  'requestId': reqId,
                  'data': {'messages': msgs, 'isStreaming': false},
                }));
              }
            });
          } else if (reqId != null) {
            scheduleMicrotask(() {
              if (!ctrl.isClosed) {
                ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
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
              activeSessionId: 'sess-search-test',
              activeProjectName: 'test-project',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Search bar is initially hidden
      expect(find.byKey(const Key('chat-search-input')), findsNothing);

      // Tap search toggle button in breadcrumb
      expect(find.byKey(const Key('toggle-search-btn')), findsOneWidget);
      await tester.tap(find.byKey(const Key('toggle-search-btn')));
      await tester.pumpAndSettle();

      // Search bar is now visible
      expect(find.byKey(const Key('chat-search-input')), findsOneWidget);

      // Enter search query 'login'
      await tester.enterText(find.byKey(const Key('chat-search-input')), 'login');
      await tester.pumpAndSettle();

      // Verify result counter shows 3 matches (msg-1, msg-2, msg-4)
      expect(find.textContaining('3 / 3'), findsOneWidget);

      // Navigate to previous match
      expect(find.byKey(const Key('search-prev-btn')), findsOneWidget);
      await tester.tap(find.byKey(const Key('search-prev-btn')));
      await tester.pumpAndSettle();
      expect(find.textContaining('2 / 3'), findsOneWidget);

      // Close search bar
      expect(find.byKey(const Key('close-search-btn')), findsOneWidget);
      await tester.tap(find.byKey(const Key('close-search-btn')));
      await tester.pumpAndSettle();

      // Search bar is dismissed
      expect(find.byKey(const Key('chat-search-input')), findsNothing);

      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });
  });
}
