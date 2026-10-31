import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/scheduled_tasks/models/scheduled_task_item.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_tasks_screen.dart';

void main() {
  group('DaemonApi Scheduled Tasks RPC & WebSocket Tests', () {
    late StreamController<dynamic> incoming;
    late List<Map<String, dynamic>> sent;
    late DaemonApi api;

    setUp(() {
      incoming = StreamController<dynamic>.broadcast();
      sent = [];
      api = DaemonApi(
        incoming: incoming.stream,
        send: (msg) => sent.add(msg is String ? jsonDecode(msg) : Map<String, dynamic>.from(msg as Map)),
      );
    });

    tearDown(() {
      api.dispose();
      incoming.close();
    });

    test('listScheduledTasks() sends list_scheduled_tasks and parses response', () async {
      final future = api.listScheduledTasks();

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('list_scheduled_tasks'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'tasks': [
            {
              'id': 'task_1',
              'name': 'hiss',
              'prompt': 'dis bonjour',
              'workspaceName': 'antigravity-add-model-main',
              'cronExpression': '0 9 * * *',
              'isDaemon': true,
              'status': 'Running',
              'uptime': '1m',
              'events': [],
            }
          ]
        }
      }));

      final tasks = await future;
      expect(tasks.length, equals(1));
      expect(tasks.first.id, equals('task_1'));
      expect(tasks.first.displayName, equals('hiss'));
      expect(tasks.first.formattedSchedule, equals('Daily around 9:00 AM'));
    });

    test('scheduleTask() sends schedule_task and returns created item', () async {
      final itemToCreate = ScheduledTaskItem(
        id: 'new_task_1',
        name: 'Auto Deploy',
        prompt: 'deploy to staging',
        cronExpression: '0 * * * *',
      );

      final future = api.scheduleTask(itemToCreate);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('schedule_task'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'status': 'created',
          'task': {
            'id': 'new_task_1',
            'name': 'Auto Deploy',
            'prompt': 'deploy to staging',
            'cronExpression': '0 * * * *',
            'isDaemon': true,
            'status': 'Running',
            'uptime': '0m',
          }
        }
      }));

      final created = await future;
      expect(created.id, equals('new_task_1'));
      expect(created.displayName, equals('Auto Deploy'));
      expect(created.formattedSchedule, equals('Hourly'));
    });

    test('updateScheduledTask() sends update_scheduled_task and returns updated item', () async {
      final itemToUpdate = ScheduledTaskItem(
        id: 'task_1',
        name: 'hiss updated',
        prompt: 'nouveau prompt',
        cronExpression: '0 12 * * *',
      );

      final future = api.updateScheduledTask(itemToUpdate);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('update_scheduled_task'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'status': 'updated',
          'task': {
            'id': 'task_1',
            'name': 'hiss updated',
            'prompt': 'nouveau prompt',
            'cronExpression': '0 12 * * *',
            'isDaemon': true,
            'status': 'Running',
            'uptime': '5m',
          }
        }
      }));

      final updated = await future;
      expect(updated.displayName, equals('hiss updated'));
      expect(updated.prompt, equals('nouveau prompt'));
      expect(updated.formattedSchedule, equals('Daily around 12:00 PM'));
    });

    test('triggerScheduledTask() sends trigger_scheduled_task and returns execution event', () async {
      final future = api.triggerScheduledTask('task_1');

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('trigger_scheduled_task'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'taskId': 'task_1',
          'status': 'triggered',
          'task': {
            'id': 'task_1',
            'name': 'hiss',
            'prompt': 'dis bonjour',
            'iterationsRun': 2,
            'events': [
              {
                'id': 'evt_99',
                'timestamp': '2026-08-14T15:00:00.000Z',
                'outcome': 'done',
                'message': 'Triggered task: dis bonjour',
                'durationMs': 130,
              }
            ]
          }
        }
      }));

      final triggered = await future;
      expect(triggered, isNotNull);
      expect(triggered!.iterationsRun, equals(2));
      expect(triggered.events.length, equals(1));
      expect(triggered.events.first.outcome, equals('done'));
    });

    test('cancelScheduledTask() sends cancel_scheduled_task and returns success', () async {
      final future = api.cancelScheduledTask('task_1');

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('cancel_scheduled_task'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'taskId': 'task_1',
          'status': 'cancelled',
        }
      }));

      final success = await future;
      expect(success, isTrue);
    });

    test('DaemonApi events stream receives and broadcasts scheduled task events', () async {
      final receivedEvents = <Map<String, dynamic>>[];
      final sub = api.events.listen(receivedEvents.add);

      incoming.add(jsonEncode({
        'type': 'scheduled_task_created',
        'data': {
          'task': {
            'id': 'ws_task_42',
            'name': 'Nightly Backup',
            'prompt': 'backup database',
            'cronExpression': '0 0 * * *',
            'status': 'Running',
            'uptime': '10m',
          }
        }
      }));

      await Future.delayed(const Duration(milliseconds: 50));
      expect(receivedEvents.isNotEmpty, isTrue);
      expect(receivedEvents.first['type'], equals('scheduled_task_created'));
      expect(receivedEvents.first['broadcast'], isTrue);

      await sub.cancel();
    });

    testWidgets('ScheduledTasksScreen renders tasks', (tester) async {
      final testTasks = [
        ScheduledTaskItem(
          id: 'task_ws_1',
          name: 'Nightly Backup',
          prompt: 'backup database',
          cronExpression: '0 0 * * *',
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: testTasks,
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Nightly Backup'), findsOneWidget);
      expect(find.text('Daily around 12:00 AM'), findsOneWidget);
    });
  });
}
