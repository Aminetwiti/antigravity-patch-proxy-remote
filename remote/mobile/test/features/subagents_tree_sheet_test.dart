import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/subagents/subagents_tree_sheet.dart';
import 'package:mobile/features/subagents/widgets/subagent_detail_modal.dart';
import 'package:mobile/widgets/skeleton_loader.dart';

void main() {
  testWidgets('SubagentsTreeSheet affiche la liste des sous-agents après chargement', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String ? jsonDecode(d) as Map<String, dynamic> : Map<String, dynamic>.from(d as Map);
        if (map['type'] == 'get_subagents') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'payload': {
              'subagents': [
                {
                  'id': 'sub-1',
                  'name': 'Codebase Researcher',
                  'type': 'research',
                  'status': 'completed',
                  'model': 'claude-3-5-sonnet',
                  'startedAt': '2026-08-18T10:00:00Z',
                  'completedAt': '2026-08-18T10:02:15Z',
                  'prompt': 'Explore auth middleware',
                },
                {
                  'id': 'sub-2',
                  'name': 'DB Optimizer',
                  'type': 'database-debugger',
                  'status': 'running',
                  'model': 'gpt-4o',
                  'startedAt': '2026-08-18T10:03:00Z',
                  'parentId': 'sub-1',
                },
              ],
            },
          }));
        }
      },
    );
    addTearDown(ctrl.close);
    addTearDown(api.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SubagentsTreeSheet(
            api: api,
            cascadeId: 'test-cascade-1',
            sessionTitle: 'Refactor Auth System',
          ),
        ),
      ),
    );

    // Initial loading
    expect(find.byType(SkeletonLoader), findsOneWidget);
    await tester.pumpAndSettle();

    // Renders subagent cards
    expect(find.text('Hiérarchie des Sous-Agents'), findsOneWidget);
    expect(find.text('Codebase Researcher'), findsOneWidget);
    expect(find.text('DB Optimizer'), findsOneWidget);
    expect(find.text('research'), findsOneWidget);
    expect(find.text('database-debugger'), findsOneWidget);
    expect(find.text('Explore auth middleware'), findsOneWidget);
  });

  testWidgets('SubagentsTreeSheet affiche état vide si aucun sous-agent', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String ? jsonDecode(d) as Map<String, dynamic> : Map<String, dynamic>.from(d as Map);
        if (map['type'] == 'get_subagents') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'data': {
              'cascadeId': 'test-empty',
              'subagents': [],
            },
          }));
        }
      },
    );
    addTearDown(ctrl.close);
    addTearDown(api.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SubagentsTreeSheet(
            api: api,
            cascadeId: 'test-empty',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(find.text('Aucun sous-agent actif'), findsOneWidget);
  });

  testWidgets('SubagentsTreeSheet opens SubagentDetailModal on subagent card tap', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String ? jsonDecode(d) as Map<String, dynamic> : Map<String, dynamic>.from(d as Map);
        if (map['type'] == 'get_subagents') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'data': {
              'cascadeId': 'test-cascade-detail',
              'subagents': [
                {
                  'id': 'sub-detailed-1',
                  'name': 'Performance Auditor',
                  'type': 'auditor',
                  'status': 'completed',
                  'prompt': 'Analyze memory leaks in WebSocket bridge',
                },
              ],
            },
          }));
        }
      },
    );
    addTearDown(ctrl.close);
    addTearDown(api.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SubagentsTreeSheet(
            api: api,
            cascadeId: 'test-cascade-detail',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(find.text('Performance Auditor'), findsOneWidget);

    // Tap on the card
    await tester.tap(find.text('Performance Auditor'));
    await tester.pumpAndSettle();

    // Verify SubagentDetailModal content
    expect(find.byType(SubagentDetailModal), findsOneWidget);
    expect(find.text('ID DU SOUS-AGENT'), findsOneWidget);
    expect(find.text('sub-detailed-1'), findsOneWidget);
    expect(find.text('Mission / Instructions'), findsOneWidget);
    expect(find.text('Copier Mission'), findsOneWidget);
  });
}
