import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/md3_spinner.dart';
import 'package:mobile/widgets/resolved_ask_question_card.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:mobile/features/chat_stream/widgets/execution_progress_view.dart';

void main() {
  group('Session Execution Alignment Tests', () {
    testWidgets('ResolvedAskQuestionCard renders question header, bold text, and answer', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ResolvedAskQuestionCard(
              question: "L'agent navigateur a rencontré une erreur. Comment procéder ?",
              selectedAnswer: 'corrige cdp (write-in)',
              questionCountLabel: '1 question',
            ),
          ),
        ),
      );

      expect(find.text('1 question'), findsOneWidget);
      expect(find.byIcon(Icons.help_outline_rounded), findsOneWidget);
      expect(find.text("L'agent navigateur a rencontré une erreur. Comment procéder ?"), findsOneWidget);
      expect(find.text('corrige cdp (write-in)'), findsOneWidget);
    });

    testWidgets('ResolvedAskQuestionCard automatically adds (write-in) tag if isWriteIn is true', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ResolvedAskQuestionCard(
              question: 'Quel modèle utiliser ?',
              selectedAnswer: 'Custom API Key',
              isWriteIn: true,
            ),
          ),
        ),
      );

      expect(find.text('Custom API Key (write-in)'), findsOneWidget);
    });

    testWidgets('Md3DoubleTrackSpinner renders and animates smoothly', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Md3DoubleTrackSpinner(size: 16, strokeWidth: 2),
          ),
        ),
      );

      expect(find.byType(Md3DoubleTrackSpinner), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byType(Md3DoubleTrackSpinner), findsOneWidget);
    });

    testWidgets('ChatInputBar displays 4 capability badges and triggers actions', (tester) async {
      bool filesOpened = false;
      bool terminalOpened = false;
      bool diffViewed = false;
      bool browserOpened = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatInputBar(
              onSend: (msg, {bool queued = false, String? modelUID, int? modelEnum, List<String>? images, String? base64Data, String? fileName, List<Map<String, dynamic>>? media}) {},
              onOpenFiles: () => filesOpened = true,
              onOpenTerminal: () => terminalOpened = true,
              onViewDiff: () => diffViewed = true,
              onOpenBrowser: () => browserOpened = true,
              activeSubsystems: const {'files', 'terminal', 'window', 'browser'},
            ),
          ),
        ),
      );

      // Check the 4 capability icons
      expect(find.byIcon(Icons.insert_drive_file_outlined), findsOneWidget);
      expect(find.byIcon(Icons.terminal_rounded), findsOneWidget);
      expect(find.byIcon(Icons.web_asset_outlined), findsOneWidget);
      expect(find.byIcon(Icons.travel_explore_rounded), findsOneWidget);

      // Tap on Files
      await tester.tap(find.byIcon(Icons.insert_drive_file_outlined));
      expect(filesOpened, isTrue);

      // Tap on Terminal
      await tester.tap(find.byIcon(Icons.terminal_rounded));
      expect(terminalOpened, isTrue);

      // Tap on ViewDiff/Window
      await tester.tap(find.byIcon(Icons.web_asset_outlined));
      expect(diffViewed, isTrue);

      // Tap on Browser
      await tester.tap(find.byIcon(Icons.travel_explore_rounded));
      expect(browserOpened, isTrue);
    });

    testWidgets('ExecutionProgressView renders live Working spinner while streaming', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ExecutionProgressView(
              thoughtText: 'Analyzing code structure...',
              isStreaming: true,
            ),
          ),
        ),
      );

      // Should render the double-track spinner inside the Working indicator
      expect(find.byType(Md3DoubleTrackSpinner), findsWidgets);
      expect(find.textContaining('Working'), findsWidgets);
    });
  });
}
