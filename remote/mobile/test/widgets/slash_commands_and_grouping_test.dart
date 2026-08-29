import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/mention_item.dart';
import 'package:mobile/features/chat_stream/widgets/mention_autocomplete_overlay.dart';
import 'package:mobile/features/sessions/display_options.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  group('Slash Commands & Session Date Grouping Tests', () {
    testWidgets('MentionAutocompleteOverlay displays slash commands with bolt icon and custom header', (tester) async {
      final items = [
        const MentionItem(type: MentionType.command, label: '/goal', detail: 'Autonomous goal until fully achieved'),
        const MentionItem(type: MentionType.command, label: '/schedule', detail: 'Set recurring timer / background cron'),
        const MentionItem(type: MentionType.command, label: '/browser', detail: 'Pair agent with browser CDP'),
        const MentionItem(type: MentionType.file, label: 'main.dart', detail: 'lib/main.dart'),
      ];

      MentionItem? selected;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MentionAutocompleteOverlay(
              query: '/g',
              items: items,
              onSelected: (item) => selected = item,
            ),
          ),
        ),
      );

      // Header should show Commandes rapides (/)
      expect(find.textContaining('Commandes rapides (/)'), findsOneWidget);
      expect(find.byIcon(Icons.bolt_rounded), findsWidgets);
      expect(find.text('/goal'), findsOneWidget);
      expect(find.text('main.dart'), findsNothing);

      // Tap on /goal
      await tester.tap(find.text('/goal'));
      expect(selected?.label, '/goal');
      expect(selected?.type, MentionType.command);
    });

    test('groupSessions with SessionGroupBy.date partitions sessions accurately', () {
      final now = DateTime.now();
      final todaySession = CascadeSession(
        id: 's1',
        title: 'Today Session',
        stepCount: 2,
        status: 'idle',
        time: '10:00',
        workspacePath: '/ws',
        updatedAt: now.subtract(const Duration(hours: 2)),
      );

      final yesterdaySession = CascadeSession(
        id: 's2',
        title: 'Yesterday Session',
        stepCount: 5,
        status: 'idle',
        time: 'hier',
        workspacePath: '/ws',
        updatedAt: now.subtract(const Duration(days: 1, hours: 2)),
      );

      final olderSession = CascadeSession(
        id: 's3',
        title: 'Older Session',
        stepCount: 1,
        status: 'idle',
        time: '3 semaines',
        workspacePath: '/ws',
        updatedAt: now.subtract(const Duration(days: 20)),
      );

      final grouped = groupSessions(
        sessions: [todaySession, yesterdaySession, olderSession],
        groupBy: SessionGroupBy.date,
      );

      expect(grouped.containsKey('Aujourd\'hui'), isTrue);
      expect(grouped['Aujourd\'hui']!.first.id, 's1');

      expect(grouped.containsKey('Hier'), isTrue);
      expect(grouped['Hier']!.first.id, 's2');

      expect(grouped.containsKey('30 derniers jours') || grouped.containsKey('Plus ancien'), isTrue);
    });
  });
}
