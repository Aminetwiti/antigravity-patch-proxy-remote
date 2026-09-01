import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/tool_approval_card.dart';
import 'package:mobile/widgets/ask_question_choice_card.dart';

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
      if (reqId != null && map['type'] != 'send_prompt') {
        scheduleMicrotask(() {
          if (!ctrl.isClosed) {
            ctrl.add(jsonEncode({'requestId': reqId, 'data': {'success': true}}));
          }
        });
      }
    },
  );
  return (api: api, ctrl: ctrl, out: out);
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required DaemonApi api,
  required StreamController<dynamic> ctrl,
  String activeSessionId = 'c1',
  bool isConnected = true,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

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
          activeSessionId: activeSessionId,
          activeProjectName: 'Antigravity Workspace',
          isConnected: isConnected,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  group('Real-Time Collaboration & Tool Approval Synchronization', () {
    testWidgets('Scénario 1 : Multi-approbation temps réel, navigation en carrousel et approbation avec scope session', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // 1. Le daemon pousse une 1ère demande d'approbation (run_command)
      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-cmd-1',
          'toolName': 'run_command',
          'command': 'flutter test',
          'stepIndex': 1,
          'trajectoryId': 'traj-1',
          'approvalType': 'run_command',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.text('flutter test'), findsOneWidget);
      expect(find.text('Approbation 1/1'), findsOneWidget);

      // 2. Le daemon pousse une 2ème demande d'approbation (file_edit)
      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-file-2',
          'toolName': 'file_edit',
          'command': 'lib/main.dart',
          'stepIndex': 2,
          'trajectoryId': 'traj-1',
          'approvalType': 'approval',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      // La file contient maintenant 2 approbations, et l'indicateur affiche 1/2
      expect(find.text('Approbation 1/2'), findsOneWidget);
      expect(find.byKey(const Key('approval-next')), findsOneWidget);

      // 3. Navigation vers la 2ème approbation
      await tester.tap(find.byKey(const Key('approval-next')));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Approbation 2/2'), findsOneWidget);
      expect(find.text('lib/main.dart'), findsOneWidget);

      // 4. Navigation retour vers la 1ère approbation
      await tester.tap(find.byKey(const Key('approval-prev')));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Approbation 1/2'), findsOneWidget);
      expect(find.text('flutter test'), findsOneWidget);

      // 5. Activation option 2 "Toujours autoriser dans cette conversation" (scope: session)
      final opt2 = find.byKey(const Key('approval-option-2'));
      if (opt2.evaluate().isNotEmpty) {
        await tester.tap(opt2);
      } else {
        await tester.tap(find.byType(Switch));
      }
      await tester.pump(const Duration(milliseconds: 50));

      await tester.ensureVisible(find.byKey(const Key('allow-btn')));
      await tester.tap(find.byKey(const Key('allow-btn')));
      await tester.pump(const Duration(milliseconds: 100));

      // Vérification du payload envoyé au daemon
      final approvals = out.where((m) => m['type'] == 'submit_approval').toList();
      expect(approvals.length, equals(1));
      expect(approvals[0]['callId'], equals('call-cmd-1'));
      expect(approvals[0]['decision'], equals('allow'));
      expect(approvals[0]['scope'], equals('session'));

      // Il ne reste plus que la 2ème approbation dans la file
      expect(find.text('Approbation 1/1'), findsOneWidget);
      expect(find.text('lib/main.dart'), findsOneWidget);

      api.dispose();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Scénario 2 : Résolution distante en temps réel depuis le Desktop IDE (Zero Race Condition)', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // Pousse d'approbation
      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-desktop-1',
          'toolName': 'run_command',
          'command': 'npm install',
          'stepIndex': 3,
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(ToolApprovalCard), findsOneWidget);

      // L'utilisateur approuve sur le PC -> le daemon diffuse approval_resolved
      ctrl.add(jsonEncode({
        'type': 'approval_resolved',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-desktop-1',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      // La carte d'approbation disparaît instantanément sur mobile
      expect(find.byType(ToolApprovalCard), findsNothing);

      api.dispose();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Scénario 3 : Collaboration interactive ask_question (QCM & Choix multiples)', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      // Pousse d'une question interactive
      ctrl.add(jsonEncode({
        'type': 'question_pending',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'q-1',
          'requestId': 'q-1',
          'questions': [
            {
              'question': 'Quelle stratégie de déploiement souhaitez-vous utiliser ?',
              'options': ['Staging Cloudflare', 'Production Directe', 'Docker Local'],
              'is_multi_select': true,
            }
          ]
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(AskQuestionChoiceCard), findsOneWidget);
      expect(find.text('Quelle stratégie de déploiement souhaitez-vous utiliser ?'), findsOneWidget);

      // Sélection de l'option 1
      await tester.tap(find.text('Staging Cloudflare'));
      await tester.pump(const Duration(milliseconds: 50));

      // Sélection de l'option 2 (multi-select)
      await tester.tap(find.text('Docker Local'));
      await tester.pump(const Duration(milliseconds: 50));

      // Soumission de la réponse
      await tester.ensureVisible(find.text('Submit Choice'));
      await tester.tap(find.text('Submit Choice'), warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 100));

      final answers = out.where((m) => m['type'] == 'submit_question_response').toList();
      expect(answers.length, equals(1));
      expect(answers[0]['cascadeId'], equals('c1'));
      expect(answers[0]['selectedAnswers'], containsAll(['Staging Cloudflare', 'Docker Local']));

      // La carte de question disparaît après soumission réussie
      expect(find.byType(AskQuestionChoiceCard), findsNothing);

      api.dispose();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Scénario 4 : Expiration d\'approbation (approval_expired) désactive la soumission tardive', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      ctrl.add(jsonEncode({
        'type': 'approval_pending',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-timeout-1',
          'toolName': 'run_command',
          'command': 'rm -rf /tmp/cache',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(ToolApprovalCard), findsOneWidget);

      // Le daemon notifie l'expiration après 5 minutes de timeout
      ctrl.add(jsonEncode({
        'type': 'approval_expired',
        'broadcast': true,
        'cascadeId': 'c1',
        'data': {
          'callId': 'call-timeout-1',
        }
      }));
      await tester.pump(const Duration(milliseconds: 100));

      // La carte est en mode expiré : le bouton Approuver est désactivé (onPressed == null)
      final allowButton = tester.widget<ElevatedButton>(find.byKey(const Key('allow-btn')));
      expect(allowButton.onPressed, isNull);

      final approvals = out.where((m) => m['type'] == 'submit_approval').toList();
      expect(approvals, isEmpty);

      api.dispose();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Scénario 5 : Bascule du mode Auto-Accept (set_auto_accept)', (tester) async {
      final (:api, :ctrl, :out) = _mkApi();
      await _pumpScreen(tester, api: api, ctrl: ctrl);
      out.clear();

      final success = await api.setAutoAccept(enabled: true, mode: 'readonly');
      expect(success, isTrue);

      final autoAcceptCalls = out.where((m) => m['type'] == 'set_auto_accept').toList();
      expect(autoAcceptCalls.length, equals(1));
      expect(autoAcceptCalls[0]['data']['enabled'], isTrue);
      expect(autoAcceptCalls[0]['data']['mode'], equals('readonly'));

      api.dispose();
      await tester.pump(const Duration(milliseconds: 100));
    });
  });
}
