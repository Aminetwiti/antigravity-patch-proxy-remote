import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';

void main() {
  group('SessionParser', () {
    test('parses structured sessions response (protocol v2)', () {
      final data = {
        'sessions': [
          {
            'cascadeId': 'a1b2c3d4-1111-4a1a-9b2b-000000000001',
            'title': 'Poème Sur La Gravité',
            'workspace': 'file:///C:/Users/amine/proj',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': '2026-08-11T15:00:00Z',
          },
          {
            'cascadeId': 'a1b2c3d4-2222-4b2b-9c3c-000000000002',
            'title': 'Doctor UI Data Issue',
            'status': 'CASCADE_STATUS_RUNNING',
            'isIde': true,
          },
        ],
      };

      final sessions = SessionParser.parseListSessions(data);

      expect(sessions, hasLength(2));
      expect(sessions.first.id, 'a1b2c3d4-1111-4a1a-9b2b-000000000001');
      expect(sessions.first.title, 'Poème Sur La Gravité');
      expect(sessions.first.workspacePath, 'file:///C:/Users/amine/proj');
      expect(sessions.first.status, 'CASCADE_STATUS_READY');
      expect(sessions.first.isIde, false);
      expect(sessions.last.title, 'Doctor UI Data Issue');
      expect(sessions.last.status, 'CASCADE_STATUS_RUNNING');
      expect(sessions.last.isIde, true);
    });

    test('extracts sessions from gateway field dump (legacy fallback)', () {
      final data = {
        'fields': [
          {
            'field': 1,
            'wireType': 2,
            'bytes': 42,
            'text':
                '{"trajectory":{"trajectoryId":"a1b2c3d4-1111-4a1a-9b2b-000000000001"}} Poème Sur La Gravité',
          },
          {
            'field': 1,
            'wireType': 2,
            'bytes': 58,
            'text':
                '{"trajectory":{"trajectoryId":"a1b2c3d4-2222-4b2b-9c3c-000000000002"}} Doctor UI Data Issue',
          },
          {'field': 2, 'wireType': 0, 'value': 3},
        ],
      };

      final sessions = SessionParser.parseListSessions(data);

      // The gateway sends only `bytes: <len>` without the payload, so the
      // heuristic falls back to the text snippet — UUIDs + titles surface.
      expect(sessions, hasLength(2));
      expect(sessions.first.id, 'a1b2c3d4-1111-4a1a-9b2b-000000000001');
      expect(sessions.first.title, 'Poème Sur La Gravité');
    });

    test('ignores non-trajectory fields', () {
      final data = {
        'fields': [
          {'field': 2, 'wireType': 0, 'value': 3},
          {'field': 3, 'wireType': 2, 'bytes': 10},
        ],
      };
      expect(SessionParser.parseListSessions(data), isEmpty);
    });

    test('returns empty on malformed payload', () {
      expect(SessionParser.parseListSessions({'nope': true}), isEmpty);
      expect(SessionParser.parseListSessions({'fields': 'x'}), isEmpty);
    });

    test('isAvailable correctly filters out archived, deleted, and killed sessions', () {
      final active = CascadeSession(
        id: '11111111-1111-1111-1111-111111111111',
        workspacePath: 'file:///C:/Users/amine/proj',
        title: 'Active Session',
        status: 'CASCADE_STATUS_READY',
        time: 'Just now',
      );
      final running = CascadeSession(
        id: '22222222-2222-2222-2222-222222222222',
        workspacePath: 'file:///C:/Users/amine/proj',
        title: 'Running Session',
        status: 'CASCADE_STATUS_RUNNING',
        time: 'Just now',
      );
      final archived = CascadeSession(
        id: '33333333-3333-3333-3333-333333333333',
        workspacePath: 'file:///C:/Users/amine/proj',
        title: 'Archived Session',
        status: 'CASCADE_STATUS_ARCHIVED',
        time: 'Just now',
      );
      final killed = CascadeSession(
        id: '44444444-4444-4444-4444-444444444444',
        workspacePath: 'file:///C:/Users/amine/proj',
        title: 'Killed Session',
        status: 'CASCADE_STATUS_KILLED',
        time: 'Just now',
      );
      final deleted = CascadeSession(
        id: '55555555-5555-5555-5555-555555555555',
        workspacePath: 'file:///C:/Users/amine/proj',
        title: 'Deleted Session',
        status: 'CASCADE_STATUS_DELETED',
        time: 'Just now',
      );

      expect(active.isAvailable, isTrue);
      expect(running.isAvailable, isTrue);
      expect(archived.isAvailable, isFalse);
      expect(killed.isAvailable, isFalse);
      expect(deleted.isAvailable, isFalse);
    });

    test('correctly parses isSubagent flag and source: 16', () {
      final sub1 = CascadeSession.fromJson({
        'cascadeId': 'sub-1',
        'title': 'Subagent Task',
        'isSubagent': true,
      });
      final sub2 = CascadeSession.fromJson({
        'cascadeId': 'sub-2',
        'title': 'Subagent Source 16',
        'source': 16,
      });
      final root = CascadeSession.fromJson({
        'cascadeId': 'root-1',
        'title': 'Root Conversation',
        'isSubagent': false,
      });

      expect(sub1.isSubagent, isTrue);
      expect(sub2.isSubagent, isTrue);
      expect(root.isSubagent, isFalse);
    });

    test('strictly deduplicates repeated sessions by cascadeId (case-insensitive)', () {
      final data = {
        'sessions': [
          {
            'cascadeId': '153aebf9-a80d-431d-9f52-a006a4f59af8',
            'title': 'Remote Session List Issue',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': '2026-09-03T17:00:00Z',
          },
          {
            'cascadeId': '153AEBF9-A80D-431D-9F52-A006A4F59AF8',
            'title': 'sertin fois in remote (connected )ma...',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': '2026-09-03T16:00:00Z',
          },
          {
            'cascadeId': '153aebf9-a80d-431d-9f52-a006a4f59af8',
            'title': 'sertin fois in remote (duplicate)',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': '2026-09-03T16:00:00Z',
          },
        ],
      };

      final sessions = SessionParser.parseListSessions(data);

      expect(sessions, hasLength(1));
      expect(sessions.first.id.toLowerCase(), '153aebf9-a80d-431d-9f52-a006a4f59af8');
    });

    test('excludes archived sessions unless includeArchived: true', () {
      final data = {
        'sessions': [
          {
            'cascadeId': 'active-1',
            'title': 'Active Task',
            'status': 'CASCADE_STATUS_READY',
            'isArchived': false,
          },
          {
            'cascadeId': 'archived-1',
            'title': 'Archived Task By Flag',
            'status': 'CASCADE_STATUS_READY',
            'isArchived': true,
          },
          {
            'cascadeId': 'archived-2',
            'title': 'Archived Task By Status',
            'status': 'CASCADE_STATUS_ARCHIVED',
          },
        ],
      };

      final activeOnly = SessionParser.parseListSessions(data, includeArchived: false);
      expect(activeOnly, hasLength(1));
      expect(activeOnly.first.id, 'active-1');

      final all = SessionParser.parseListSessions(data, includeArchived: true);
      expect(all, hasLength(3));
    });
  });
}
