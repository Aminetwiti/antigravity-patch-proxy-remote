import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/execution_progress_view.dart';

void main() {
  group('ExecutionProgressView — Antigravity 2.0 Fidelity Tests', () {
    testWidgets('Renders collapsible Task finished, Worked for, Timers, Auto-proceed and Working..', (tester) async {
      String? openedArtifact;

      const rawThought = '''
Vérification globale de la suite Gateway Go en cours...
Task 332 finished
Worked for 19m
Exécution de la suite complète de tests Flutter en cours...
Auto-proceeded with Implementation Plan
Worked for 35s
Timed 30 seconds
> Check flutter test results
Status: Fired
Attente des résultats des tests...
Wait for task-424: Timer has expired
> Check flutter test results
Explored 1 task
Task 424 finished
''';

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: Scaffold(
            body: SingleChildScrollView(
              child: ExecutionProgressView(
                messageId: 'msg-test-1',
                thoughtText: rawThought,
                isStreaming: true,
                modelLabel: 'Gemini 3.7 Flash High',
                onOpenArtifact: (name) {
                  openedArtifact = name;
                },
              ),
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 100));

      // 1. Vérification de l'en-tête de streaming et du modèle actif
      expect(find.textContaining("Agent en cours d'exécution"), findsOneWidget);
      expect(find.text('Gemini 3.7 Flash High'), findsOneWidget);

      // 2. Vérification des tâches terminées (Task 332 finished, Task 424 finished)
      expect(find.text('Task 332 finished'), findsOneWidget);
      expect(find.text('Task 424 finished'), findsOneWidget);

      // 3. Vérification des durées (Worked for 19m, Worked for 35s)
      expect(find.text('for 19m'), findsOneWidget);
      expect(find.text('for 35s'), findsOneWidget);

      // 4. Vérification de la pillule Auto-proceeded with Implementation Plan
      expect(find.text('Auto-proceeded with'), findsOneWidget);
      expect(find.text('Implementation Plan'), findsOneWidget);

      // Test du tap sur la pillule Auto-proceed
      await tester.tap(find.text('Implementation Plan'));
      expect(openedArtifact, equals('Implementation Plan'));

      // 5. Vérification du minuteur Timed 30 seconds et Wait for task-424
      expect(find.text('Timed 30 seconds'), findsOneWidget);
      expect(find.text('Wait for task-424: Timer has expired'), findsOneWidget);

      // 6. Vérification du texte narratif de l'agent
      expect(find.text('Vérification globale de la suite Gateway Go en cours...'), findsOneWidget);
      expect(find.text('Exécution de la suite complète de tests Flutter en cours...'), findsOneWidget);
      expect(find.text('Attente des résultats des tests...'), findsOneWidget);

      // 7. Vérification de l'indicateur d'exécution Working..
      expect(find.textContaining('Working'), findsWidgets);

      // 8. Test de dépliage d'un minuteur pour voir les détails (Check flutter test results & Status: Fired)
      await tester.tap(find.text('Timed 30 seconds'));
      await tester.pump();
      expect(find.text('Check flutter test results'), findsWidgets);
      expect(find.text('Status: Fired'), findsWidgets);
    });

    testWidgets('Hides Working.. and live header when isStreaming is false', (tester) async {
      const rawThought = '''
Task 332 finished
Worked for 19m
Task 424 finished
''';

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: const Scaffold(
            body: ExecutionProgressView(
              messageId: 'msg-test-done',
              thoughtText: rawThought,
              isStreaming: false,
              initiallyExpanded: true,
            ),

          ),
        ),
      );

      await tester.pump();

      expect(find.text("Agent en cours d'exécution"), findsNothing);
      expect(find.text('Task 332 finished'), findsOneWidget);
      expect(find.text('Task 424 finished'), findsOneWidget);
      expect(find.text('for 19m'), findsOneWidget);
    });

    testWidgets('Renders full granular steps (Analyzed #L, Viewed #L, Edited +X -Y, Ran command, Subagent, Search)', (tester) async {
      const detailedThought = '''
Viewed execution_progress_view.dart #L151-300
Analyzed history.go #L800-930
Edited stream_parser.dart +25 -5
Explored ExecutionProgressView
Search *.dart
Subagent Codebase Researcher
Ran flutter test test/widgets/execution_progress_view_test.dart
```console
> flutter test test/widgets/execution_progress_view_test.dart
00:02 +2: All tests passed!
```
Task 838 finished
''';

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: const Scaffold(
            body: SingleChildScrollView(
              child: ExecutionProgressView(
                messageId: 'msg-detailed-steps',
                thoughtText: detailedThought,
                isStreaming: false,
                initiallyExpanded: true,
              ),
            ),
          ),
        ),
      );

      await tester.pump();

      // File Analysis with Line Ranges
      expect(find.text('execution_progress_view.dart'), findsOneWidget);
      expect(find.text('#L151-300'), findsOneWidget);
      expect(find.text('history.go'), findsOneWidget);
      expect(find.text('#L800-930'), findsOneWidget);

      // File Edit with diffs
      expect(find.text('stream_parser.dart'), findsOneWidget);
      expect(find.text('+25'), findsOneWidget);
      expect(find.text('-5'), findsOneWidget);

      // Exploration & Search
      expect(find.text('ExecutionProgressView'), findsOneWidget);
      expect(find.text('*.dart'), findsOneWidget);

      // Subagent
      expect(find.text('Codebase Researcher'), findsOneWidget);

      // Command & Task Finished
      expect(find.text('flutter test test/widgets/execution_progress_view_test.dart'), findsOneWidget);
      expect(find.text('Task 838 finished'), findsOneWidget);

      // Tap on command to expand console output
      await tester.tap(find.text('flutter test test/widgets/execution_progress_view_test.dart'));
      await tester.pump();
      expect(find.textContaining('00:02 +2: All tests passed!'), findsOneWidget);
    });

    testWidgets('Groups multiple consecutive commands into a commandGroup accordion', (tester) async {
      const multiCmdThought = '''
Ran Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine }
```console
> Get-CimInstance Win32_Process
ProcessId CommandLine
1234      powershell.exe
```
Ran Stop-Process -Id 32896 -Force -ErrorAction SilentlyContinue
Ran Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine }
''';

      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          home: const Scaffold(
            body: SingleChildScrollView(
              child: ExecutionProgressView(
                messageId: 'msg-cmd-group',
                thoughtText: multiCmdThought,
                isStreaming: true,
                initiallyExpanded: true,
              ),
            ),
          ),
        ),
      );

      await tester.pump();

      // Vérification du groupement en accordéon "Running 3 commands"
      expect(find.text('3 commands'), findsOneWidget);
      expect(find.text('Running'), findsOneWidget);

      // Dépliage du sous-élément de commande pour afficher la boîte terminal
      expect(find.text('Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine }'), findsWidgets);
      expect(find.text('Stop-Process -Id 32896 -Force -ErrorAction SilentlyContinue'), findsOneWidget);

      await tester.tap(find.text('Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine }').first);
      await tester.pump();
      expect(find.textContaining('powershell.exe'), findsOneWidget);
    });
  });
}
