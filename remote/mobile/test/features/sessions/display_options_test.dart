import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/sessions/display_options.dart';
import 'package:mobile/features/sessions/sessions_list.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('Display Options Helpers', () {
    final s1 = const CascadeSession(
      id: 'sess_1',
      workspacePath: 'c:/projects/antigravity/app',
      title: 'Zebra Feature',
      status: 'CASCADE_STATUS_RUNNING',
      time: '10m',
      lastPrompt: 'Add Zebra',
    );

    final s2 = const CascadeSession(
      id: 'sess_2',
      workspacePath: 'c:/projects/antigravity/app',
      title: 'Alpha Bugfix',
      status: 'CASCADE_STATUS_READY',
      time: '1h',
      lastPrompt: 'Fix Alpha',
    );

    final s3 = const CascadeSession(
      id: 'sess_3',
      workspacePath: 'c:/other/project',
      title: 'Beta Refactor',
      status: 'CASCADE_STATUS_COMPLETED',
      time: '2d',
      lastPrompt: 'Refactor Beta',
    );

    final sessions = [s1, s2, s3];

    test('groupSessions by Project', () {
      final projects = [
        const ProjectItem(
          id: 'p1',
          name: 'antigravity',
          folderUri: 'file:///c:/projects/antigravity',
          path: 'c:/projects/antigravity',
        ),
      ];

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: projects,
      );

      expect(grouped.containsKey('antigravity'), isTrue);
      expect(grouped['antigravity']!.length, equals(2));
    });

    test('groupSessions merges file:/// and outside-of-project into single Conversations without duplicates', () {
      final mixedSessions = [
        const CascadeSession(
          id: 's_proj',
          workspacePath: 'c:/projects/antigravity',
          title: 'Project Session',
          status: 'ready',
          time: '1h',
        ),
        const CascadeSession(
          id: 's_file',
          workspacePath: 'file:///',
          title: 'File Session',
          status: 'ready',
          time: '2h',
        ),
        const CascadeSession(
          id: 's_out',
          workspacePath: '',
          projectId: 'outside-of-project',
          title: 'Outside Session',
          status: 'ready',
          time: '3h',
        ),
      ];

      final projects = [
        const ProjectItem(
          id: 'p1',
          name: 'antigravity',
          folderUri: 'file:///c:/projects/antigravity',
          path: 'c:/projects/antigravity',
        ),
        const ProjectItem(
          id: 'p2',
          name: 'empty_proj',
          folderUri: 'file:///c:/projects/empty',
          path: 'c:/projects/empty',
        ),
      ];

      final grouped = groupSessions(
        sessions: mixedSessions,
        groupBy: SessionGroupBy.project,
        projects: projects,
      );

      expect(grouped.containsKey('antigravity'), isTrue);
      expect(grouped['antigravity']!.length, equals(1));
      expect(grouped.containsKey('Outside of Project'), isFalse);
      expect(grouped.containsKey('Conversations'), isTrue);
      expect(grouped['Conversations']!.length, equals(2));
      // Conversations must be placed at the very end after all projects
      expect(grouped.keys.last, equals('Conversations'));
    });

    test('groupSessions by Workspace', () {
      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.workspace,
      );

      expect(grouped.keys.length, equals(2));
      expect(grouped.values.expand((element) => element).length, equals(3));
    });

    test('groupSessions by Status', () {
      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.status,
      );

      expect(grouped.containsKey('Active'), isTrue);
      expect(grouped['Active']!.first.id, equals('sess_1'));
      expect(grouped.containsKey('Ready'), isTrue);
      expect(grouped['Ready']!.first.id, equals('sess_2'));
    });

    test('groupSessions by None', () {
      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.none,
      );

      expect(grouped.containsKey('All Conversations'), isTrue);
      expect(grouped['All Conversations']!.length, equals(3));
    });

    test('sortSessions Alphabetical', () {
      final sorted = sortSessions(
        sessions: sessions,
        sortBy: SessionSortBy.alphabetical,
      );

      expect(sorted.first.title, equals('Alpha Bugfix'));
      expect(sorted.last.title, equals('Zebra Feature'));
    });

    test('sortSessions Last Prompt', () {
      final sorted = sortSessions(
        sessions: sessions,
        sortBy: SessionSortBy.lastPrompt,
      );

      expect(sorted.first.lastPrompt, equals('Add Zebra'));
      expect(sorted.last.lastPrompt, equals('Refactor Beta'));
    });

    test('sortSessions Date Added', () {
      final sorted = sortSessions(
        sessions: sessions,
        sortBy: SessionSortBy.dateAdded,
      );

      expect(sorted.first.id, equals('sess_1'));
      expect(sorted.last.id, equals('sess_3'));
    });
  });

  group('DisplayOptionsMenuButton Widget', () {
    testWidgets('renders DisplayOptionsMenuButton and triggers callbacks', (tester) async {
      SessionGroupBy groupBy = SessionGroupBy.project;
      SessionSortBy sortBy = SessionSortBy.lastUpdated;
      SessionSubtitle subtitle = SessionSubtitle.worktree;
      bool filterToggled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: DisplayOptionsMenuButton(
                selectedGroupBy: groupBy,
                selectedSortBy: sortBy,
                selectedSubtitle: subtitle,
                isFilterOpen: false,
                onGroupByChanged: (val) => groupBy = val,
                onSortByChanged: (val) => sortBy = val,
                onSubtitleChanged: (val) => subtitle = val,
                onToggleFilter: () => filterToggled = true,
              ),
            ),
          ),
        ),
      );

      expect(find.byType(DisplayOptionsMenuButton), findsOneWidget);
      expect(find.byIcon(Icons.tune_rounded), findsOneWidget);

      // Open popup menu
      await tester.tap(find.byIcon(Icons.tune_rounded));
      await tester.pumpAndSettle();

      expect(find.text('Group By'), findsOneWidget);
      expect(find.text('Sort Conversations'), findsOneWidget);
      expect(find.text('Subtitles'), findsOneWidget);
      expect(find.text('Filter'), findsOneWidget);

      // Select 'Workspace' in Group By
      await tester.tap(find.text('Workspace'));
      await tester.pumpAndSettle();

      expect(groupBy, equals(SessionGroupBy.workspace));

      // Open popup menu again and tap Filter
      await tester.tap(find.byIcon(Icons.tune_rounded));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Filter'));
      await tester.pumpAndSettle();

      expect(filterToggled, isTrue);
    });

    testWidgets('renders LeftSidebarDrawer with real-time spinner on running session', (tester) async {
      const runningSession = CascadeSession(
        id: 's_run',
        workspacePath: '/ws/proj1',
        title: 'Streaming Session',
        status: 'CASCADE_STATUS_RUNNING',
        time: 'Just now',
      );
      const idleSession = CascadeSession(
        id: 's_idle',
        workspacePath: '/ws/proj1',
        title: 'Idle Session',
        status: 'CASCADE_STATUS_READY',
        time: '2h',
      );

      expect(runningSession.isRunning, isTrue);
      expect(idleSession.isRunning, isFalse);

      final mutated = idleSession.copyWith(status: 'CASCADE_STATUS_RUNNING');
      expect(mutated.isRunning, isTrue);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            drawer: LeftSidebarDrawer(
              sessions: const [runningSession, idleSession],
              activeSessionId: 's_run',
              isConnected: true,
              onToggleConnection: () {},
              onSessionSelected: (_) {},
              onNewConversation: () {},
            ),
            body: const Center(child: Text('Content')),
          ),
        ),
      );

      // Open Drawer
      final ScaffoldState state = tester.firstState(find.byType(Scaffold));
      state.openDrawer();
      await tester.pump(const Duration(milliseconds: 400));

      // Verify title & running spinner
      expect(find.text('Streaming Session'), findsOneWidget);
      expect(find.text('Idle Session'), findsOneWidget);
      expect(find.byKey(const ValueKey('running')), findsOneWidget);
    });

    testWidgets('LeftSidebarDrawer loads persisted display options from SharedPreferences', (tester) async {
      SharedPreferences.setMockInitialValues({
        'session_group_by': SessionGroupBy.workspace.index,
        'session_sort_by': SessionSortBy.alphabetical.index,
        'session_subtitle': SessionSubtitle.worktree.index,
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            drawer: LeftSidebarDrawer(
              sessions: const [],
              activeSessionId: '',
              isConnected: true,
              onToggleConnection: () {},
              onSessionSelected: (_) {},
              onNewConversation: () {},
            ),
            body: const Center(child: Text('Content')),
          ),
        ),
      );

      final ScaffoldState state = tester.firstState(find.byType(Scaffold));
      state.openDrawer();
      await tester.pumpAndSettle();

      // With SessionGroupBy.workspace, the section header text shows 'Workspaces' instead of 'Projects'
      expect(find.text('Workspaces'), findsOneWidget);
    });
  });
}
