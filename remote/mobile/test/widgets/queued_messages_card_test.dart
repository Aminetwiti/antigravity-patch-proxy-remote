import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/queued_messages_card.dart';

void main() {
  group('QueuedMessagesCard widget tests', () {
    testWidgets('renders QueuedMessagesCard with header, count badge and items', (tester) async {
      final messages = [
        {'text': 'Refactor authentication module', 'activeSessionId': 'c1'},
        {'text': '', 'activeSessionId': 'c1', 'fileName': 'schema.prisma'},
      ];

      int? sendNowIdx;
      int? editIdx;
      int? deleteIdx;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QueuedMessagesCard(
              queuedMessages: messages,
              onSendNow: (idx) => sendNowIdx = idx,
              onEdit: (idx) => editIdx = idx,
              onDelete: (idx) => deleteIdx = idx,
            ),
          ),
        ),
      );

      // Header checks
      expect(find.text('Queued Messages'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('Sends after agent finishes working'), findsOneWidget);

      // Items checks
      expect(find.text('Refactor authentication module'), findsOneWidget);
      expect(find.text('Empty message'), findsOneWidget);

      // Actions checks: Send Now
      final sendNowButtons = find.byTooltip('Send now');
      expect(sendNowButtons, findsNWidgets(2));
      await tester.tap(sendNowButtons.first);
      await tester.pumpAndSettle();
      expect(sendNowIdx, equals(0));

      // Actions checks: Edit
      final editButtons = find.byTooltip('Edit message');
      expect(editButtons, findsNWidgets(2));
      await tester.tap(editButtons.last);
      await tester.pumpAndSettle();
      expect(editIdx, equals(1));

      // Actions checks: Delete
      final deleteButtons = find.byTooltip('Delete from queue');
      expect(deleteButtons, findsNWidgets(2));
      await tester.tap(deleteButtons.first);
      await tester.pumpAndSettle();
      expect(deleteIdx, equals(0));
    });

    testWidgets('collapses and expands on header tap', (tester) async {
      final messages = [
        {'text': 'Task to execute next', 'activeSessionId': 'c1'},
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QueuedMessagesCard(
              queuedMessages: messages,
              onSendNow: (_) {},
              onEdit: (_) {},
              onDelete: (_) {},
            ),
          ),
        ),
      );

      expect(find.text('Task to execute next'), findsOneWidget);

      // Tap header to collapse
      await tester.tap(find.text('Queued Messages'));
      await tester.pumpAndSettle();
      expect(find.text('Task to execute next'), findsNothing);

      // Tap header to expand again
      await tester.tap(find.text('Queued Messages'));
      await tester.pumpAndSettle();
      expect(find.text('Task to execute next'), findsOneWidget);
    });

    testWidgets('returns SizedBox.shrink when empty', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QueuedMessagesCard(
              queuedMessages: const [],
              onSendNow: (_) {},
              onEdit: (_) {},
              onDelete: (_) {},
            ),
          ),
        ),
      );

      expect(find.text('Queued Messages'), findsNothing);
    });
  });
}
