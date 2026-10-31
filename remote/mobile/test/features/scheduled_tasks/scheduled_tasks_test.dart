import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/scheduled_tasks/models/scheduled_task_item.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_tasks_screen.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_task_detail_screen.dart';

void main() {
  group('ScheduledTaskItem Model', () {
    test('serializes and deserializes from JSON correctly', () {
      final json = {
        'id': 'task_cron_123',
        'prompt': 'Check health and report',
        'name': 'Health Check',
        'workspaceName': 'antigravity-add-model-main',
        'cronExpression': '*/5 * * * *',
        'durationSeconds': null,
        'isDaemon': true,
        'iterationsRun': 42,
        'nextRunAt': '2026-08-14T14:00:00.000Z',
        'isEnabled': true,
        'status': 'Running',
        'uptime': '5m',
        'events': [
          {
            'id': 'evt_1',
            'timestamp': '2026-08-14T14:00:00.000Z',
            'outcome': 'done',
            'message': 'Execution successful',
            'durationMs': 120,
          }
        ],
      };

      final item = ScheduledTaskItem.fromJson(json);
      expect(item.id, equals('task_cron_123'));
      expect(item.prompt, equals('Check health and report'));
      expect(item.name, equals('Health Check'));
      expect(item.workspaceName, equals('antigravity-add-model-main'));
      expect(item.cronExpression, equals('*/5 * * * *'));
      expect(item.isDaemon, isTrue);
      expect(item.iterationsRun, equals(42));
      expect(item.status, equals('Running'));
      expect(item.events.length, equals(1));
      expect(item.events.first.outcome, equals('done'));

      final encoded = item.toJson();
      expect(encoded['id'], equals('task_cron_123'));
      expect(encoded['name'], equals('Health Check'));
      expect(encoded['cronExpression'], equals('*/5 * * * *'));
      expect(encoded['isDaemon'], isTrue);
      expect(encoded['iterationsRun'], equals(42));
    });

    test('handles one-shot timer JSON', () {
      final json = {
        'id': 'timer_1',
        'prompt': 'Remind me to push branch',
        'durationSeconds': 600,
        'isDaemon': false,
        'iterationsRun': 0,
      };

      final item = ScheduledTaskItem.fromJson(json);
      expect(item.id, equals('timer_1'));
      expect(item.durationSeconds, equals(600));
      expect(item.cronExpression, isNull);
      expect(item.isDaemon, isFalse);
    });
  });

  group('ScheduledTasksScreen Widget', () {
    testWidgets('renders active cron jobs and one-shot timers', (tester) async {
      final tasks = [
        ScheduledTaskItem(
          id: 'task_cron_1',
          prompt: 'Run server health check',
          cronExpression: '*/5 * * * *',
          isDaemon: true,
          iterationsRun: 12,
        ),
        ScheduledTaskItem(
          id: 'task_timer_2',
          prompt: 'Run memory cleanup',
          durationSeconds: 300,
          isDaemon: false,
          iterationsRun: 0,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: tasks,
            onCancelTask: (_) {},
            onTriggerNow: (_) {},
          ),
        ),
      );

      expect(find.text('Scheduled Tasks'), findsOneWidget);
      expect(find.text('Run server health check'), findsOneWidget);
      expect(find.text('Run memory cleanup'), findsOneWidget);
    });

    testWidgets('renders empty state when no tasks exist', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: const [],
            onCancelTask: (_) {},
            onTriggerNow: (_) {},
          ),
        ),
      );

      expect(find.text('Scheduled Tasks'), findsOneWidget);
      expect(find.text('Aucune tâche planifiée'), findsOneWidget);
    });

    testWidgets('calls onTriggerNow when trigger button is tapped', (tester) async {
      String? triggeredId;
      final tasks = [
        ScheduledTaskItem(
          id: 'task_trigger_me',
          prompt: 'Execute data sync',
          cronExpression: '0 * * * *',
          isDaemon: false,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: tasks,
            onTriggerNow: (id) => triggeredId = id,
            onCancelTask: (_) {},
          ),
        ),
      );

      final actionBtn = find.byTooltip('Actions');
      expect(actionBtn, findsOneWidget);

      await tester.tap(actionBtn);
      await tester.pumpAndSettle();

      final triggerOption = find.text('Trigger Now');
      expect(triggerOption, findsOneWidget);
      await tester.tap(triggerOption);
      await tester.pumpAndSettle();

      expect(triggeredId, equals('task_trigger_me'));
    });

    testWidgets('calls onCancelTask when cancel button is tapped', (tester) async {
      String? cancelledId;
      final tasks = [
        ScheduledTaskItem(
          id: 'task_cancel_me',
          prompt: 'Check logs every minute',
          cronExpression: '* * * * *',
          isDaemon: true,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: tasks,
            onTriggerNow: (_) {},
            onCancelTask: (id) => cancelledId = id,
          ),
        ),
      );

      final actionBtn = find.byTooltip('Actions');
      expect(actionBtn, findsOneWidget);

      await tester.tap(actionBtn);
      await tester.pumpAndSettle();

      final deleteOption = find.text('Delete');
      expect(deleteOption, findsOneWidget);
      await tester.tap(deleteOption);
      await tester.pumpAndSettle();

      expect(cancelledId, equals('task_cancel_me'));
    });

    testWidgets('toggles switch and updates task state', (tester) async {
      String? toggledId;
      bool? toggledState;

      final tasks = [
        ScheduledTaskItem(
          id: 'task_toggle_me',
          prompt: 'Periodic sync',
          cronExpression: '0 9 * * *',
          isEnabled: true,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: tasks,
            onToggleTask: (id, enabled) {
              toggledId = id;
              toggledState = enabled;
            },
          ),
        ),
      );

      final switchFinder = find.byType(Switch);
      expect(switchFinder, findsOneWidget);

      await tester.tap(switchFinder);
      await tester.pumpAndSettle();

      expect(toggledId, equals('task_toggle_me'));
      expect(toggledState, isFalse);
    });

    testWidgets('opens + New modal and adds a task', (tester) async {
      ScheduledTaskItem? createdTask;

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTasksScreen(
            tasks: const [],
            workspaces: const ['antigravity-add-model-main'],
            onAddTask: (task) => createdTask = task,
          ),
        ),
      );

      final newBtn = find.text('+ New');
      expect(newBtn, findsOneWidget);

      await tester.tap(newBtn);
      await tester.pumpAndSettle();

      expect(find.text('New Scheduled Task'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Enter scheduled task name...'), 'hiss');
      await tester.enterText(find.widgetWithText(TextField, 'Enter a prompt for the agent to run...'), 'dis bonjour en seul mots');

      final addBtn = find.widgetWithText(ElevatedButton, 'Add Scheduled Task').last;
      await tester.ensureVisible(addBtn);
      await tester.tap(addBtn);
      await tester.pumpAndSettle();

      expect(createdTask, isNotNull);
      expect(createdTask!.displayName, equals('hiss'));
      expect(createdTask!.prompt, equals('dis bonjour en seul mots'));
    });
  });

  group('ScheduledTaskDetailScreen Widget (Antigravity 2.0)', () {
    testWidgets('renders full task details, prompt, schedule and status card', (tester) async {
      final task = ScheduledTaskItem(
        id: 'task_hiss_1',
        name: 'hiss',
        prompt: 'dis bonjour en seul mots',
        workspaceName: 'antigravity-add-model-main',
        cronExpression: '0 9 * * *',
        isDaemon: true,
        status: 'Running',
        uptime: '1m',
        events: const [],
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTaskDetailScreen(
            task: task,
          ),
        ),
      );

      expect(find.text('Scheduled Tasks / hiss'), findsOneWidget);
      expect(find.text('hiss'), findsWidgets);
      expect(find.text('antigravity-add-model-main'), findsOneWidget);
      expect(find.text('Running'), findsOneWidget);
      expect(find.text('Scheduled'), findsOneWidget);
      expect(find.text('1m'), findsOneWidget);
      expect(find.text('dis bonjour en seul mots'), findsOneWidget);
      expect(find.text('Daily'), findsOneWidget);
      expect(find.text('9:00 AM'), findsOneWidget);
      expect(find.text('No events recorded.'), findsOneWidget);
      expect(find.text('Save'), findsOneWidget);
    });

    testWidgets('edits prompt and clicks Save to update task', (tester) async {
      ScheduledTaskItem? updatedTask;

      final task = ScheduledTaskItem(
        id: 'task_hiss_2',
        name: 'hiss',
        prompt: 'ancien prompt',
        workspaceName: 'antigravity-add-model-main',
        cronExpression: '0 9 * * *',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTaskDetailScreen(
            task: task,
            onUpdateTask: (item) => updatedTask = item,
          ),
        ),
      );

      final promptField = find.widgetWithText(TextField, 'ancien prompt');
      expect(promptField, findsOneWidget);

      await tester.enterText(promptField, 'nouveau prompt');
      final saveBtn = find.widgetWithText(ElevatedButton, 'Save');
      await tester.ensureVisible(saveBtn);
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();

      expect(updatedTask, isNotNull);
      expect(updatedTask!.prompt, equals('nouveau prompt'));
      expect(find.text('Scheduled task saved'), findsOneWidget);
    });

    testWidgets('triggers task execution and displays new event in Events log', (tester) async {
      String? executedTaskId;

      final task = ScheduledTaskItem(
        id: 'task_hiss_3',
        name: 'hiss',
        prompt: 'dis bonjour en seul mots',
        cronExpression: '0 9 * * *',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ScheduledTaskDetailScreen(
            task: task,
            onTriggerNow: (id) => executedTaskId = id,
          ),
        ),
      );

      final triggerBtn = find.byTooltip('Trigger Now');
      expect(triggerBtn, findsOneWidget);

      await tester.tap(triggerBtn);
      await tester.pumpAndSettle();

      expect(executedTaskId, equals('task_hiss_3'));
      expect(find.text('Triggered task: dis bonjour en seul mots'), findsOneWidget);
      expect(find.text('1 run'), findsOneWidget);
    });
  });
}
