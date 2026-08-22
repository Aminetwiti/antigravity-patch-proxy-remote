import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/sessions/conversation_history_screen.dart';
import 'package:mobile/features/sessions/sessions_list.dart';

void main() {
  testWidgets('LeftSidebarDrawer limits workspace sessions to 6 and does not show See more expander', (WidgetTester tester) async {
    // Generate 12 sessions for "antigravity-add-model-main"
    final sessions = List.generate(
      12,
      (i) => CascadeSession(
        id: 's-$i',
        workspacePath: 'c:\\repos\\antigravity-add-model-main',
        title: 'Session number $i',
        status: 'CASCADE_STATUS_READY',
        time: '${i + 1}m',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LeftSidebarDrawer(
            activeSessionId: 's-0',
            sessions: sessions,
            onSessionSelected: (_) {},
            onNewConversation: () {},
            onToggleConnection: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify first sessions are rendered
    expect(find.text('Session number 0'), findsOneWidget);
    expect(find.text('Session number 5'), findsOneWidget);

    // Verify 7th+ session is not in the sidebar tree
    expect(find.text('Session number 6'), findsNothing);

    // Verify "See more" is never displayed
    expect(find.textContaining('See more'), findsNothing);
  });

  testWidgets('ConversationHistoryScreen fetches and displays all sessions via listAllSessions', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final out = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        out.add(map);
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;

        if (reqId != null && (type == 'list_all_sessions' || type == 'list_sessions')) {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              final allSessions = List.generate(
                20,
                (i) => {
                  'cascadeId': 'hist-$i',
                  'workspace': 'antigravity-add-model-main',
                  'title': 'Historical Task $i',
                  'status': 'idle',
                  'updatedAt': '2026-08-18T10:00:00Z',
                },
              );
              ctrl.add(jsonEncode({
                'requestId': reqId,
                'sessions': allSessions,
                'projects': [
                  {'id': 'p1', 'name': 'antigravity-add-model-main', 'path': '/workspace'},
                ],
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: ConversationHistoryScreen(
          api: api,
          sessions: const [],
          activeSessionId: 'hist-0',
          onSessionSelected: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify historical tasks are loaded
    expect(find.text('Historical Task 0'), findsOneWidget);
    expect(find.text('Historical Task 1'), findsOneWidget);
    expect(find.text('Historical Task 2'), findsOneWidget);

    // Scroll to verify off-screen items are present in the list
    await tester.scrollUntilVisible(
      find.text('Historical Task 19'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Historical Task 19'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });
}
