import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/outbox.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/stream_parser.dart';

void main() {
  group('DaemonApi', () {
    test('correlates unary response by requestId', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.listSessions();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'list_sessions');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'fields': [
              {'field': 1, 'text': 'cascade-1'},
            ],
          },
        }),
      );

      final result = await future;
      expect((result['fields'] as List), hasLength(1));
      await controller.close();
      api.dispose();
    });

    test('streams deltas and closes on stream_end', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final stream = api.sendPrompt('c1', 'hello');
      await Future<void>.delayed(Duration.zero);
      final requestId = outgoing.first['requestId'] as String;
      expect(outgoing.first['prompt'], 'hello');

      final deltas = <String>[];
      final done = Completer<void>();
      stream.listen((msg) {
        final t = StreamDeltaParser.textOf(msg);
        if (t.isNotEmpty) deltas.add(t);
      }, onDone: done.complete);

      controller.add(
        jsonEncode({
          'type': 'stream_delta',
          'requestId': requestId,
          'data': {
            'events': [
              {'kind': 'thinking', 'delta': 'thinking...'},
              {'kind': 'text', 'delta': 'Hel'},
              {'kind': 'text', 'delta': 'lo'},
            ],
          },
        }),
      );
      controller.add(
        jsonEncode({'type': 'stream_end', 'requestId': requestId}),
      );

      await done.future;
      expect(deltas, ['Hello']);
      await controller.close();
      api.dispose();
    });

    test('surfaces approval_required events', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final stream = api.sendPrompt('c1', 'run tests');
      await Future<void>.delayed(Duration.zero);
      final requestId = outgoing.first['requestId'] as String;

      ToolApproval? approval;
      final done = Completer<void>();
      stream.listen((msg) {
        final a = StreamDeltaParser.approvalOf(msg);
        if (a != null) approval = a;
      }, onDone: done.complete);

      controller.add(
        jsonEncode({
          'type': 'stream_delta',
          'requestId': requestId,
          'data': {
            'events': [
              {
                'kind': 'approval_required',
                'callId': 'call_1',
                'tool': 'run_command',
                'detail': '{"command_line":"git status"}',
                'cascadeId': 'c1',
                'trajectoryId': 'traj_9',
                'stepIndex': 4,
              },
            ],
          },
        }),
      );
      controller.add(
        jsonEncode({'type': 'stream_end', 'requestId': requestId}),
      );

      await done.future;
      expect(approval, isNotNull);
      expect(approval!.tool, 'run_command');
      expect(approval!.detail, '{"command_line":"git status"}');
      expect(approval!.trajectoryId, 'traj_9');
      expect(approval!.stepIndex, 4);
      expect(approval!.approvalType, 'run_command');
      expect(approval!.command, 'git status');
      await controller.close();
      api.dispose();
    });

    test('timeouts when daemon never responds', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
        timeout: const Duration(milliseconds: 200),
      );

      await expectLater(api.heartbeat(), throwsA(isA<TimeoutException>()));
      await controller.close();
      api.dispose();
    });

    test('re-emits broadcast streams from other surfaces on events', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final broadcastEvents = <Map<String, dynamic>>[];
      final sub = api.events.listen(broadcastEvents.add);

      // Un stream déclenché par le PC (requestId inconnu localement) :
      // le daemon le broadcast, l'API doit le réémettre sur _events.
      controller.add(
        jsonEncode({
          'type': 'stream_delta',
          'requestId': 'r-external',
          'data': {
            'events': [
              {'kind': 'text', 'delta': 'Réponse depuis le PC'},
            ],
          },
        }),
      );
      controller.add(
        jsonEncode({'type': 'stream_end', 'requestId': 'r-external'}),
      );

      // Fenêtre de batch 100 ms (UX) : attendre le flush avant de compter.
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(broadcastEvents, hasLength(2));
      expect(broadcastEvents.first['broadcast'], isTrue);
      expect(broadcastEvents.first['type'], 'stream_delta');
      expect(
        StreamDeltaParser.textOf(broadcastEvents.first),
        'Réponse depuis le PC',
      );
      expect(broadcastEvents.last['type'], 'stream_end');

      await sub.cancel();
      await controller.close();
      api.dispose();
    });

    test(
      'surfaces server-pushed approval_expired as broadcast (Phase 6)',
      () async {
        final outgoing = <Map<String, dynamic>>[];
        final controller = StreamController<dynamic>();
        final api = DaemonApi(
          incoming: controller.stream,
          send: (data) => outgoing.add(data as Map<String, dynamic>),
        );

        final broadcastEvents = <Map<String, dynamic>>[];
        final sub = api.events.listen(broadcastEvents.add);

        // Le daemon pousse approval_expired sans requestId (pas de requête
        // locale) : l'API doit le réémettre marqué broadcast pour que l'UI
        // nettoie la carte d'approbation expirée.
        controller.add(
          jsonEncode({
            'type': 'approval_expired',
            'data': {'cascadeId': 'c1'},
          }),
        );

        await Future<void>.delayed(Duration.zero);
        expect(broadcastEvents, hasLength(1));
        expect(broadcastEvents.first['type'], 'approval_expired');
        expect(broadcastEvents.first['broadcast'], isTrue);
        expect(broadcastEvents.first['data']?['cascadeId'], 'c1');

        await sub.cancel();
        await controller.close();
        api.dispose();
      },
    );

    test(
      'outbox: sendPrompt offline is replayed on reconnect (Étape 5)',
      () async {
        final outgoing = <Map<String, dynamic>>[];
        final controller = StreamController<dynamic>();
        final outbox = OutboxQueue();
        // Simule le gate réseau du vrai client : hors-ligne, _send est un no-op.
        var online = false;
        final api = DaemonApi(
          incoming: controller.stream,
          send: (data) {
            if (online) outgoing.add(data as Map<String, dynamic>);
          },
          outbox: outbox,
        );
        final version = ValueNotifier<int>(0);

        var resyncCount = 0;
        api.attachReconnect(version, () async {
          resyncCount++;
          return const {'ok': true};
        });

        // Hors-ligne : le prompt est mis en file, rien n'est envoyé au daemon
        // (le send est un no-op tant que le socket est coupé).
        api.sendPrompt('c1', 'important prompt');
        expect(outbox.pendingCount, 1);
        expect(outgoing, isEmpty);

        // Reconnexion : version++ → replay de la queue puis re-sync.
        online = true;
        version.value = 1;
        await Future<void>.delayed(Duration.zero);
        expect(outgoing, hasLength(1));
        expect(outgoing.first['type'], 'send_prompt');
        expect(outgoing.first['prompt'], 'important prompt');
        expect(outgoing.first.containsKey('queuedAt'), isFalse);

        // La réponse arrive → le message est drainé de la queue (stream_end).
        final requestId = outgoing.first['requestId'] as String;
        controller.add(
          jsonEncode({
            'type': 'stream_start',
            'requestId': requestId,
            'data': {'cascadeId': 'c1'},
          }),
        );
        controller.add(
          jsonEncode({
            'type': 'stream_end',
            'requestId': requestId,
            'data': {'cascadeId': 'c1', 'outcome': 'done'},
          }),
        );
        await Future<void>.delayed(Duration.zero);
        expect(outbox.pendingCount, 0);

        // Nouvelle reconnexion : la queue est VIDE mais le re-sync doit quand
        // même tourner (les sessions peuvent avoir changé pendant la coupure).
        version.value = 2;
        await Future<void>.delayed(Duration.zero);
        expect(resyncCount, 2);

        await controller.close();
        api.dispose();
      },
    );

    test('sendCommand sends slash command and resolves on response', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.sendCommand('/model gemini-3-pro');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'send_command');
      expect(outgoing.first['command'], '/model gemini-3-pro');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {'content': 'ok'},
        }),
      );

      final result = await future;
      expect(result['content'], 'ok');
      await controller.close();
      api.dispose();
    });

    test('sendCommand surfaces daemon errors', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.sendCommand('/compact');
      await Future<void>.delayed(Duration.zero);
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'error',
          'requestId': requestId,
          'error': 'unknown command',
        }),
      );

      await expectLater(
        future,
        throwsA(
          isA<Exception>().having(
            (e) => e.toString(),
            'message',
            contains('unknown command'),
          ),
        ),
      );
      await controller.close();
      api.dispose();
    });

    test('getPendingApproval fetches context and returns null when none', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.getPendingApproval('c2');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'get_pending_approval');
      expect(outgoing.first['cascadeId'], 'c2');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'cascadeId': 'c2',
            'callId': 'call_7',
            'trajectoryId': 'traj_1',
            'stepIndex': 3,
            'approvalType': 'run_command',
            'command': 'git status',
          },
        }),
      );

      final info = await future;
      expect(info, isNotNull);
      expect(info!['callId'], 'call_7');
      expect(info['stepIndex'], 3);
      expect(info['command'], 'git status');
      await controller.close();
      api.dispose();
    });

    test('getPendingApproval returns null when nothing pending', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.getPendingApproval('c9');
      await Future<void>.delayed(Duration.zero);
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': null,
        }),
      );

      expect(await future, isNull);
      await controller.close();
      api.dispose();
    });

    test('getUserStatus requests user profile and credits', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.getUserStatus();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'get_user_status');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'user': {'name': 'Amine', 'plan': 'pro'},
            'credits': {'available': 100},
          },
        }),
      );

      final res = await future;
      expect((res['user'] as Map)['name'], 'Amine');
      expect((res['credits'] as Map)['available'], 100);
      await controller.close();
      api.dispose();
    });

    test('generateCommitMessage returns AI commit string', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.generateCommitMessage();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'generate_commit_message');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'commitMessage': 'feat(remote): add quota gauges',
          },
        }),
      );

      final res = await future;
      expect(res, 'feat(remote): add quota gauges');
      await controller.close();
      api.dispose();
    });

    test('exportMarkdown returns markdown text', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.exportMarkdown('casc-1');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'export_markdown');
      expect(outgoing.first['cascadeId'], 'casc-1');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'markdown': '# Cascade Transcript\n\nPrompt here',
          },
        }),
      );

      final res = await future;
      expect(res, contains('# Cascade Transcript'));
      await controller.close();
      api.dispose();
    });

    test('createWorktree sends branch and returns status', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.createWorktree('feat/sub-agent');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'create_worktree');
      expect(outgoing.first['branch'], 'feat/sub-agent');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'status': 'created',
          },
        }),
      );

      final res = await future;
      expect(res, isTrue);
      await controller.close();
      api.dispose();
    });

    test('syncSession tracks step index and handles sync_catchup events', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.syncSession(cascadeId: 'casc-catchup', lastStepIndex: 2);
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'sync_session');
      expect(outgoing.first['cascadeId'], 'casc-catchup');
      expect(outgoing.first['lastStepIndex'], 2);
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'sync_catchup',
          'requestId': requestId,
          'data': {
            'cascadeId': 'casc-catchup',
            'currentStepIndex': 5,
            'missedEvents': [
              {
                'type': 'stream_delta',
                'requestId': 'r-missed',
                'data': {
                  'events': [
                    {'kind': 'text', 'delta': 'recovered text'},
                  ],
                },
              },
            ],
          },
        }),
      );

      final res = await future;
      expect(res['currentStepIndex'], 5);
      expect((res['missedEvents'] as List), hasLength(1));
      expect(api.getLastStepIndex('casc-catchup'), 5);

      await controller.close();
      api.dispose();
    });

    test('attachReconnect triggers onCatchup on reconnect version tick', () async {
      final controller = StreamController<dynamic>();
      final outbox = OutboxQueue();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (_) {},
        outbox: outbox,
      );
      final version = ValueNotifier<int>(0);

      var catchupInvoked = false;
      api.attachReconnect(
        version,
        () async => const {'ok': true},
        onCatchup: () async {
          catchupInvoked = true;
        },
      );

      version.value = 1;
      await Future<void>.delayed(Duration.zero);
      expect(catchupInvoked, isTrue);

      await controller.close();
      api.dispose();
    });

    test('sync_catchup pendingMessages are tracked and cleared on ack', () async {
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (_) {},
      );

      // Daemon signale un prompt non confirmé → visible via pendingMessages.
      controller.add(
        jsonEncode({
          'type': 'sync_catchup',
          'data': {
            'pendingMessages': [
              {'requestId': 'p-1', 'cascadeId': 'casc', 'prompt': 'hello'},
            ],
          },
        }),
      );
      await Future<void>.delayed(Duration.zero);
      expect(api.pendingMessages.value, hasLength(1));
      expect(api.pendingMessages.value.first['requestId'], 'p-1');

      // Le daemon accepte enfin le prompt (stream_start avec le même id) →
      // plus proposé à l'UI au prochain sync_catchup.
      controller.add(
        jsonEncode({
          'type': 'stream_start',
          'requestId': 'p-1',
          'data': {},
        }),
      );
      await Future<void>.delayed(Duration.zero);
      expect(api.pendingMessages.value, isEmpty);

      await controller.close();
      api.dispose();
    });

    test('resendPending resends with same requestId and clears the entry', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      controller.add(
        jsonEncode({
          'type': 'sync_catchup',
          'data': {
            'pendingMessages': [
              {'requestId': 'p-2', 'cascadeId': 'casc', 'prompt': 'retry me'},
            ],
          },
        }),
      );
      await Future<void>.delayed(Duration.zero);
      expect(api.pendingMessages.value, hasLength(1));

      api.resendPending({
        'requestId': 'p-2',
        'cascadeId': 'casc',
        'prompt': 'retry me',
      });
      expect(outgoing.last['type'], 'send_prompt');
      expect(outgoing.last['requestId'], 'p-2');
      expect(outgoing.last['prompt'], 'retry me');
      expect(api.pendingMessages.value, isEmpty);

      await controller.close();
      api.dispose();
    });

    test('listDevices maps admin.list_devices response devices', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.listDevices();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'admin.list_devices');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {
            'devices': [
              {'deviceId': 'd-1', 'name': 'Pixel', 'admin': true},
            ],
          },
        }),
      );

      final devices = await future;
      expect(devices, hasLength(1));
      expect(devices.first['deviceId'], 'd-1');
      expect(devices.first['admin'], isTrue);

      await controller.close();
      api.dispose();
    });

    test('revokeDevice returns true only on revoked status', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.revokeDevice('d-1');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.first['type'], 'admin.revoke_device');
      expect(outgoing.first['deviceId'], 'd-1');
      final requestId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': requestId,
          'data': {'status': 'revoked', 'deviceId': 'd-1'},
        }),
      );

      expect(await future, isTrue);

      await controller.close();
      api.dispose();
    });

    test('IDE lifecycle methods send correct RPC types', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      // 1. launchIde
      final f1 = api.launchIde();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'ide.launch');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'launched'}}));
      await f1;

      // 2. restartIde
      final f2 = api.restartIde();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'ide.restart');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'restarted'}}));
      await f2;

      // 3. killIde
      final f3 = api.killIde();
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'ide.kill');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'killed'}}));
      await f3;

      // 4. emergencyStop
      final f4 = api.emergencyStop(cascadeId: 'cas-1');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'emergency_stop');
      expect(outgoing.last['cascadeId'], 'cas-1');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'stopped'}}));
      await f4;

      await controller.close();
      api.dispose();
    });

    test('HostTelemetry broadcast updates hostTelemetryNotifier', () async {
      final controller = StreamController<dynamic>();
      final api = DaemonApi(incoming: controller.stream);

      expect(api.hostTelemetryNotifier.value, isNull);

      controller.add(
        jsonEncode({
          'type': 'host_telemetry',
          'data': {
            'cpuPercent': 25,
            'ramUsedMb': 4096,
            'ramTotalMb': 16384,
            'uptimeSeconds': 3600,
          },
        }),
      );

      await Future<void>.delayed(Duration.zero);

      final telemetry = api.hostTelemetryNotifier.value;
      expect(telemetry, isNotNull);
      expect(telemetry!.cpuPercent, 25);
      expect(telemetry.ramUsedMb, 4096);
      expect(telemetry.ramTotalMb, 16384);
      expect(telemetry.uptimeSeconds, 3600);

      await controller.close();
      api.dispose();
    });
  });
}

