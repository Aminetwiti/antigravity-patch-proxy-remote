import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/widgets/right_sidebar_drawer.dart';

void main() {
  testWidgets('RightSidebarDrawer expands and displays Git Worktrees', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final out = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        out.add(map);
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;

        if (reqId != null && type == 'list_git_worktrees') {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({
                'requestId': reqId,
                'worktrees': [
                  {
                    'branch': 'main',
                    'path': '/workspace/main',
                    'isCurrent': true,
                  },
                  {
                    'branch': 'feat-refactor-auth',
                    'path': '/workspace/worktrees/feat-refactor-auth',
                    'isCurrent': false,
                  },
                ],
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF8B5CF6),
            brightness: Brightness.dark,
          ),
        ),
        home: Scaffold(
          body: RightSidebarDrawer(
            api: api,
            activeSessionId: 'test-session',
            workspacePath: '/workspace/main',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify Git Worktrees section presence
    expect(find.text('Git Worktrees'), findsOneWidget);

    // Tap on Git Worktrees row to expand
    await tester.tap(find.text('Git Worktrees'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Verify worktree branches rendered
    expect(find.text('main'), findsWidgets);
    expect(find.text('feat-refactor-auth'), findsWidgets);
    expect(find.text('Actif'), findsOneWidget);
    expect(find.text('Nouveau Worktree'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });
}
