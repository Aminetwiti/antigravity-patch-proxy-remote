import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/background_task_output_sheet.dart';
import 'package:mobile/widgets/background_tasks_bar.dart';

void main() {
  group('BackgroundTasksBar', () {
    testWidgets('renders single running task with correct command and handles stop', (tester) async {
      bool stopped = false;
      bool tapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackgroundTasksBar(
              runningTasks: const ['flutter test --exclude-tags=live'],
              onStopTask: (_) => stopped = true,
              onTapTask: (_) => tapped = true,
              initiallyExpanded: true,
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 250));



      expect(find.text('1 task running'), findsOneWidget);
      expect(find.text('flutter test --exclude-tags=live'), findsOneWidget);

      await tester.tap(find.text('Stop'));
      await tester.pump();
      expect(stopped, isTrue);

      await tester.tap(find.text('flutter test --exclude-tags=live'));
      await tester.pump();
      expect(tapped, isTrue);

    });

    testWidgets('renders multiple tasks with expandable chevron', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BackgroundTasksBar(
              runningTasks: ['task 1', 'task 2'],
              initiallyExpanded: false,
            ),
          ),
        ),
      );

      expect(find.text('2 tasks running'), findsOneWidget);
      await tester.tap(find.byType(InkWell).first);
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byIcon(Icons.keyboard_arrow_up_rounded), findsOneWidget);
      expect(find.text('task 1'), findsWidgets);
      expect(find.text('task 2'), findsOneWidget);
    });
  });

  group('BackgroundTaskOutputSheet', () {
    testWidgets('renders output with line numbers and handles stop action', (tester) async {
      bool stopped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackgroundTaskOutputSheet(
              taskId: 'task-1',
              command: 'flutter test',
              initialOutput: 'Line 1\nLine 2\nLine 3',
              status: 'running',
              onStop: () => stopped = true,
            ),
          ),
        ),
      );

      expect(find.text('Background Task Output'), findsOneWidget);
      expect(find.text('flutter test'), findsOneWidget);
      expect(find.text('EN COURS'), findsOneWidget);
      expect(find.text('Line 1'), findsOneWidget);
      expect(find.text('Line 2'), findsOneWidget);
      expect(find.text('Line 3'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.stop_circle_rounded));
      await tester.pump();

      expect(stopped, isTrue);
    });

    testWidgets('does not overflow on narrow mobile screen with long command', (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BackgroundTaskOutputSheet(
              taskId: 'task-long-id-12345',
              command: 'flutter test --exclude-tags=live --coverage --branch-coverage',
              initialOutput: 'Running long analysis command...\nStep 1/10\nStep 2/10',
              status: 'running',
              onStop: () {},
            ),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('Background Task Output'), findsOneWidget);
      expect(find.byIcon(Icons.copy_rounded), findsOneWidget);
      expect(find.byIcon(Icons.stop_circle_rounded), findsOneWidget);
      expect(find.byIcon(Icons.close_rounded), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  });
}
