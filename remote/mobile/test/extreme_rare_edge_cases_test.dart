import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/stream_parser.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/features/sessions/sessions_list.dart';
import 'package:mobile/widgets/antigravity_spinning_arc.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Rare & Extreme Edge Cases Tests', () {
    test('SessionParser handles extreme statuses and rapid transitions', () {
      final payload = {
        'sessions': [
          {
            'cascadeId': 's-1',
            'title': 'Session in background task',
            'workspace': 'Project 1',
            'status': 'CASCADE_STATUS_BACKGROUND_TASK_RUNNING',
            'stepCount': 5,
            'updatedAt': DateTime.now().toIso8601String(),
          },
          {
            'cascadeId': 's-2',
            'title': 'Session waiting for user action',
            'workspace': 'Project 1',
            'status': 'CASCADE_STATUS_WAITING_FOR_USER_ACTION',
            'stepCount': 3,
            'updatedAt': DateTime.now().toIso8601String(),
          },
          {
            'cascadeId': 's-3',
            'title': 'Session executing tool',
            'workspace': 'Project 1',
            'status': 'EXECUTING',
            'stepCount': 10,
            'updatedAt': DateTime.now().toIso8601String(),
          },
          {
            'cascadeId': 's-4',
            'title': 'Session ready with activity',
            'workspace': 'Project 1',
            'status': 'CASCADE_STATUS_READY',
            'stepCount': 2,
            'updatedAt': DateTime.now().toIso8601String(),
          }
        ]
      };

      final sessions = SessionParser.parseListSessions(payload);
      expect(sessions.length, 4);

      // s-1 (background task) -> isRunning is true
      expect(sessions.firstWhere((s) => s.id == 's-1').isRunning, isTrue);

      // s-2 (waiting user action) -> isWaitingAction is true, isRunning is false
      expect(sessions.firstWhere((s) => s.id == 's-2').isWaitingAction, isTrue);

      // s-3 (executing) -> isRunning is true
      expect(sessions.firstWhere((s) => s.id == 's-3').isRunning, isTrue);

      // s-4 (ready with steps) -> hasUnread is true, isRunning is false
      expect(sessions.firstWhere((s) => s.id == 's-4').hasUnread, isTrue);
      expect(sessions.firstWhere((s) => s.id == 's-4').isRunning, isFalse);
    });

    test('StreamDeltaParser handles broken JSON details gracefully without throwing', () {
      final brokenDelta = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'tool': 'run_command',
              'detail': 'Broken JSON { "command": "echo hello", incomplete...',
            },
            {
              'kind': 'thinking',
              'delta': 'Thinking about the architecture...\n',
            },
            {
              'kind': 'text',
              'delta': 'Voici le résultat de l\'analyse.',
            }
          ]
        }
      };

      final text = StreamDeltaParser.textOf(brokenDelta);
      expect(text, "Voici le résultat de l'analyse.");

      final thinking = StreamDeltaParser.thinkingOf(brokenDelta);
      expect(thinking, contains('Thinking about the architecture...'));

      // Approval should still extract even with trailing malformed JSON
      final approval = StreamDeltaParser.approvalOf(brokenDelta);
      expect(approval, isNotNull);
      expect(approval!.tool, 'run_command');
      expect(approval.approvalType, 'run_command');
    });

    testWidgets('LeftSidebarDrawer displays real-time spinning arc on executing sessions', (tester) async {
      final sessions = [
        CascadeSession(
          id: 'running-session',
          workspacePath: 'C:/project',
          title: 'Active Task Running',
          status: 'CASCADE_STATUS_RUNNING',
          time: 'now',
        ),
        CascadeSession(
          id: 'ready-session',
          workspacePath: 'C:/project',
          title: 'Idle Session',
          status: 'CASCADE_STATUS_READY',
          time: '5m',
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LeftSidebarDrawer(
              activeSessionId: 'ready-session',
              sessions: sessions,
              onSessionSelected: (_) {},
              onNewConversation: () {},
              onToggleConnection: () {},
            ),
          ),
        ),
      );

      await tester.pump();

      // The running session should show the AntigravitySpinningArc
      expect(find.byType(AntigravitySpinningArc), findsOneWidget);

      // The ready/selected session should have the title visible
      expect(find.text('Active Task Running'), findsOneWidget);
      expect(find.text('Idle Session'), findsOneWidget);
    });
  });
}
