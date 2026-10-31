import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/widgets/subagent_tree_card.dart';

void main() {
  group('SubagentTreeCard & Tray Tests', () {
    testWidgets('renders subagent count and items, handles expand and select', (tester) async {
      final subagents = [
        const SubagentItem(
          id: 'sub-1',
          role: 'Remaining Routes Splitter',
          status: 'running',
        ),
        const SubagentItem(
          id: 'sub-2',
          role: 'Unused Component Finder',
          status: 'completed',
        ),
      ];

      SubagentItem? selected;
      bool fullTreeOpened = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentTreeCard(
              subagents: subagents,
              onSelectSubagent: (s) => selected = s,
              onOpenFullTree: () => fullTreeOpened = true,
              initiallyExpanded: true,
            ),

          ),
        ),
      );

      // Verify Header
      expect(find.text('Subagents'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);

      // Verify Items rendered
      expect(find.text('Remaining Routes Splitter'), findsOneWidget);
      expect(find.text('Unused Component Finder'), findsOneWidget);

      // Tap on item
      await tester.tap(find.text('Remaining Routes Splitter'));
      await tester.pump();
      expect(selected?.id, equals('sub-1'));

      // Tap on open DAG button
      await tester.tap(find.byIcon(Icons.open_in_new));
      await tester.pump();
      expect(fullTreeOpened, isTrue);

      // Collapse card
      await tester.tap(find.text('Subagents'));
      await tester.pumpAndSettle();
      expect(find.text('Remaining Routes Splitter'), findsNothing);
    });
  });
}
