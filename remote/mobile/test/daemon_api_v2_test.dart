import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';

void main() {
  group('DaemonApi Protocol v2', () {
    test('attachSession sends correct v2 envelope', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      api.attachSession('sess_100', lastSequence: 42);
      expect(outgoing, hasLength(1));
      expect(outgoing.first['version'], 2);
      expect(outgoing.first['type'], 'session.attach');
      expect(outgoing.first['sessionId'], 'sess_100');
      expect(outgoing.first['lastSequence'], 42);

      await controller.close();
      api.dispose();
    });

    test('sendPromptV2 sends v2 envelope and resolves on session.ack', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final future = api.sendPromptV2('sess_200', 'build cloud agent');
      await Future<void>.delayed(Duration.zero);

      expect(outgoing, hasLength(1));
      expect(outgoing.first['version'], 2);
      expect(outgoing.first['type'], 'session.prompt');
      expect(outgoing.first['sessionId'], 'sess_200');
      expect((outgoing.first['payload'] as Map)['text'], 'build cloud agent');

      final reqId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'version': 2,
          'type': 'session.ack',
          'requestId': reqId,
          'sessionId': 'sess_200',
          'success': true,
          'data': {'status': 'turn_started'},
        }),
      );

      final res = await future;
      expect(res['success'], isTrue);

      await controller.close();
      api.dispose();
    });

    test('session control commands (pause, resume, cancel) send valid v2 envelopes', () async {
      final outgoing = <Map<String, dynamic>>[];
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );

      final f1 = api.pauseSession('sess_300');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'session.pause');
      controller.add(jsonEncode({
        'version': 2,
        'type': 'session.ack',
        'requestId': outgoing.last['requestId'],
        'sessionId': 'sess_300',
        'success': true,
      }));
      await f1;

      final f2 = api.resumeSession('sess_300');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'session.resume');
      controller.add(jsonEncode({
        'version': 2,
        'type': 'session.ack',
        'requestId': outgoing.last['requestId'],
        'sessionId': 'sess_300',
        'success': true,
      }));
      await f2;

      final f3 = api.cancelSession('sess_300');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'session.cancel');
      controller.add(jsonEncode({
        'version': 2,
        'type': 'session.ack',
        'requestId': outgoing.last['requestId'],
        'sessionId': 'sess_300',
        'success': true,
      }));
      await f3;

      await controller.close();
      api.dispose();
    });

    test('session.event thought_chunk synthesizes stream_delta broadcast', () async {
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (_) {},
      );

      final eventsReceived = <Map<String, dynamic>>[];
      final sub = api.events.listen(eventsReceived.add);

      controller.add(
        jsonEncode({
          'version': 2,
          'type': 'session.event',
          'sessionId': 'sess_stream',
          'event': {
            'sessionId': 'sess_stream',
            'sequence': 1,
            'eventId': 'evt_1',
            'type': 'agent.thought_chunk',
            'timestamp': 1000,
            'payload': {'chunk': 'Thinking about cloud runtime...'},
          },
        }),
      );

      await Future<void>.delayed(const Duration(milliseconds: 60));

      expect(eventsReceived, isNotEmpty);
      final delta = eventsReceived.firstWhere((e) => e['type'] == 'stream_delta');
      expect(delta['cascadeId'], 'sess_stream');
      final events = (delta['data'] as Map)['events'] as List;
      expect((events.first as Map)['type'], 'thought');
      expect((events.first as Map)['text'], 'Thinking about cloud runtime...');

      await sub.cancel();
      await controller.close();
      api.dispose();
    });

    test('session.catchup replays historical events into trajectory', () async {
      final controller = StreamController<dynamic>();
      final api = DaemonApi(
        incoming: controller.stream,
        send: (_) {},
      );

      final eventsReceived = <Map<String, dynamic>>[];
      final sub = api.events.listen(eventsReceived.add);

      controller.add(
        jsonEncode({
          'version': 2,
          'type': 'session.catchup',
          'sessionId': 'sess_replay',
          'fromSequence': 1,
          'toSequence': 2,
          'events': [
            {
              'sessionId': 'sess_replay',
              'sequence': 1,
              'eventId': 'evt_1',
              'type': 'agent.thought_chunk',
              'timestamp': 1000,
              'payload': {'chunk': 'Replayed thought 1'},
            },
            {
              'sessionId': 'sess_replay',
              'sequence': 2,
              'eventId': 'evt_2',
              'type': 'agent.thought_chunk',
              'timestamp': 1001,
              'payload': {'chunk': 'Replayed thought 2'},
            },
          ],
        }),
      );

      await Future<void>.delayed(const Duration(milliseconds: 60));

      expect(eventsReceived, isNotEmpty);
      final deltas = eventsReceived.where((e) => e['type'] == 'stream_delta').toList();
      expect(deltas.length, greaterThanOrEqualTo(1));

      await sub.cancel();
      await controller.close();
      api.dispose();
    });
  });
}
