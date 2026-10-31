import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/notifications/approval_notifier.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

// ──────────────────────────────────────────────────────────────────────────────
// Tests de l'audit UX des écrans de chat (correctifs P0/P1/P2) :
//   UX1 — deux approbations empilées ne s'écrasent plus (navigation ◀ ▶)
//   UX2 — la carte d'approbation est épinglée (hors ListView, toujours visible)
//   UX3 — le raisonnement (« Thought ») est replié par défaut et se déplie
//   UX4 — hors-ligne : le champ reste éditable (promesse de l'outbox)
//   UX5 — les erreurs de stream sont stylisées (pas de markdown brut)
//   B2  — tap notification → ré-ouverture de l'approbation (deep-link)
//   P3  — actions inline « Autoriser / Refuser » depuis la notification
// ──────────────────────────────────────────────────────────────────────────────

({DaemonApi api, StreamController<dynamic> ctrl, List<Map<String, dynamic>> out})
    _mkApi() {
  final out = <Map<String, dynamic>>[];
  final ctrl = StreamController<dynamic>.broadcast();
  final api = DaemonApi(
    incoming: ctrl.stream,
    send: (d) {
      final map = d as Map<String, dynamic>;
      out.add(map);
      final reqId = map['requestId'] as String?;
      final type = map['type'] as String?;
      if (reqId != null &&
          (type == 'get_session_history' ||
              type == 'read_file' ||
              type == 'list_files' ||
              type == 'get_context' ||
              type == 'submit_approval')) {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
          }
        });
      }
    },
  );
  return (api: api, ctrl: ctrl, out: out);
}

void _approval(StreamController<dynamic> ctrl, String requestId, String callId, String tool) {
  ctrl.add(jsonEncode({
    'type': 'stream_delta',
    'requestId': requestId,
    'data': {
      'events': [
        {
          'kind': 'approval_required',
          'callId': callId,
          'tool': tool,
          'detail': '{"command_line":"echo $tool"}',
          'cascadeId': 'c1',
        }
      ],
    },
  }));
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required DaemonApi api,
  required StreamController<dynamic> ctrl,
  bool isConnected = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5CF6),
          brightness: Brightness.dark,
        ),
      ),
      home: Scaffold(
        body: ChatStreamScreen(
          api: api,
          activeSessionId: 'c1',
          activeProjectName: 'Test',
          isConnected: isConnected,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Envoie un message via la barre de saisie — le SEUL chemin qui abonne
/// vraiment l'écran au stream (le probe l'a prouvé : api.sendPrompt seul
/// crée un stream sans listener côté écran → les deltas sont perdus).
Future<void> _sendViaBar(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
  await tester.tap(find.byIcon(Icons.arrow_forward));
  await tester.pump();
}

void main() {
  group('Audit UX chat — approbations empilées (P0-1)', () {
    testWidgets('une 2ᵉ approbation ne remplace pas la 1ʳᵉ : navigation ◀ ▶',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear(); // Ignorer l'appel get_session_history initial

      // Envoi via la barre → l'écran écoute le stream (requestId 'r1').
      await _sendViaBar(tester, 'fais deux trucs');
      final reqId = out.last['requestId'] as String;

      _approval(ctrl, reqId, 'call-1', 'run_command');
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.textContaining('Approbation 1/2'), findsNothing);

      // 2ᵉ approbation pendant que la 1ʳᵉ est encore affichée.
      _approval(ctrl, reqId, 'call-2', 'edit_file');
      await tester.pump(const Duration(milliseconds: 120));

      // Les deux demandes coexistent : compteur « 1/2 » + navigation.
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.textContaining('1/2'), findsOneWidget);
      expect(find.byKey(const Key('approval-next')), findsOneWidget);

      // Bascule sur la 2ᵉ carte.
      await tester.tap(find.byKey(const Key('approval-next')));
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.textContaining('2/2'), findsOneWidget);
      // La carte edit_file est affichée — le nom du tool apparaît dans le
      // badge, la commande et le label « toujours autoriser » : on accepte
      // plusieurs occurrences.
      expect(find.textContaining('edit_file'), findsWidgets);

      // Décision sur la 2ᵉ → retour automatique à la 1ʳᵉ restante.
      await tester.ensureVisible(find.byKey(const Key('allow-btn')));
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.textContaining('1/1'), findsOneWidget);

      // La 1ʳᵉ est toujours approvable.
      await tester.ensureVisible(find.byKey(const Key('allow-btn')));
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.byType(ToolApprovalCard), findsNothing);

      // Deux décisions envoyées (une par callId).
      expect(
        out.where((m) => m['type'] == 'submit_approval'),
        hasLength(2),
      );

      await ctrl.close();
      api.dispose();
    });
  });

  group('Audit UX chat — thought replié par défaut (P0-3)', () {
    testWidgets('le raisonnement est replié et le toggle le déplie vraiment',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear(); // Ignorer l'appel get_session_history initial

      await _sendViaBar(tester, 'raisonne');
      final sendReq = out.lastWhere((m) => m['type'] == 'send_prompt');
      final reqId = sendReq['requestId'] as String;
      // Il faut d'abord répondre au send_prompt pour que l'écran mappe le reqId
      ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
      await tester.pump(const Duration(milliseconds: 10));

      ctrl.add(jsonEncode({
        'type': 'stream_delta',
        'requestId': reqId,
        'data': {
          'events': [
            {'kind': 'thinking', 'delta': 'je réfléchis profondément à ce problème très complexe'},
          ],
        },
      }));
      await tester.pump(const Duration(milliseconds: 150));
      await tester.pump();

      // 1ᵉʳ envoi : m1 (user) + a2 (assistant) → la pensée vit sur la bulle a2.
      final thoughtText = find.byKey(const Key('thought-a2'));
      expect(thoughtText, findsOneWidget);
      final collapsed = tester.widget<Text>(thoughtText);
      expect(collapsed.maxLines, 1, reason: 'Thought doit être replié par défaut');

      await tester.tap(find.byKey(const Key('thought-toggle-a2')));
      await tester.pump();
      final expanded = tester.widget<Text>(thoughtText);
      expect(expanded.maxLines, isNull, reason: 'Le toggle doit vraiment déplier');

      await ctrl.close();
      api.dispose();
    });
  });

  group('Audit UX chat — carte épinglée + hors-ligne éditable (P0-2/P1-5)', () {
    testWidgets('hors-ligne : le TextField reste éditable et le send est accepté',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF8B5CF6),
              brightness: Brightness.dark,
            ),
          ),
          home: Scaffold(
            body: ChatStreamScreen(
              api: api,
              activeSessionId: 'c1',
              activeProjectName: 'Test',
              isConnected: false, // simulate offline
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Le champ accepte la saisie malgré l'état hors-ligne.
      final field = find.byType(TextField);
      expect(field, findsOneWidget);
      await tester.enterText(field, 'message offline');
      await tester.pump();

      final sendButton = find.byIcon(Icons.arrow_forward);
      expect(sendButton, findsOneWidget);
      await tester.tap(sendButton);
      await tester.pump();

      // Le message est ajouté localement (bulle utilisateur) malgré l'absence
      // de connexion — la livraison au daemon est gérée par l'outbox.
      expect(find.textContaining('message offline'), findsOneWidget);

      await ctrl.close();
      api.dispose();
    });
  });

  group('Audit UX chat — erreur stylisée (P2-9)', () {
    testWidgets('une erreur de stream s\'affiche en bulle danger, pas en markdown',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear(); // Ignorer l'appel get_session_history initial

      await _sendViaBar(tester, 'plante');
      final sendReq = out.lastWhere((m) => m['type'] == 'send_prompt');
      final reqId = sendReq['requestId'] as String;
      // On répond au send_prompt pour mapper le reqId
      ctrl.add(jsonEncode({'requestId': reqId, 'data': {}}));
      await tester.pump(const Duration(milliseconds: 10));

      ctrl.add(jsonEncode({
        'type': 'stream_end',
        'requestId': reqId,
        'error': 'internal daemon failure',
        'data': {'outcome': 'error'},
      }));
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();

      // L'erreur est rendue dans un état visuel dédié (icône + fond danger).
      expect(find.byIcon(Icons.error_outline), findsOneWidget);

      await ctrl.close();
      api.dispose();
    });
  });

  group('B2 — tap notification → ré-ouverture de l\'approbation', () {
    testWidgets('le tap re-fetch get_pending_approval et affiche la carte',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear(); // Ignorer l'appel get_session_history initial

      // Aucune carte au départ.
      expect(find.byType(ToolApprovalCard), findsNothing);

      // L'utilisateur tape la notification « Approbation requise » (émise
      // pendant que l'app était en arrière-plan). Le daemon répond avec le
      // contexte de l'approbation encore en attente.
      ApprovalNotifier.instance.tapsSink.add({
        'kind': 'approval',
        'cascadeId': 'c1',
      });
      await tester.pump();

      // get_pending_approval part bien vers le daemon…
      final getReq =
          out.where((m) => m['type'] == 'get_pending_approval').toList();
      expect(getReq, hasLength(1));
      expect(getReq.first['cascadeId'], 'c1');

      // … et sa réponse fait apparaître la carte.
      ctrl.add(jsonEncode({
        'type': 'response',
        'requestId': getReq.first['requestId'],
        'data': {
          'cascadeId': 'c1',
          'callId': 'call_tap',
          'trajectoryId': 'traj_t',
          'stepIndex': 2,
          'approvalType': 'run_command',
          'command': 'git push',
        },
      }));
      await tester.pump(const Duration(milliseconds: 120));

      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.textContaining('git push'), findsWidgets);

      // Approuver → submit_approval avec les métadonnées re-fetchées.
      await tester.ensureVisible(find.byKey(const Key('allow-btn')));
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pump(const Duration(milliseconds: 120));
      final submits = out.where((m) => m['type'] == 'submit_approval').toList();
      expect(submits, hasLength(1));
      expect(submits.first['callId'], 'call_tap');
      expect(submits.first['trajectoryId'], 'traj_t');
      expect(submits.first['stepIndex'], 2);
      expect(find.byType(ToolApprovalCard), findsNothing);

      await ctrl.close();
      api.dispose();
    });

    testWidgets('action inline « Autoriser » soumet directement sans carte',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear(); // Ignorer l'appel get_session_history initial

      // L'utilisateur tape « Autoriser » directement dans la notification
      // (Phase 3 — action inline Android). Le notifier publie actionId.
      ApprovalNotifier.instance.tapsSink.add({
        'kind': 'approval',
        'cascadeId': 'c1',
        'action': 'allow',
      });
      await tester.pump();

      // get_pending_approval part vers le daemon pour le contexte…
      final getReq =
          out.where((m) => m['type'] == 'get_pending_approval').toList();
      expect(getReq, hasLength(1));

      // … puis la décision est soumise dès la réponse, sans afficher la carte.
      ctrl.add(jsonEncode({
        'type': 'response',
        'requestId': getReq.first['requestId'],
        'data': {
          'cascadeId': 'c1',
          'callId': 'call_inline',
          'trajectoryId': 'traj_i',
          'stepIndex': 3,
          'approvalType': 'run_command',
          'command': 'rm -rf build',
        },
      }));
      await tester.pump(const Duration(milliseconds: 120));

      final submits = out.where((m) => m['type'] == 'submit_approval').toList();
      expect(submits, hasLength(1));
      expect(submits.first['callId'], 'call_inline');
      expect(submits.first['decision'], 'allow');
      expect(submits.first['trajectoryId'], 'traj_i');
      expect(submits.first['stepIndex'], 3);
      // Jamais de carte : la décision vient de la notification.
      expect(find.byType(ToolApprovalCard), findsNothing);

      await ctrl.close();
      api.dispose();
    });

    testWidgets('action inline « Refuser » soumet deny avec le même contexte',
        (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      ApprovalNotifier.instance.tapsSink.add({
        'kind': 'approval',
        'cascadeId': 'c1',
        'action': 'deny',
      });
      await tester.pump();

      final getReq =
          out.where((m) => m['type'] == 'get_pending_approval').toList();
      expect(getReq, hasLength(1));
      ctrl.add(jsonEncode({
        'type': 'response',
        'requestId': getReq.first['requestId'],
        'data': {
          'cascadeId': 'c1',
          'callId': 'call_inline_deny',
          'trajectoryId': 'traj_d',
          'stepIndex': 1,
          'approvalType': 'run_command',
          'command': 'git reset --hard',
        },
      }));
      await tester.pump(const Duration(milliseconds: 120));

      final submits = out.where((m) => m['type'] == 'submit_approval').toList();
      expect(submits, hasLength(1));
      expect(submits.first['callId'], 'call_inline_deny');
      expect(submits.first['decision'], 'deny');
      expect(find.byType(ToolApprovalCard), findsNothing);

      await ctrl.close();
      api.dispose();
    });
  });
}
