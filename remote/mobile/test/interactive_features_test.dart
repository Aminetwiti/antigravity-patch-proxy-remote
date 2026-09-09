import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/stream_parser.dart';
import 'package:mobile/widgets/ask_question_choice_card.dart';
import 'package:mobile/widgets/unified_diff_viewer.dart';

void main() {
  group('AskQuestion & Choice Card Tests', () {
    test('StreamDeltaParser extracts ask_question correctly', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'tool': 'ask_question',
              'callId': 'q_1',
              'cascadeId': 'cas_1',
              'detail': '{"question": "Choose database", "options": ["PostgreSQL", "SQLite"], "isMultiSelect": false}',
            }
          ]
        }
      };

      final q = StreamDeltaParser.questionOf(msg);
      expect(q, isNotNull);
      expect(q!.requestId, 'q_1');
      expect(q.question, 'Choose database');
      expect(q.options, containsAll(['PostgreSQL', 'SQLite']));
      expect(q.isMultiSelect, isFalse);
    });

    test('questionOf returns null on run_command with options (H1 ghost guard)', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'tool': 'run_command',
              'callId': 'cmd_1',
              'detail': '{"command_line":"ls","options":{"cwd":"/tmp"}}',
            }
          ]
        }
      };

      // H1 : un run_command dont les args contiennent un champ "options" ne
      // doit PAS produire de carte question fantôme.
      expect(StreamDeltaParser.questionOf(msg), isNull);
    });

    test('questionOf returns null on unparseable detail (H1 ghost guard)', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'tool': 'ask_question',
              'callId': 'q_bad',
              'detail': 'not json at all',
            }
          ]
        }
      };

      // H1 : plus de question synthétique "Please review and choose an option"
      // — payload inexploitable => null (le debugPrint aide au diagnostic).
      expect(StreamDeltaParser.questionOf(msg), isNull);
    });

    test('questionOf returns null on detail without question field (H1)', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'approval_required',
              'tool': 'generic_tool',
              'callId': 't_1',
              'detail': '{"options":["a","b"]}',
            }
          ]
        }
      };

      expect(StreamDeltaParser.questionOf(msg), isNull);
    });

    testWidgets('AskQuestionChoiceCard single-select toggle and submit', (tester) async {
      List<String> submittedAnswers = [];
      String? submittedCustom;

      final req = AskQuestionChoiceRequest(
        requestId: 'q_test',
        question: 'Which framework?',
        options: const ['Flutter', 'React Native'],
        isMultiSelect: false,
        allowCustom: true,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AskQuestionChoiceCard(
              request: req,
              onSubmit: (selected, custom) {
                submittedAnswers = selected;
                submittedCustom = custom;
              },
            ),
          ),
        ),
      );

      // Verify question is displayed
      expect(find.text('Which framework?'), findsOneWidget);
      expect(find.text('Flutter'), findsOneWidget);
      expect(find.text('React Native'), findsOneWidget);

      // Tap Flutter option
      await tester.tap(find.text('Flutter'));
      await tester.pump();

      // Tap Submit Choice
      await tester.tap(find.text('Submit Choice'));
      await tester.pump();

      expect(submittedAnswers, contains('Flutter'));
      expect(submittedCustom, isNull);
    });
  });

  group('UnifiedDiffViewer Tests', () {
    testWidgets('UnifiedDiffViewer parses and renders additions and deletions', (tester) async {
      const diff = '''
--- a/main.go
+++ b/main.go
@@ -1,3 +1,4 @@
 package main
-import "fmt"
+import "log"
+import "os"
''';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 400,
              child: UnifiedDiffViewer(
                diffContent: diff,
                fileName: 'main.go',
              ),
            ),
          ),
        ),
      );

      expect(find.text('main.go'), findsOneWidget);
      expect(find.text('+2'), findsOneWidget); // 2 additions
      expect(find.text('-1'), findsOneWidget); // 1 deletion
      expect(find.text('import "log"'), findsOneWidget);
      expect(find.text('import "fmt"'), findsOneWidget);
    });

    testWidgets('UnifiedDiffViewer allows tapping line and creating annotations', (tester) async {
      String? sentReview;
      const diff = '''
--- a/main.go
+++ b/main.go
@@ -1,2 +1,2 @@
-func Old() {}
+func New() {}
''';

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 500,
              child: UnifiedDiffViewer(
                diffContent: diff,
                fileName: 'main.go',
                onSendReview: (review) {
                  sentReview = review;
                },
              ),
            ),
          ),
        ),
      );

      // Tap on the line "+func New() {}"
      await tester.tap(find.text('func New() {}'));
      await tester.pumpAndSettle();

      // Verify dialog is opened
      expect(find.byType(AlertDialog), findsOneWidget);

      // Enter annotation comment
      await tester.enterText(find.byType(TextField), 'Add unit tests for this function');
      await tester.tap(find.text('Enregistrer'));
      await tester.pumpAndSettle();

      // Verify annotation badge & review queue bar appear
      expect(find.text('Add unit tests for this function'), findsOneWidget);
      expect(find.text('1 note(s) de revue'), findsOneWidget);
      expect(find.text("Envoyer à l'Agent"), findsOneWidget);

      // Tap send review
      await tester.tap(find.text("Envoyer à l'Agent"));
      await tester.pumpAndSettle();

      expect(sentReview, contains('Code Review Feedback for `main.go`'));
      expect(sentReview, contains('Add unit tests for this function'));
    });

    testWidgets('UnifiedDiffViewer displays clean empty state when diff is empty or fallback', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 400,
              child: UnifiedDiffViewer(
                diffContent: '// Aucun diff disponible pour ce fichier',
                fileName: 'empty.dart',
                filePath: 'lib/src/empty.dart',
              ),
            ),
          ),
        ),
      );

      expect(find.text('empty.dart'), findsOneWidget);
      expect(find.text('lib/src/empty.dart'), findsOneWidget);
      expect(find.text('Aucune modification détaillée'), findsOneWidget);
      // Ensure no fake line numbers are rendered
      expect(find.text('1'), findsNothing);
    });

    testWidgets('UnifiedDiffViewer toggles word wrap mode on button tap', (tester) async {
      const diff = '''
--- a/config.dart
+++ b/config.dart
@@ -1,1 +1,1 @@
+final longString = "This is a very long string that should wrap or scroll properly";
''';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 400,
              child: UnifiedDiffViewer(
                diffContent: diff,
                fileName: 'config.dart',
              ),
            ),
          ),
        ),
      );

      expect(find.text('config.dart'), findsOneWidget);
      expect(find.byIcon(Icons.wrap_text_rounded), findsOneWidget);

      // Tap wrap toggle button
      await tester.tap(find.byIcon(Icons.wrap_text_rounded));
      await tester.pumpAndSettle();

      // Icon should change to format_align_left_rounded
      expect(find.byIcon(Icons.format_align_left_rounded), findsOneWidget);
    });

    testWidgets('UnifiedDiffViewer collapses unchanged context lines and allows expanding', (tester) async {
      final diff = StringBuffer();
      diff.writeln('--- a/file.txt');
      diff.writeln('+++ b/file.txt');
      diff.writeln('@@ -1,20 +1,21 @@');
      for (int i = 1; i <= 15; i++) {
        diff.writeln(' context line $i');
      }
      diff.writeln('+added line');
      for (int i = 16; i <= 20; i++) {
        diff.writeln(' context line $i');
      }

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              height: 600,
              child: UnifiedDiffViewer(
                diffContent: diff.toString(),
                fileName: 'file.txt',
              ),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // 15 lines of context: runLen 15 > 6 -> 3 leading, middle 9 folded, 3 trailing
      expect(find.text('... 9 lignes inchangées ...'), findsOneWidget);
      expect(find.text('(déplier)'), findsOneWidget);

      // Tap to unfold
      await tester.tap(find.text('... 9 lignes inchangées ...'));
      await tester.pumpAndSettle();

      // Folded banner should disappear as it is now unfolded
      expect(find.text('... 9 lignes inchangées ...'), findsNothing);
    });
  });
}

