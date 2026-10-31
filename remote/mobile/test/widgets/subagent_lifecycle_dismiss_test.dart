import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/widgets/subagent_tree_card.dart';

void main() {
  group('Subagent Lifecycle & Auto-Dismissal Tests', () {
    testWidgets('SubagentTreeCard with onlyRunning=true renders SizedBox.shrink when all completed', (tester) async {
      final subagents = [
        const SubagentItem(
          id: 'sub-1',
          role: 'Database Debugger',
          status: 'completed',
          stateDetail: 'Done',
          typeName: 'db_debugger',
        ),
        const SubagentItem(
          id: 'sub-2',
          role: 'Code Researcher',
          status: 'done',
          stateDetail: 'Finished',
          typeName: 'researcher',
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentTreeCard(
              subagents: subagents,
              onlyRunning: true,
            ),
          ),
        ),
      );
      await tester.pump();

      // Card is completely hidden when no running subagents exist
      expect(find.text('Subagents'), findsNothing);
      expect(find.text('Database Debugger'), findsNothing);
      expect(find.text('Code Researcher'), findsNothing);
    });

    testWidgets('SubagentTreeCard with onlyRunning=true only shows running subagents', (tester) async {
      final subagents = [
        const SubagentItem(
          id: 'sub-1',
          role: 'Database Debugger',
          status: 'running',
          stateDetail: 'Running queries',
          typeName: 'db_debugger',
        ),
        const SubagentItem(
          id: 'sub-2',
          role: 'Code Researcher',
          status: 'completed',
          stateDetail: 'Done searching',
          typeName: 'researcher',
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentTreeCard(
              subagents: subagents,
              onlyRunning: true,
              initiallyExpanded: true,
            ),
          ),
        ),
      );
      await tester.pump();

      // Card shows only the 1 running subagent
      expect(find.text('Subagents'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      expect(find.text('Database Debugger'), findsOneWidget);
      // Completed subagent has disappeared from the conversation bar
      expect(find.text('Code Researcher'), findsNothing);
    });
  });
}
