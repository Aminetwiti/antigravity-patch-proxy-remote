import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/widgets/subagent_tree_card.dart';

void main() {
  testWidgets('SubagentTreeCard renders subagents DAG hierarchy correctly', (WidgetTester tester) async {
    final subagents = [
      const SubagentItem(
        id: 'sub-1',
        role: 'Database Debugger',
        status: 'running',
        stateDetail: 'Running queries on pg_stat_activity',
        typeName: 'db_debugger',
      ),
      const SubagentItem(
        id: 'sub-2',
        role: 'Code Researcher',
        status: 'completed',
        stateDetail: 'Found 4 matches in auth.ts',
        typeName: 'researcher',
      ),
    ];

    SubagentItem? selected;
    var openTreeCalled = false;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF8B5CF6),
            brightness: Brightness.dark,
          ),
        ),
        home: Scaffold(
          body: SubagentTreeCard(
            subagents: subagents,
            onOpenFullTree: () => openTreeCalled = true,
            onSelectSubagent: (sub) => selected = sub,
            initiallyExpanded: true,
          ),

        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));

    // Verify title and count
    expect(find.text('Subagents'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);

    // Verify subagents roles
    expect(find.text('Database Debugger'), findsOneWidget);
    expect(find.text('Code Researcher'), findsOneWidget);

    // Tap on subagent item
    await tester.tap(find.text('Database Debugger'));
    await tester.pump(const Duration(milliseconds: 50));
    expect(selected?.id, 'sub-1');

    // Tap on open full tree icon
    await tester.tap(find.byTooltip('Ouvrir le DAG complet'));
    await tester.pump(const Duration(milliseconds: 50));
    expect(openTreeCalled, isTrue);
  });
}
