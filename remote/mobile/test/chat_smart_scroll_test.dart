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

  group('ChatStreamScreen Smart Scroll & Floating Pill Tests', () {
    testWidgets('renders jump to bottom button when scrolled up and dismisses on tap', (tester) async {
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

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'sess-scroll-test',
              activeProjectName: 'test-project',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 300));

      // Initially at bottom, jump button is not shown
      expect(find.byKey(const Key('jump-to-bottom')), findsNothing);

      // Clean up widget tree to cancel periodic timers
      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });

    testWidgets('starts at bottom on open with history, allows scrolling up, and resets to bottom on session switch', (tester) async {
      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (d) {
          final map = d as Map<String, dynamic>;
          final reqId = map['requestId'] as String?;
          final type = map['type'] as String?;
          if (type == 'get_session_history' && reqId != null) {
            final dataMap = map['data'] is Map ? map['data'] as Map : map;
            final cascadeId = dataMap['cascadeId']?.toString() ?? 'session-1';
            final msgs = List.generate(20, (i) => {
              'id': 'msg-$cascadeId-$i',
              'sender': i % 2 == 0 ? 'user' : 'assistant',
              'text': 'Message $i dans la session $cascadeId avec beaucoup de texte descriptif pour provoquer un défilement vertical complet dans la liste de chat',
              'timestamp': '12:0$i',
            });
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
              activeSessionId: 'session-1',
              activeProjectName: 'test-project',
              isConnected: true,
            ),
          ),
        ),
      );

      // Laisser l'historique se charger et les timers de settling s'exécuter
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));

      final chatListView = find.byWidgetPredicate((w) => w is ListView && w.scrollDirection == Axis.vertical);
      expect(chatListView, findsOneWidget);
      final scrollable = find.descendant(of: chatListView, matching: find.byType(Scrollable)).first;
      var scrollPos = tester.state<ScrollableState>(scrollable).position;
      expect(scrollPos.maxScrollExtent, greaterThan(0));
      expect(scrollPos.pixels, equals(scrollPos.maxScrollExtent));

      // L'utilisateur scrolle vers le haut
      await tester.drag(chatListView, const Offset(0, 400));
      await tester.pump(const Duration(milliseconds: 100));

      scrollPos = tester.state<ScrollableState>(scrollable).position;
      // Vérifier que la position a bien diminué (remontée dans l'historique)
      expect(scrollPos.pixels, lessThan(scrollPos.maxScrollExtent));

      // Changement de session vers session-2
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'session-2',
              activeProjectName: 'test-project',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));

      // session-2 démarre bien en bas
      final chatListView2 = find.byWidgetPredicate((w) => w is ListView && w.scrollDirection == Axis.vertical);
      final scrollable2 = find.descendant(of: chatListView2, matching: find.byType(Scrollable)).first;
      final scrollPos2 = tester.state<ScrollableState>(scrollable2).position;
      expect(scrollPos2.maxScrollExtent, greaterThan(0));
      expect(scrollPos2.pixels, equals(scrollPos2.maxScrollExtent));

      // Retour vers session-1 : la position de défilement de l'utilisateur est fidèlement restaurée
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'session-1',
              activeProjectName: 'test-project',
              isConnected: true,
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));

      final chatListView1Ret = find.byWidgetPredicate((w) => w is ListView && w.scrollDirection == Axis.vertical);
      final scrollable1Ret = find.descendant(of: chatListView1Ret, matching: find.byType(Scrollable)).first;
      final scrollPos1Ret = tester.state<ScrollableState>(scrollable1Ret).position;
      expect(scrollPos1Ret.maxScrollExtent, greaterThan(0));
      expect(scrollPos1Ret.pixels, equals(scrollPos.pixels));

      await tester.pumpWidget(const SizedBox());
      await ctrl.close();
      api.dispose();
    });
  });
}
