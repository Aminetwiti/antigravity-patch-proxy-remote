import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/workspace_path.dart';
import 'package:mobile/features/sessions/display_options.dart';

void main() {
  group('Advanced Rare Cases: Path Normalization & Prefix Collisions', () {
    test('Extreme path normalizations: mixed separators, percent-encoding, long Windows paths', () {
      const p1 = 'file:///c%3A/Users/developer/Downloads/demo%20taxi/www%20-%20Copie';
      const p2 = 'C:\\Users\\developer\\Downloads\\demo taxi\\www - Copie';
      const p3 = 'c:/users/developer/downloads/demo taxi/www - copie/';
      const p4 = '\\\\?\\C:\\Users\\developer\\Downloads\\demo taxi\\www - Copie';

      final c1 = WorkspacePath.canonicalPath(p1);
      final c2 = WorkspacePath.canonicalPath(p2);
      final c3 = WorkspacePath.canonicalPath(p3);
      final c4 = WorkspacePath.canonicalPath(p4);

      expect(c1, equals('c:/Users/developer/Downloads/demo taxi/www - Copie'));
      expect(c2, equals('c:/Users/developer/Downloads/demo taxi/www - Copie'));
      expect(c3, equals('c:/users/developer/downloads/demo taxi/www - copie'));
      expect(c4, equals('c:/Users/developer/Downloads/demo taxi/www - Copie'));

      expect(WorkspacePath.isSameWorkspace(p1, p2), isTrue);
      expect(WorkspacePath.isSameWorkspace(p2, p3), isTrue);
      expect(WorkspacePath.isSameWorkspace(p1, p3), isTrue);
      expect(WorkspacePath.isSameWorkspace(p1, p4), isTrue);
    });

    test('Deeply nested monorepo with 5 similar sibling projects resolves correctly without stealing', () {
      final projects = [
        ProjectItem(id: 'p-root', name: 'app', path: 'c:/repo/app', folderUri: 'file:///c:/repo/app'),
        ProjectItem(id: 'p-copy', name: 'app - Copie', path: 'c:/repo/app - Copie', folderUri: 'file:///c:/repo/app%20-%20Copie'),
        ProjectItem(id: 'p-v2', name: 'app_v2', path: 'c:/repo/app_v2', folderUri: 'file:///c:/repo/app_v2'),
        ProjectItem(id: 'p-sub', name: 'app-submodule', path: 'c:/repo/app/packages/submodule', folderUri: 'file:///c:/repo/app/packages/submodule'),
      ];

      final sessions = [
        const CascadeSession(id: 's1', workspacePath: 'C:\\repo\\app - Copie\\lib\\main.dart', title: 'Copy App', status: 'READY', time: 'now'),
        const CascadeSession(id: 's2', workspacePath: 'c:/repo/app/packages/submodule/test', title: 'Submodule', status: 'READY', time: 'now'),
        const CascadeSession(id: 's3', workspacePath: 'c:/repo/app/other/path', title: 'Root App', status: 'READY', time: 'now'),
        const CascadeSession(id: 's4', workspacePath: 'file:///c:/repo/app_v2/src', title: 'V2 App', status: 'READY', time: 'now'),
      ];

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: projects,
      );

      // s1 doit aller dans 'app - Copie' (et PAS 'app' !)
      expect(grouped['app - Copie']?.map((s) => s.id).toList(), contains('s1'));
      expect(grouped['app']?.map((s) => s.id).toList(), isNot(contains('s1')));

      // s2 doit aller dans 'app-submodule' (enfant le plus spécifique, et PAS 'app' !)
      expect(grouped['app-submodule']?.map((s) => s.id).toList(), contains('s2'));
      expect(grouped['app']?.map((s) => s.id).toList(), isNot(contains('s2')));

      // s3 doit aller dans 'app'
      expect(grouped['app']?.map((s) => s.id).toList(), contains('s3'));

      // s4 doit aller dans 'app_v2' (et PAS 'app' !)
      expect(grouped['app_v2']?.map((s) => s.id).toList(), contains('s4'));
      expect(grouped['app']?.map((s) => s.id).toList(), isNot(contains('s4')));
    });
  });

  group('Advanced Rare Cases: Mutation Safety & Metadata Preservation', () {
    test('CascadeSession copyWith preserves all metadata including isArchived and isPinned', () {
      const original = CascadeSession(
        id: 'sess-abc',
        workspacePath: 'c:/proj',
        title: 'Initial Title',
        status: 'CASCADE_STATUS_READY',
        time: '5m',
        projectId: 'p-1',
        stepCount: 12,
        hasUnread: true,
        isPinned: true,
        isArchived: true,
      );

      // Mutation uniquement du statut
      final updatedStatus = original.copyWith(status: 'CASCADE_STATUS_RUNNING');
      expect(updatedStatus.status, equals('CASCADE_STATUS_RUNNING'));
      expect(updatedStatus.isArchived, isTrue);
      expect(updatedStatus.isPinned, isTrue);
      expect(updatedStatus.hasUnread, isTrue);
      expect(updatedStatus.projectId, equals('p-1'));
      expect(updatedStatus.stepCount, equals(12));

      // Mutation uniquement du titre
      final updatedTitle = original.copyWith(title: 'Nouveau Titre');
      expect(updatedTitle.title, equals('Nouveau Titre'));
      expect(updatedTitle.isArchived, isTrue);
      expect(updatedTitle.isPinned, isTrue);
    });

    test('isAvailable filters out archived sessions even if status string is ambiguous', () {
      // 1. Marqué isArchived: true avec un statut READY
      const s1 = CascadeSession(
        id: 's1',
        workspacePath: 'c:/proj',
        title: 'Session 1',
        status: 'CASCADE_STATUS_READY',
        time: 'now',
        isArchived: true,
      );
      expect(s1.isAvailable, isFalse);

      // 2. Marqué status: CASCADE_STATUS_ARCHIVED avec isArchived: false
      const s2 = CascadeSession(
        id: 's2',
        workspacePath: 'c:/proj',
        title: 'Session 2',
        status: 'CASCADE_STATUS_ARCHIVED',
        time: 'now',
        isArchived: false,
      );
      expect(s2.isAvailable, isFalse);

      // 3. Session normale disponible
      const s3 = CascadeSession(
        id: 's3',
        workspacePath: 'c:/proj',
        title: 'Session 3',
        status: 'CASCADE_STATUS_READY',
        time: 'now',
        isArchived: false,
      );
      expect(s3.isAvailable, isTrue);
    });

    test('CascadeSession.fromJson and SessionParser correctly parse and filter isArchived/isPinned', () {
      final jsonPayload = {
        'version': 42,
        'sessions': [
          {
            'cascadeId': 'c1',
            'title': 'Session 1',
            'workspace': 'proj',
            'workspacePath': 'c:/proj',
            'status': 'CASCADE_STATUS_READY',
            'isPinned': true,
            'isArchived': false,
          },
          {
            'cascadeId': 'c2',
            'title': 'Session 2',
            'workspace': 'proj',
            'workspacePath': 'c:/proj',
            'status': 'CASCADE_STATUS_ARCHIVED',
            'isPinned': false,
            'isArchived': true,
          },
        ],
      };

      // 1. fromJson parse brut
      final list = jsonPayload['sessions'] as List;
      final raw1 = CascadeSession.fromJson(list[0] as Map<String, dynamic>);
      final raw2 = CascadeSession.fromJson(list[1] as Map<String, dynamic>);

      expect(raw1.isPinned, isTrue);
      expect(raw1.isArchived, isFalse);
      expect(raw1.isAvailable, isTrue);

      expect(raw2.isPinned, isFalse);
      expect(raw2.isArchived, isTrue);
      expect(raw2.isAvailable, isFalse);

      // 2. SessionParser.parseListSessions filtre automatiquement les sessions indisponibles (archived)
      final parsed = SessionParser.parseListSessions(jsonPayload);
      expect(parsed.length, equals(1));
      expect(parsed[0].id, equals('c1'));
    });
  });
}
