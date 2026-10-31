import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/features/sessions/conversation_history_screen.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Archived Session Restore Tests', () {
    testWidgets('ChatStreamScreen renders archived bar when isArchived is true', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: null,
              activeSessionId: 'sess-archived-1',
              activeProjectName: 'Antigravity',
              isArchived: true,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('This chat is archived.'), findsOneWidget);
      expect(find.text('Restore'), findsOneWidget);
      expect(find.byType(ChatInputBar), findsNothing);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Tapping Restore calls onRestoreSession callback', (tester) async {
      bool restored = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: null,
              activeSessionId: 'sess-archived-1',
              activeProjectName: 'Antigravity',
              isArchived: true,
              onRestoreSession: () {
                restored = true;
              },
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      final restoreBtn = find.text('Restore');
      expect(restoreBtn, findsOneWidget);
      await tester.tap(restoreBtn);
      await tester.pump();

      expect(restored, isTrue);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('ConversationHistoryScreen renders Restaurer button for archived sessions', (tester) async {
      bool restored = false;
      final sessions = [
        const CascadeSession(
          id: 'sess-1',
          workspacePath: '/path/project',
          title: 'Active Session',
          status: 'CASCADE_STATUS_READY',
          time: '12:00',
          isArchived: false,
        ),
        const CascadeSession(
          id: 'sess-2',
          workspacePath: '/path/project',
          title: 'Archived Session',
          status: 'CASCADE_STATUS_ARCHIVED',
          time: 'Hier',
          isArchived: true,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ConversationHistoryScreen(
            sessions: sessions,
            activeSessionId: 'sess-1',
            onSessionSelected: (_) {},
            onRestoreSession: (id) async {
              if (id == 'sess-2') {
                restored = true;
              }
            },
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Archived Session'), findsOneWidget);
      expect(find.text('Restaurer'), findsOneWidget);

      await tester.tap(find.text('Restaurer'));
      await tester.pump();

      expect(restored, isTrue);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Unarchived session displays normal ChatInputBar', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ChatStreamScreen(
              api: null,
              activeSessionId: 'sess-active-1',
              activeProjectName: 'Antigravity',
              isArchived: false,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('This chat is archived.'), findsNothing);
      expect(find.byType(ChatInputBar), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
    });
  });
}
