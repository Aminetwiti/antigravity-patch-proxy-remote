import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/session_top_tabs.dart';

/// Fake DaemonApi — répond aux requêtes d'historique pour sortir de l'état
/// vide (même schéma que chat_ux_test.dart).
({DaemonApi api, StreamController<dynamic> ctrl}) _mkApi() {
  final ctrl = StreamController<dynamic>.broadcast();
  final api = DaemonApi(
    incoming: ctrl.stream,
    send: (d) {
      final map = d as Map<String, dynamic>;
      final reqId = map['requestId'] as String?;
      final type = map['type'] as String?;
      if (reqId != null && (type == 'get_quota_summary')) {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
          }
        });
        return;
      }
      if (reqId != null && (type == 'get_session_history')) {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({
              'requestId': reqId,
              'data': {
                'messages': [
                  {'id': '1', 'sender': 'user', 'text': 'bonjour'},
                  {'id': '2', 'sender': 'assistant', 'text': 'salut'},
                ],
              },
            }));
          }
        });
        return;
      }
      if (reqId != null &&
          (type == 'read_file' ||
              type == 'list_files' ||
              type == 'get_context' ||
              type == 'git_state' ||
              type == 'get_vcs_state' ||
              type == 'vcs.get_state')) {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
          }
        });
      }
    },
  );
  return (api: api, ctrl: ctrl);
}

void main() {
  testWidgets('P6 — swipe gauche passe de Chat à Review', (tester) async {
    final (:api, :ctrl) = _mkApi();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatStreamScreen(
            api: api,
            activeSessionId: 's1',
            activeProjectName: 'proj',
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Chat actif au départ.
    expect(
      tester.widget<SessionTopTabs>(find.byType(SessionTopTabs)).activeTab,
      SessionTabType.chat,
    );

    // Swipe horizontal rapide vers la gauche (velocity négative → onglet suivant).
    await tester.fling(
      find.byType(ChatStreamScreen),
      const Offset(-400, 0),
      800,
    );
    await tester.pumpAndSettle();

    expect(
      tester.widget<SessionTopTabs>(find.byType(SessionTopTabs)).activeTab,
      SessionTabType.review,
    );
    await ctrl.close();
    api.dispose();
  });

  testWidgets('P6 — swipe droit revient de Review à Chat', (tester) async {
    final (:api, :ctrl) = _mkApi();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatStreamScreen(
            api: api,
            activeSessionId: 's1',
            activeProjectName: 'proj',
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Swipe vers la gauche pour aller sur Review
    await tester.fling(
      find.byType(ChatStreamScreen),
      const Offset(-400, 0),
      800,
    );
    await tester.pumpAndSettle();

    expect(
      tester.widget<SessionTopTabs>(find.byType(SessionTopTabs)).activeTab,
      SessionTabType.review,
    );

    // Swipe vers la droite → retour sur Chat.
    await tester.fling(
      find.byType(ChatStreamScreen),
      const Offset(400, 0),
      800,
    );
    await tester.pumpAndSettle();

    expect(
      tester.widget<SessionTopTabs>(find.byType(SessionTopTabs)).activeTab,
      SessionTabType.chat,
    );
    await ctrl.close();
    api.dispose();
  });
}
