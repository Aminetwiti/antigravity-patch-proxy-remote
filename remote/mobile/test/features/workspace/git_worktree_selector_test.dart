import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/workspace/git_worktree_selector.dart';

void main() {
  testWidgets('GitWorktreeSelector shows branches and switches worktree', (tester) async {
    String? selectedBranch;
    final branches = ['main', 'feature/remote-v2', 'fix/websocket-reconnect'];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GitWorktreeSelector(
            currentBranch: 'main',
            branches: branches,
            onBranchSelected: (b) => selectedBranch = b,
          ),
        ),
      ),
    );

    expect(find.text('main'), findsOneWidget);
    expect(find.text('feature/remote-v2'), findsOneWidget);

    await tester.tap(find.text('feature/remote-v2'));
    await tester.pumpAndSettle();

    expect(selectedBranch, equals('feature/remote-v2'));
  });

  testWidgets('GitWorktreeSelector marks current branch as Active', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GitWorktreeSelector(
            currentBranch: 'main',
            branches: ['main', 'feature/other'],
            onBranchSelected: (_) {},
          ),
        ),
      ),
    );

    expect(find.text('Active'), findsOneWidget);
  });

  testWidgets('GitWorktreeSelector handles empty branches', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GitWorktreeSelector(
            currentBranch: '',
            branches: [],
            onBranchSelected: (_) {},
          ),
        ),
      ),
    );

    expect(find.text('Active Git Worktree / Branch'), findsOneWidget);
  });
}
