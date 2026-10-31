import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/stream_parser.dart';

/// Test d'intégration du workflow COMPLET côté mobile (DaemonApi) :
/// create_cascade → send_prompt → stream_delta (approval_required) →
/// get_pending_approval → submitApproval → stream_end done.
///
/// Le daemon est simulé par un StreamController : chaque réponse reprend
/// exactement le format JSON du gateway (remote/daemon/pkg/gateway).
void main() {
  group('WorkflowIntegration', () {
    test('complete workflow: create, prompt, approval, completion', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      // --- Étape 1 : create_cascade → réponse unary avec la cascade ---
      final createFuture = api.createCascade('C:/Users/test/proj');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'create_cascade');
      final createRequestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': createRequestId,
          'data': {
            'fields': [
              {'field': 1, 'text': 'casc-1'},
            ],
          },
        }),
      );
      final createResult = await createFuture;
      expect(
        (createResult['fields'] as List).first['text'],
        'casc-1',
      );

      // --- Étape 2 : send_prompt → le daemon pousse stream_start, un delta
      // avec approval_required, et stream_end (outcome=approval) ---
      final stream = api.sendPrompt('casc-1', 'travaille');
      await Future<void>.delayed(Duration.zero);
      final promptRequestId = outgoing.last['requestId'] as String;
      expect(outgoing.last['cascadeId'], 'casc-1');
      expect(outgoing.last['prompt'], 'travaille');

      ToolApproval? approval;
      final events = <Map<String, dynamic>>[];
      final streamDone = Completer<void>();
      stream.listen((msg) {
        events.add(msg);
        final a = StreamDeltaParser.approvalOf(msg);
        if (a != null) approval = a;
      }, onDone: streamDone.complete);

      controller.add(
        jsonEncode({
          'type': 'stream_start',
          'requestId': promptRequestId,
          'data': {'cascadeId': 'casc-1'},
        }),
      );
      controller.add(
        jsonEncode({
          'type': 'stream_delta',
          'requestId': promptRequestId,
          'data': {
            'frameIndex': 1,
            'events': [
              {
                'kind': 'approval_required',
                'callId': 'call_1',
                'tool': 'run_command',
                'detail': '{"command_line":"npx jest"}',
                'cascadeId': 'casc-1',
                'trajectoryId': '123e4567-e89b-12d3-a456-426614174000',
                'stepIndex': 1,
              },
            ],
          },
        }),
      );
      controller.add(
        jsonEncode({
          'type': 'stream_end',
          'requestId': promptRequestId,
          'data': {'cascadeId': 'casc-1', 'outcome': 'approval'},
        }),
      );
      await streamDone.future;

      expect(approval, isNotNull);
      expect(approval!.tool, 'run_command');
      expect(approval!.command, 'npx jest');
      expect(approval!.trajectoryId, '123e4567-e89b-12d3-a456-426614174000');
      expect(approval!.stepIndex, 1);
      expect(events.last['data']?['outcome'], 'approval');

      // --- Étape 3 : get_pending_approval → contexte complet ---
      final pendingFuture = api.getPendingApproval('casc-1');
      await Future<void>.delayed(Duration.zero);
      final pendingRequestId = outgoing.last['requestId'] as String;
      expect(outgoing.last['type'], 'get_pending_approval');

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': pendingRequestId,
          'data': {
            'cascadeId': 'casc-1',
            'callId': 'call_1',
            'trajectoryId': '123e4567-e89b-12d3-a456-426614174000',
            'stepIndex': 1,
            'approvalType': 'run_command',
            'command': 'npx jest',
          },
        }),
      );
      final pending = await pendingFuture;
      expect(pending, isNotNull);
      expect(pending!['approvalType'], 'run_command');
      expect(pending['command'], 'npx jest');

      // --- Étape 4 : submitApproval (allow) → réponse unary ---
      final submitFuture = api.submitApproval(
        cascadeId: 'casc-1',
        callId: 'call_1',
        allow: true,
        trajectoryId: '123e4567-e89b-12d3-a456-426614174000',
        stepIndex: 1,
        approvalType: 'run_command',
        command: 'npx jest',
      );
      await Future<void>.delayed(Duration.zero);
      final submitMessage = outgoing.last;
      expect(submitMessage['type'], 'submit_approval');
      expect(submitMessage['decision'], 'allow');
      expect(submitMessage['stepIndex'], 1);

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': submitMessage['requestId'],
          'data': {'status': 'submitted'},
        }),
      );
      final submitResult = await submitFuture;
      expect(submitResult['status'], 'submitted');

      await controller.close();
      api.dispose();
    });
  });
}
