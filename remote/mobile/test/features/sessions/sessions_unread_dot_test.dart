import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/sessions/sessions_list.dart';
import 'package:mobile/features/sessions/conversation_history_screen.dart';
import 'package:mobile/widgets/status_dot_badge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('LeftSidebarDrawer renders unread blue dot for completed unread session', (WidgetTester tester) async {
    final sessions = [
      const CascadeSession(
        id: 'sess-active',
        workspacePath: 'c:\\repo',
        title: 'Active Reading Session',
        status: 'CASCADE_STATUS_READY',
        time: '1m',
        stepCount: 5,
        hasUnread: false,
      ),
      const CascadeSession(
        id: 'sess-unread-1',
        workspacePath: 'c:\\repo',
        title: 'Empty Conversation Session',
        status: 'CASCADE_STATUS_READY',
        time: '5m',
        stepCount: 2,
        hasUnread: true,
      ),
      const CascadeSession(
        id: 'sess-read',
        workspacePath: 'c:\\repo',
        title: 'Aymen Conversation Introduction',
        status: 'CASCADE_STATUS_READY',
        time: '1d',
        stepCount: 0,
        hasUnread: false,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LeftSidebarDrawer(
            activeSessionId: 'sess-active',
            sessions: sessions,
            onSessionSelected: (_) {},
            onNewConversation: () {},
            onToggleConnection: () {},
          ),
        ),
      ),
    );
    // Pulsing animation repeats forever, so use a fixed pump instead of pumpAndSettle.
    await tester.pump(const Duration(milliseconds: 500));

    // Verify unread blue dot exists for sess-unread-1
    expect(find.byKey(const ValueKey('unread_blue_dot')), findsOneWidget);

    // Verify session menu button (...) exists for active session
    expect(find.byKey(const ValueKey('session_menu_btn')), findsOneWidget);

    // Verify relative time is displayed for read session
    expect(find.text('1d'), findsOneWidget);
  });

  testWidgets('ConversationHistoryScreen renders unread blue dot when session hasUnread is true', (WidgetTester tester) async {
    final sessions = [
      const CascadeSession(
        id: 'sess-1',
        workspacePath: 'c:\\repo',
        title: 'General Inquiry Placeholder',
        status: 'CASCADE_STATUS_READY',
        time: '10m',
        hasUnread: true,
      ),
      const CascadeSession(
        id: 'sess-2',
        workspacePath: 'c:\\repo',
        title: 'Old Read Conversation',
        status: 'CASCADE_STATUS_READY',
        time: '2d',
        hasUnread: false,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ConversationHistoryScreen(
            activeSessionId: 'sess-2',
            sessions: sessions,
            onSessionSelected: (_) {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));

    // The unread session sess-1 has the blue dot container
    expect(find.byTooltip('Session terminée — non lue'), findsOneWidget);
    // The read session sess-2 shows its relative time
    expect(find.text('2d'), findsOneWidget);
  });

  testWidgets('LeftSidebarDrawer and ConversationHistoryScreen render ThreeDotsWaiting for waiting / background task sessions', (WidgetTester tester) async {
    final sessions = [
      const CascadeSession(
        id: 'sess-waiting-1',
        workspacePath: 'c:\\repo',
        title: 'Task Running in Background',
        status: 'CASCADE_STATUS_WAITING_FOR_USER_ACTION',
        time: 'just now',
        stepCount: 3,
        hasUnread: false,
      ),
      const CascadeSession(
        id: 'sess-waiting-2',
        workspacePath: 'c:\\repo',
        title: 'Background Runner Session',
        status: 'CASCADE_STATUS_BACKGROUND_TASK',
        time: '2m',
        stepCount: 1,
        hasUnread: false,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LeftSidebarDrawer(
            activeSessionId: 'other-session',
            sessions: sessions,
            onSessionSelected: (_) {},
            onNewConversation: () {},
            onToggleConnection: () {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));

    // Both waiting sessions render ThreeDotsWaiting
    expect(find.byType(ThreeDotsWaiting), findsNWidgets(2));
  });
}
