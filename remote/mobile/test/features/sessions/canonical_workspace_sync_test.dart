import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/workspace_path.dart';
import 'package:mobile/features/sessions/display_options.dart';
import 'package:mobile/features/sessions/conversation_history_screen.dart';
import 'package:mobile/features/sessions/sessions_list.dart';

void main() {
  group('WorkspacePath Canonical Normalization Tests', () {
    test('canonicalPath normalizes Windows drive letters, slashes, URIs and trailing slashes', () {
      expect(WorkspacePath.canonicalPath('C:\\Repo\\Project'), 'c:/Repo/Project');
      expect(WorkspacePath.canonicalPath('c:/Repo/Project/'), 'c:/Repo/Project');
      expect(WorkspacePath.canonicalPath('file:///C:/Repo/Project'), 'c:/Repo/Project');
      expect(WorkspacePath.canonicalPath('file:///c%3A/Repo/Project/'), 'c:/Repo/Project');
      expect(WorkspacePath.canonicalPath('file:///c:/Users/amine/Downloads/my%20app'), 'c:/Users/amine/Downloads/my app');
    });

    test('isSameWorkspace compares case-insensitively with canonical form', () {
      expect(WorkspacePath.isSameWorkspace('C:\\Repo\\Project', 'file:///c:/repo/project/'), isTrue);
      expect(WorkspacePath.isSameWorkspace('c:/repo/project', 'C:/repo/project-other'), isFalse);
    });

    test('isSubdirOf enforces proper path boundaries to prevent prefix false-positives', () {
      expect(WorkspacePath.isSubdirOf('c:/repo/packages/mobile', 'c:/repo'), isTrue);
      expect(WorkspacePath.isSubdirOf('C:\\Repo\\packages\\mobile', 'file:///c:/repo'), isTrue);
      // Faux positifs évités (pas de loose .contains)
      expect(WorkspacePath.isSubdirOf('c:/repo2', 'c:/repo'), isFalse);
      expect(WorkspacePath.isSubdirOf('c:/repo-old', 'c:/repo'), isFalse);
      expect(WorkspacePath.isSubdirOf('c:/repo_backup', 'c:/repo'), isFalse);
    });
  });

  group('Deterministic Nested Workspace Grouping Tests', () {
    final projects = [
      ProjectItem(
        id: 'proj-root',
        name: 'Monorepo Root',
        folderUri: 'file:///c:/monorepo',
        path: 'c:/monorepo',
      ),
      ProjectItem(
        id: 'proj-mobile',
        name: 'Mobile App',
        folderUri: 'file:///c:/monorepo/packages/mobile',
        path: 'c:/monorepo/packages/mobile',
      ),
      ProjectItem(
        id: 'proj-backend',
        name: 'Backend API',
        folderUri: 'file:///c:/monorepo/packages/backend',
        path: 'c:/monorepo/packages/backend',
      ),
    ];

    test('resolves session in nested workspace to the most specific child project', () {
      final sessions = [
        const CascadeSession(
          id: 's-root',
          workspacePath: 'c:/monorepo',
          title: 'Root Session',
          status: 'CASCADE_STATUS_READY',
          time: '1m',
        ),
        const CascadeSession(
          id: 's-mobile',
          workspacePath: 'C:\\monorepo\\packages\\mobile\\lib',
          title: 'Mobile Session',
          status: 'CASCADE_STATUS_READY',
          time: '2m',
        ),
        const CascadeSession(
          id: 's-backend',
          workspacePath: 'file:///c:/monorepo/packages/backend/src',
          title: 'Backend Session',
          status: 'CASCADE_STATUS_READY',
          time: '3m',
        ),
        const CascadeSession(
          id: 's-other',
          workspacePath: 'c:/monorepo2/somewhere',
          title: 'Other Session',
          status: 'CASCADE_STATUS_READY',
          time: '4m',
        ),
      ];

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: projects,
      );

      // s-root -> Monorepo Root
      expect(grouped['Monorepo Root']?.map((s) => s.id).toList(), contains('s-root'));
      // s-mobile -> Mobile App (et PAS Monorepo Root !)
      expect(grouped['Mobile App']?.map((s) => s.id).toList(), contains('s-mobile'));
      expect(grouped['Monorepo Root']?.map((s) => s.id).toList(), isNot(contains('s-mobile')));
      // s-backend -> Backend API
      expect(grouped['Backend API']?.map((s) => s.id).toList(), contains('s-backend'));
      // s-other -> somewhere (pas de fausse correspondance avec monorepo)
      expect(grouped['Monorepo Root']?.map((s) => s.id).toList(), isNot(contains('s-other')));
      expect(grouped['somewhere']?.map((s) => s.id).toList(), contains('s-other'));
    });
  });

  group('Empty List & Session Parser Tests', () {
    test('parses empty sessions payload without throwing and returns empty list', () {
      final parsed = SessionParser.parseListSessions({
        'version': 105,
        'projects': [],
        'sessions': [],
      });
      expect(parsed, isEmpty);
    });
  });

  group('UI Consistency: Sidebar vs Conversation History', () {
    final projects = [
      ProjectItem(
        id: 'p1',
        name: 'Workspace Alpha',
        folderUri: 'file:///c:/workspaces/alpha',
        path: 'c:/workspaces/alpha',
      ),
    ];

    final sessions = [
      const CascadeSession(
        id: 's1',
        workspacePath: 'c:/workspaces/alpha',
        title: 'Conversation 1',
        status: 'CASCADE_STATUS_READY',
        time: 'Just now',
        projectId: 'p1',
      ),
    ];

    testWidgets('ConversationHistoryScreen uses the canonical projects list for grouping', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: ConversationHistoryScreen(
            sessions: sessions,
            projects: projects,
            activeSessionId: 's1',
            onSessionSelected: (_) {},
          ),
        ),
      );

      await tester.pumpAndSettle();
      // Doit afficher l'en-tête de projet officiel "Workspace Alpha"
      expect(find.text('Workspace Alpha'), findsOneWidget);
    });

    testWidgets('LeftSidebarDrawer uses the canonical projects list for grouping', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            drawer: LeftSidebarDrawer(
              sessions: sessions,
              projects: projects,
              activeSessionId: 's1',
              onSessionSelected: (_) {},
              onNewConversation: () {},
              onToggleConnection: () {},
            ),
          ),
        ),
      );

      // Ouvrir le drawer
      final scaffoldState = tester.state<ScaffoldState>(find.byType(Scaffold));
      scaffoldState.openDrawer();
      await tester.pumpAndSettle();

      expect(find.text('Workspace Alpha'), findsOneWidget);
    });
  });
}
