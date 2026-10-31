import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/subagents_drawer.dart';

void main() {
  group('SubagentItem Model', () {
    test('fromJson parses standard conversation format', () {
      final json = {
        'conversationId': 'conv_123',
        'role': 'Codebase Researcher',
        'state': 'running',
        'stateDetail': 'GrepSearch in /lib',
        'type': 'researcher',
      };

      final item = SubagentItem.fromJson(json);
      expect(item.id, 'conv_123');
      expect(item.role, 'Codebase Researcher');
      expect(item.status, 'running');
      expect(item.stateDetail, 'GrepSearch in /lib');
      expect(item.typeName, 'researcher');
    });

    test('fromJson handles fallback id and status keys', () {
      final json = {
        'id': 'agent_456',
        'status': 'waiting_for_input',
      };

      final item = SubagentItem.fromJson(json);
      expect(item.id, 'agent_456');
      expect(item.role, 'Subagent');
      expect(item.status, 'waiting_for_input');
    });
  });

  group('SubagentsDrawer Widget', () {
    testWidgets('SubagentsDrawer renders list of active subagents', (tester) async {
      final subagents = [
        const SubagentItem(id: 'agent-1', role: 'Codebase Researcher', status: 'running'),
        const SubagentItem(id: 'agent-2', role: 'Test Runner', status: 'waiting_for_input', stateDetail: 'Waiting for unit test confirmation'),
      ];

      final GlobalKey<ScaffoldState> scaffoldKey = GlobalKey<ScaffoldState>();

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            key: scaffoldKey,
            endDrawer: SubagentsDrawer(
              subagents: subagents,
              onKillAgent: (_) {},
            ),
            body: const SizedBox(),
          ),
        ),
      );

      // Open the end drawer
      scaffoldKey.currentState?.openEndDrawer();
      await tester.pumpAndSettle();

      expect(find.text('Subagents (2)'), findsOneWidget);
      expect(find.text('Codebase Researcher'), findsOneWidget);
      expect(find.text('Test Runner'), findsOneWidget);
      expect(find.text('Waiting for unit test confirmation'), findsOneWidget);
    });

    testWidgets('SubagentsDrawer triggers onKillAgent when kill button is tapped', (tester) async {
      String? killedId;
      final subagents = [
        const SubagentItem(id: 'agent-99', role: 'Database Debugger', status: 'running'),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentsDrawer(
              subagents: subagents,
              onKillAgent: (id) => killedId = id,
            ),
          ),
        ),
      );

      expect(find.text('Database Debugger'), findsOneWidget);
      final killBtn = find.byTooltip('Terminer le sous-agent');
      expect(killBtn, findsOneWidget);

      await tester.tap(killBtn);
      await tester.pumpAndSettle();

      expect(killedId, equals('agent-99'));
    });

    testWidgets('SubagentsDrawer shows empty state when list is empty', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentsDrawer(
              subagents: const [],
              onKillAgent: (_) {},
            ),
          ),
        ),
      );

      expect(find.text('Aucun sous-agent actif'), findsOneWidget);
    });

    testWidgets('SubagentsDrawer triggers onKillAll when Kill All button is tapped', (tester) async {
      bool killedAll = false;
      final subagents = [
        const SubagentItem(id: 'agent-1', role: 'Agent 1', status: 'running'),
        const SubagentItem(id: 'agent-2', role: 'Agent 2', status: 'running'),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SubagentsDrawer(
              subagents: subagents,
              onKillAgent: (_) {},
              onKillAll: () => killedAll = true,
            ),
          ),
        ),
      );

      final killAllBtn = find.text('Terminer tout');
      expect(killAllBtn, findsOneWidget);

      await tester.tap(killAllBtn);
      await tester.pumpAndSettle();

      expect(killedAll, isTrue);
    });
  });
}
