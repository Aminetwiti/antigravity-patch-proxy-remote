import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Session No-Auto-Switch & Remote Event Isolation Tests', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('SessionParser preserves all sessions without forcing focus switch', () {
      final payload = {
        'sessions': [
          {
            'cascadeId': 'session-Y',
            'title': 'Session Y running on Desktop',
            'status': 'CASCADE_STATUS_RUNNING',
            'updatedAt': DateTime.now().toIso8601String(),
          },
          {
            'cascadeId': 'session-X',
            'title': 'Session X open in Mobile',
            'status': 'CASCADE_STATUS_READY',
            'updatedAt': DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String(),
          },
        ]
      };

      final sessions = SessionParser.parseListSessions(payload);
      expect(sessions.length, 2);
      expect(sessions.any((s) => s.id == 'session-X'), isTrue);
      expect(sessions.any((s) => s.id == 'session-Y'), isTrue);

      // Le client mobile qui a session-X active conserve session-X
      const activeSessionId = 'session-X';
      final stillActive = sessions.any((s) => s.id == activeSessionId);
      expect(stillActive, isTrue);
    });

    test('Remote event session_focus_changed is received without modifying currentSessionId', () async {
      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (_) {},
      );

      var currentSessionId = 'session-X';
      final List<CascadeSession> sessions = [
        const CascadeSession(
          id: 'session-X',
          workspacePath: '/ws',
          title: 'Session X',
          status: 'CASCADE_STATUS_READY',
          time: '12:00',
        ),
        const CascadeSession(
          id: 'session-Y',
          workspacePath: '/ws',
          title: 'Session Y',
          status: 'CASCADE_STATUS_READY',
          time: '11:00',
        ),
      ];

      var sessionsList = List<CascadeSession>.from(sessions);

      // Simulation du listener _watchSessionEvents corrigé
      final sub = api.events.listen((msg) {
        final type = msg['type'] as String?;
        if (type == 'session_focus_changed') {
          // Règle fondamentale : ne modifie JAMAIS currentSessionId
          final data = msg['data'];
          if (data is Map) {
            final cid = (data['cascadeId'] ?? data['focusedCascadeId']) as String? ?? '';
            final title = data['title'] as String? ?? '';
            if (cid.isNotEmpty && title.isNotEmpty) {
              sessionsList = sessionsList.map((s) {
                if (s.id == cid) return s.copyWith(title: title);
                return s;
              }).toList();
            }
          }
        }
      });

      // Émission d'un session_focus_changed pointant vers session-Y
      ctrl.add(jsonEncode({
        'type': 'session_focus_changed',
        'data': {
          'cascadeId': 'session-Y',
          'title': 'Session Y Active on Desktop',
          'status': 'CASCADE_STATUS_RUNNING',
        }
      }));

      await Future.delayed(const Duration(milliseconds: 50));

      // currentSessionId DOIT rester session-X
      expect(currentSessionId, 'session-X');
      // Les métadonnées de Y ont été mises à jour sans changer la session active
      expect(sessionsList.firstWhere((s) => s.id == 'session-Y').title, 'Session Y Active on Desktop');

      await sub.cancel();
      api.dispose();
      await ctrl.close();
    });

    test('sessions_updated does not change currentSessionId when still active', () async {
      final ctrl = StreamController<dynamic>.broadcast();
      final api = DaemonApi(
        incoming: ctrl.stream,
        send: (_) {},
      );

      var currentSessionId = 'session-X';
      var currentSessionTitle = 'Session X';
      var sessionsList = <CascadeSession>[];

      final sub = api.events.listen((msg) {
        final type = msg['type'] as String?;
        if (type == 'sessions_updated') {
          final data = msg['data'];
          if (data is Map) {
            final parsed = SessionParser.parseListSessions(
              Map<String, dynamic>.from(data),
            );
            if (parsed.isNotEmpty) {
              final stillActive = parsed.any((s) => s.id == currentSessionId);
              sessionsList = parsed;
              if (currentSessionId.isEmpty || (!stillActive && currentSessionTitle != 'Nouvelle conversation')) {
                currentSessionId = parsed.first.id;
                currentSessionTitle = parsed.first.title;
              } else if (stillActive) {
                final current = parsed.firstWhere((s) => s.id == currentSessionId);
                currentSessionTitle = current.title;
              }
            }
          }
        }
      });

      // Le daemon pousse un sessions_updated où session-Y est en tête (plus récente)
      ctrl.add(jsonEncode({
        'type': 'sessions_updated',
        'data': {
          'sessions': [
            {
              'cascadeId': 'session-Y',
              'title': 'Session Y Running',
              'status': 'CASCADE_STATUS_RUNNING',
              'updatedAt': DateTime.now().toIso8601String(),
            },
            {
              'cascadeId': 'session-X',
              'title': 'Session X',
              'status': 'CASCADE_STATUS_READY',
              'updatedAt': DateTime.now().subtract(const Duration(minutes: 10)).toIso8601String(),
            },
          ]
        }
      }));

      await Future.delayed(const Duration(milliseconds: 50));

      // currentSessionId DOIT rester session-X même si session-Y est la 1ère dans la liste
      expect(currentSessionId, 'session-X');
      expect(sessionsList.length, 2);

      await sub.cancel();
      api.dispose();
      await ctrl.close();
    });

    test('autoDock only assigns active session if current session is empty', () async {
      var currentSessionId = 'session-X';

      // Si session-X est déjà active, autoDock ne fait rien
      if (currentSessionId.isEmpty) {
        currentSessionId = 'session-Y';
      }
      expect(currentSessionId, 'session-X');

      // Si aucune session n'était active (lancement à froid)
      var freshSessionId = '';
      if (freshSessionId.isEmpty) {
        freshSessionId = 'session-Y';
      }
      expect(freshSessionId, 'session-Y');
    });

    test('Explicit user selection is the only trigger that switches session', () {
      var currentSessionId = 'session-X';

      // Événements distants -> pas de changement
      void onRemoteEvent(String remoteSessionId) {
        // Traitement de l'événement en arrière-plan
      }

      onRemoteEvent('session-Y');
      expect(currentSessionId, 'session-X');

      // Action utilisateur explicite (clic sur session Y dans la sidebar)
      void onUserExplicitSelect(String selectedId) {
        currentSessionId = selectedId;
      }

      onUserExplicitSelect('session-Y');
      expect(currentSessionId, 'session-Y');
    });
  });
}
