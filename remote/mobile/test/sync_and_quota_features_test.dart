import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/features/sessions/display_options.dart';
import 'package:mobile/widgets/agent_error_card.dart';

void main() {
  group('Session Synchronization & Quota Error Tests', () {
    test('SessionParser extracts updatedAt and sorts correctly', () {
      final now = DateTime.now();
      final data = {
        'sessions': [
          {
            'cascadeId': 'sess-1',
            'title': 'Session 1',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': now.subtract(const Duration(minutes: 10)).toIso8601String(),
          },
          {
            'cascadeId': 'sess-2',
            'title': 'Session 2 (Active)',
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': now.toIso8601String(),
          },
          {
            'cascadeId': 'sess-3',
            'title': 'Session 3 (Middle)',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': now.subtract(const Duration(minutes: 2)).toIso8601String(),
          },
        ]
      };

      final parsed = SessionParser.parseListSessions(data);
      expect(parsed.length, 3);
      expect(parsed[0].id, 'sess-2');
      expect(parsed[0].updatedAt, isNotNull);
      expect(parsed[1].id, 'sess-3');
      expect(parsed[2].id, 'sess-1');

      final sorted = sortSessions(
        sessions: parsed,
        sortBy: SessionSortBy.lastUpdated,
      );
      expect(sorted[0].id, 'sess-2');
      expect(sorted[1].id, 'sess-3');
      expect(sorted[2].id, 'sess-1');
    });

    test('groupSessions returns all project sessions dynamically without truncation', () {
      const project = ProjectItem(
        id: 'proj-1',
        name: 'my-project',
        folderUri: 'c:/dev/my-project',
        path: 'c:/dev/my-project',
      );

      final sessions = List.generate(
        8,
        (i) => CascadeSession(
          id: 'sess-$i',
          workspacePath: 'c:/dev/my-project',
          title: 'Session $i',
          status: 'CASCADE_STATUS_READY',
          time: '5m',
        ),
      );

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: const [project],
      );

      expect(grouped['my-project']?.length, 8);
    });

    testWidgets('AgentErrorCard displays quota errors and Error ID correctly', (tester) async {
      const errorMsg =
          'Error Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h14m51s.\nError ID: 690e1696-332b-41a7-8f77-41896ec704d0-1872';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AgentErrorCard(errorText: errorMsg),
          ),
        ),
      );

      expect(find.textContaining('Error Individual quota reached'), findsWidgets);
      expect(find.text('Error ID: '), findsOneWidget);
      expect(find.text('690e1696-332b-41a7-8f77-41896ec704d0-1872'), findsOneWidget);
      expect(find.byIcon(Icons.copy_rounded), findsOneWidget);
    });
  });
}
