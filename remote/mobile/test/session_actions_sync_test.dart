import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/sessions/display_options.dart';

void main() {
  group('Mobile Session Actions & Real-Time Sync Scenarios', () {
    test('Scenario 1: Parse sessions and verify sorting by lastUpdated (most recent first)', () {
      final now = DateTime.now();
      final sessions = [
        CascadeSession(
          id: 'sess-1',
          workspacePath: 'c:/proj/main',
          title: 'Older Session',
          status: 'CASCADE_STATUS_READY',
          time: '10m',
          updatedAt: now.subtract(const Duration(minutes: 10)),
        ),
        CascadeSession(
          id: 'sess-2',
          workspacePath: 'c:/proj/main',
          title: 'Latest Active Session',
          status: 'CASCADE_STATUS_READY',
          time: '1m',
          updatedAt: now.subtract(const Duration(minutes: 1)),
        ),
        CascadeSession(
          id: 'sess-3',
          workspacePath: 'c:/proj/main',
          title: 'Intermediate Session',
          status: 'CASCADE_STATUS_READY',
          time: '5m',
          updatedAt: now.subtract(const Duration(minutes: 5)),
        ),
      ];

      final sorted = sortSessions(
        sessions: sessions,
        sortBy: SessionSortBy.lastUpdated,
      );

      expect(sorted[0].id, equals('sess-2'));
      expect(sorted[1].id, equals('sess-3'));
      expect(sorted[2].id, equals('sess-1'));
    });

    test('Scenario 2: Desktop deletion event removes session and shifts active selection', () {
      final s1 = CascadeSession(
        id: 'sess-1',
        workspacePath: 'c:/proj/main',
        title: 'Active Target',
        status: 'CASCADE_STATUS_READY',
        time: 'Just now',
      );
      final s2 = CascadeSession(
        id: 'sess-2',
        workspacePath: 'c:/proj/main',
        title: 'Backup Session',
        status: 'CASCADE_STATUS_READY',
        time: '5m',
      );

      List<CascadeSession> currentSessions = [s1, s2];
      String activeId = 'sess-1';

      // Simule la réception de session_deleted pour sess-1
      const deletedId = 'sess-1';
      currentSessions = currentSessions.where((s) => s.id != deletedId).toList();
      if (activeId == deletedId) {
        activeId = currentSessions.isNotEmpty ? currentSessions.first.id : '';
      }

      expect(currentSessions.length, equals(1));
      expect(currentSessions.first.id, equals('sess-2'));
      expect(activeId, equals('sess-2'));
    });

    test('Scenario 3: sessions_updated payload with deleted session does not keep ghosts', () {
      final now = DateTime.now();
      // Payload reçu du serveur ne contenant plus sess-to-delete
      final payload = {
        'sessions': [
          {
            'cascadeId': 'sess-survivor-1',
            'title': 'Remaining Alpha',
            'workspace': 'c:/proj/main',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': now.toIso8601String(),
          },
          {
            'cascadeId': 'sess-survivor-2',
            'title': 'Remaining Beta',
            'workspace': 'c:/proj/main',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': now.subtract(const Duration(minutes: 2)).toIso8601String(),
          },
        ]
      };

      final parsed = (payload['sessions'] as List)
          .map((s) => CascadeSession.fromJson(Map<String, dynamic>.from(s as Map)))
          .toList();

      String activeSessionId = 'sess-deleted-on-desktop';

      // Logique de synchronisation mobile
      final stillActive = parsed.any((s) => s.id == activeSessionId);
      List<CascadeSession> updatedSessions;
      if (activeSessionId.isNotEmpty && stillActive) {
        updatedSessions = parsed;
      } else {
        // La session active a été supprimée du PC -> switch automatique
        updatedSessions = parsed;
        activeSessionId = parsed.first.id;
      }

      expect(updatedSessions.length, equals(2));
      expect(updatedSessions.any((s) => s.id == 'sess-deleted-on-desktop'), isFalse);
      expect(activeSessionId, equals('sess-survivor-1'));
    });

    test('Scenario 4: Alphabetical and DateAdded sorting options', () {
      final sessions = [
        CascadeSession(id: 'c', workspacePath: '', title: 'Zebra', status: '', time: ''),
        CascadeSession(id: 'a', workspacePath: '', title: 'Alpha', status: '', time: ''),
        CascadeSession(id: 'b', workspacePath: '', title: 'Beta', status: '', time: ''),
      ];

      final alphaSorted = sortSessions(sessions: sessions, sortBy: SessionSortBy.alphabetical);
      expect(alphaSorted.map((s) => s.title).toList(), equals(['Alpha', 'Beta', 'Zebra']));

      final dateSorted = sortSessions(sessions: sessions, sortBy: SessionSortBy.dateAdded);
      expect(dateSorted.map((s) => s.id).toList(), equals(['a', 'b', 'c']));
    });
  });
}
