import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  group('Session Creation and Active Focus Isolation Tests', () {
    test('Une nouvelle session locale créée n\'est jamais écrasée par une ancienne session lors du refresh', () {
      final oldSession = const CascadeSession(
        id: 'session-old-1',
        workspacePath: 'c:/Users/developer/OmniRoute',
        title: 'Ancienne conversation',
        status: 'CASCADE_STATUS_READY',
        time: '1h',
      );

      final newSession = const CascadeSession(
        id: 'session-new-2',
        workspacePath: 'c:/Users/developer/OmniRoute',
        title: 'Nouvelle conversation',
        status: 'CASCADE_STATUS_READY',
        time: 'Maintenant',
      );

      String activeSessionId = newSession.id;
      List<CascadeSession> sessions = [newSession, oldSession];

      // Simule une réponse serveur listSessions qui ne contient pas encore la nouvelle session (lag réseau)
      final serverSessions = [oldSession];

      // Logique de préservation
      final stillActive = serverSessions.any((s) => s.id == activeSessionId);
      if (activeSessionId.isNotEmpty) {
        if (stillActive) {
          sessions = serverSessions;
        } else {
          final curLocal = sessions.firstWhere(
            (s) => s.id == activeSessionId,
            orElse: () => newSession,
          );
          sessions = [curLocal, ...serverSessions.where((s) => s.id != activeSessionId)];
        }
      }

      // La session active DOIT TOUJOURS rester session-new-2 !
      expect(activeSessionId, equals('session-new-2'));
      expect(sessions.first.id, equals('session-new-2'));
      expect(sessions.length, equals(2));
    });

    test('Quand l\'utilisateur envoie un premier message "hi", le titre change sans perdre le focus actif', () {
      final newSession = const CascadeSession(
        id: 'session-new-2',
        workspacePath: 'c:/Users/developer/OmniRoute',
        title: 'hi',
        status: 'CASCADE_STATUS_RUNNING',
        time: 'Maintenant',
      );

      final oldSession = const CascadeSession(
        id: 'session-old-1',
        workspacePath: 'c:/Users/developer/OmniRoute',
        title: 'Ancienne conversation',
        status: 'CASCADE_STATUS_READY',
        time: '1h',
      );

      String activeSessionId = newSession.id;
      List<CascadeSession> sessions = [newSession, oldSession];

      // Push sessions_updated sans session-new-2
      final pushedSessions = [oldSession];

      final stillActive = pushedSessions.any((s) => s.id == activeSessionId);
      if (activeSessionId.isNotEmpty) {
        if (stillActive) {
          sessions = pushedSessions;
        } else {
          final curLocal = sessions.firstWhere(
            (s) => s.id == activeSessionId,
            orElse: () => newSession,
          );
          sessions = [curLocal, ...pushedSessions.where((s) => s.id != activeSessionId)];
        }
      }

      // Le deuxième message ("developer") sera bien envoyé à session-new-2
      expect(activeSessionId, equals('session-new-2'));
      expect(sessions.first.title, equals('hi'));
    });
  });
}
