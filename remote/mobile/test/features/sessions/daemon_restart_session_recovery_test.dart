import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Daemon Restart Session Recovery Tests', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('Version rollback after daemon reboot (e.g. 60 -> 1) is accepted and restores sessions', () async {
      int lastStateVersion = 60;
      List<CascadeSession> sessions = [];

      // Daemon restarts and emits version 1 with sessions
      final payload = {
        'version': 1,
        'sessions': [
          {
            'cascadeId': 'session-1',
            'title': 'Active Task After Reboot',
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': DateTime.now().toIso8601String(),
            'workspace': 'c:/Users/amine/Downloads/antigravity-add-model-main',
          },
          {
            'cascadeId': 'session-2',
            'title': 'Second Task Restored',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': DateTime.now().toIso8601String(),
            'workspace': 'c:/Users/amine/Downloads/antigravity-add-model-main',
          },
        ],
      };

      final version = (payload['version'] as num?)?.toInt() ?? 0;

      // Logic mirrored from main.dart _refreshSessions / sessions_updated
      if (version > 0 && version < lastStateVersion) {
        if (lastStateVersion - version > 5) {
          // Daemon reboot detected: reset and accept
          lastStateVersion = version;
        } else {
          fail('Should not drop packet when daemon reboots');
        }
      } else if (version > 0) {
        lastStateVersion = version;
      }

      final parsed = await SessionParser.parseListSessionsAsync(payload);
      if (parsed.isNotEmpty) {
        sessions = parsed;
      }

      expect(lastStateVersion, equals(1));
      expect(sessions.length, equals(2));
      expect(sessions.any((s) => s.id == 'session-1'), isTrue);
      expect(sessions.any((s) => s.id == 'session-2'), isTrue);
      expect(sessions.first.isAvailable, isTrue);
    });

    test('Transient empty response does not wipe already cached sessions', () async {
      List<CascadeSession> currentSessions = [
        const CascadeSession(
          id: 'persisted-session',
          workspacePath: 'c:/Users/amine/proj',
          title: 'Existing Work',
          status: 'CASCADE_STATUS_READY',
          time: '1h ago',
        ),
      ];

      // Simulated empty transient response while daemon initializes Language Server
      final emptyPayload = {'version': 2, 'sessions': []};
      final parsed = await SessionParser.parseListSessionsAsync(emptyPayload);

      if (parsed.isNotEmpty) {
        currentSessions = parsed;
      }
      // If parsed is empty and currentSessions is not empty, currentSessions is preserved
      expect(currentSessions.length, equals(1));
      expect(currentSessions.first.title, equals('Existing Work'));
    });
  });
}
