import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/sessions/display_options.dart';

void main() {
  group('Workspace & Project Concurrency, Shared State & Race Conditions', () {
    final officialProjects = [
      const ProjectItem(
        id: 'p1',
        name: 'antigravity-add-model-main',
        folderUri: 'file:///c%3A/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main',
        path: 'c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main',
      ),
      const ProjectItem(
        id: 'p2',
        name: 'sols-pro-vision',
        folderUri: 'file:///c%3A/Users/amine/Downloads/sols-pro-vision',
        path: 'c:/Users/amine/Downloads/sols-pro-vision',
      ),
      const ProjectItem(
        id: 'p3',
        name: 'www - Copie',
        folderUri: 'file:///c%3A/Users/amine/Downloads/raouf%20taxi/www%20-%20Copie',
        path: 'c:/Users/amine/Downloads/raouf taxi/www - Copie',
      ),
      const ProjectItem(
        id: 'p4',
        name: 'c:\\Users\\amine\\OmniRoute',
        folderUri: 'file:///c%3A%5CUsers%5Camine%5COmniRoute',
        path: 'c:/Users/amine/OmniRoute',
      ),
      const ProjectItem(
        id: 'p5',
        name: 'mo7i',
        folderUri: 'file:///c%3A/Users/amine/Desktop/mo7i',
        path: 'c:/Users/amine/Desktop/mo7i',
      ),
      const ProjectItem(
        id: 'p6',
        name: 'c:\\Users\\amine\\Desktop\\ooredoo\\posweb',
        folderUri: 'file:///c%3A%5CUsers%5Camine%5CDesktop%5Cooredoo%5Cposweb',
        path: 'c:/Users/amine/Desktop/ooredoo/posweb',
      ),
    ];

    test('Scénario 1 : 100 sessions concurrentes réparties sans création de projets fantômes', () {
      final sessions = <CascadeSession>[];

      // Génération de 100 sessions réparties sur les projets officiels
      for (int i = 0; i < 100; i++) {
        final proj = officialProjects[i % officialProjects.length];
        sessions.add(
          CascadeSession(
            id: 'session-$i',
            workspacePath: i % 2 == 0 ? proj.path : proj.folderUri,
            title: 'Tâche de développement #$i',
            status: 'CASCADE_STATUS_READY',
            time: 'Maintenant',
            projectId: proj.id,
          ),
        );
      }

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: officialProjects,
      );

      // Exactement les 6 projets officiels (aucun projet fantôme)
      expect(grouped.keys.length, equals(6));
      expect(grouped.containsKey('antigravity-workspace'), isFalse);
      expect(grouped.containsKey('Outside of Project'), isFalse);

      int totalCount = 0;
      grouped.forEach((_, list) => totalCount += list.length);
      expect(totalCount, equals(100));
    });

    test('Scénario 2 : Filtrage strict des sous-agents même s\'ils sont injectés dans la liste', () {
      final mixedSessions = [
        const CascadeSession(
          id: 's-user-1',
          workspacePath: 'c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main',
          title: 'Implémenter le nouveau modèle Claude Sonnet 4.6',
          status: 'CASCADE_STATUS_READY',
          time: 'Maintenant',
        ),
        const CascadeSession(
          id: 'subagent-1',
          workspacePath: 'subagent-Cleanup-planner-researcher',
          title: 'subagent-Cleanup-planner-researcher',
          status: 'CASCADE_STATUS_RUNNING',
          time: 'Maintenant',
        ),
        const CascadeSession(
          id: 'subagent-2',
          workspacePath: 'antigravity-workspace',
          title: 'subagent_Documentation_author',
          status: 'CASCADE_STATUS_READY',
          time: 'Maintenant',
        ),
      ];

      // Filtrage via isAvailable
      final available = mixedSessions.where((s) => s.isAvailable).toList();
      expect(available.length, equals(1));
      expect(available.first.id, equals('s-user-1'));

      final grouped = groupSessions(
        sessions: available,
        groupBy: SessionGroupBy.project,
        projects: officialProjects,
      );

      expect(grouped.containsKey('subagent-Cleanup-planner-researcher'), isFalse);
      expect(grouped.containsKey('antigravity-workspace'), isFalse);
    });

    test('Scénario 3 : Concurrence de chemins Windows avec échappement URL, slashes et antislashs', () {
      final sessions = [
        const CascadeSession(
          id: 'omni-1',
          workspacePath: 'C:\\Users\\amine\\OmniRoute',
          title: 'Refonte API OmniRoute',
          status: 'CASCADE_STATUS_READY',
          time: '10m',
        ),
        const CascadeSession(
          id: 'omni-2',
          workspacePath: 'file:///c%3A%5CUsers%5Camine%5COmniRoute',
          title: 'Fix proxy routing',
          status: 'CASCADE_STATUS_READY',
          time: '5m',
        ),
        const CascadeSession(
          id: 'pos-1',
          workspacePath: 'c:/Users/amine/Desktop/ooredoo/posweb',
          title: 'Mise à jour caisse',
          status: 'CASCADE_STATUS_READY',
          time: '1h',
        ),
      ];

      final grouped = groupSessions(
        sessions: sessions,
        groupBy: SessionGroupBy.project,
        projects: officialProjects,
      );

      expect(grouped['c:\\Users\\amine\\OmniRoute']?.length, equals(2));
      expect(grouped['c:\\Users\\amine\\Desktop\\ooredoo\\posweb']?.length, equals(1));
      expect(grouped.containsKey('Outside of Project'), isFalse);
    });

    test('Scénario 4 : Préservation de tous les projets officiels même quand le nombre de sessions est 0', () {
      final grouped = groupSessions(
        sessions: const [],
        groupBy: SessionGroupBy.project,
        projects: officialProjects,
      );

      // Tous les 6 projets doivent être listés (matching 100% Antigravity IDE)
      expect(grouped.keys.length, equals(6));
      for (final p in officialProjects) {
        expect(grouped.containsKey(p.name), isTrue);
        expect(grouped[p.name]?.isEmpty, isTrue);
      }
    });
  });
}
