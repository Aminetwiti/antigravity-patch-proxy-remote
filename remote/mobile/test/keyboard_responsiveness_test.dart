import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/question_choice.dart';
import 'package:mobile/features/code_review/widgets/add_comment_dialog.dart';
import 'package:mobile/features/settings/shortcuts_modal.dart';
import 'package:mobile/features/workspace/git_commit_dialog.dart';
import 'package:mobile/theme/app_theme.dart';
import 'package:mobile/widgets/ask_question_choice_card.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:mobile/widgets/voice_prompt_dialog.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const resolutionsWithKeyboard = [
    Size(320, 568),  // iPhone SE compact
    Size(360, 640),  // Android compact
    Size(375, 667),  // iPhone 8
    Size(390, 844),  // iPhone 13
    Size(412, 915),  // Pixel 7
  ];

  const landscapeResolutions = [
    Size(640, 360),  // Landscape mobile compact
    Size(800, 480),  // Landscape tablet / small screen
  ];

  const portraitKeyboardInsets = [
    EdgeInsets.only(bottom: 260),
    EdgeInsets.only(bottom: 340),
    EdgeInsets.only(bottom: 400),
  ];

  const landscapeKeyboardInsets = [
    EdgeInsets.only(bottom: 160),
    EdgeInsets.only(bottom: 200),
    EdgeInsets.only(bottom: 240),
  ];

  Widget buildTestableWidget(Widget child, {required Size size, required EdgeInsets viewInsets}) {
    return MediaQuery(
      data: MediaQueryData(
        size: size,
        viewInsets: viewInsets,
        padding: const EdgeInsets.only(top: 24, bottom: 16),
      ),
      child: MaterialApp(
        theme: AppTheme.darkTheme,
        home: Material(child: child),
      ),
    );
  }

  group('Deep Keyboard Responsiveness Audit (Open Keyboard Insets)', () {
    final testCases = <MapEntry<Size, EdgeInsets>>[
      for (final size in resolutionsWithKeyboard)
        for (final insets in portraitKeyboardInsets)
          MapEntry(size, insets),
      for (final size in landscapeResolutions)
        for (final insets in landscapeKeyboardInsets)
          MapEntry(size, insets),
    ];

    for (final entry in testCases) {
      final size = entry.key;
      final insets = entry.value;
      final label = '${size.width.toInt()}x${size.height.toInt()} + keyboard ${insets.bottom.toInt()}px';

      testWidgets('ChatInputBar with active stream on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            Scaffold(
              bottomNavigationBar: ChatInputBar(
                isConnected: true,
                hasActiveStream: true,
                projectName: 'Project Alpha',
                onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
                onStop: () {},
              ),
            ),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ChatInputBar stopped on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            Scaffold(
              bottomNavigationBar: ChatInputBar(
                isConnected: true,
                hasActiveStream: false,
                projectName: 'Project Beta',
                onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
                onStop: () {},
              ),
            ),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('VoicePromptDialog on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            VoicePromptDialog(onInsert: (_) {}),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pump(const Duration(milliseconds: 100));
        expect(tester.takeException(), isNull);
      });

      testWidgets('AddCommentDialog on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            AddCommentDialog(
              filePath: 'lib/core/protocol/daemon_api.dart',
              lineNumber: 42,
              selectedSnippet: 'final res = await client.post(uri, body: jsonEncode(payload));',
              onCommentAdded: (_) {},
            ),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('GitCommitDialog on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            const GitCommitDialog(
              api: null,
              workspacePath: '.',
            ),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ShortcutsModal on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          buildTestableWidget(
            const ShortcutsModal(),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('AskQuestionChoiceCard on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final payload = QuestionChoicePayload(
          toolCallId: 'call_1',
          question: 'Quel framework souhaitez-vous utiliser pour ce composant ?',
          options: [
            '(Recommended) Flutter 3.29 avec Material 3',
            'React Native avec Fabric',
            'SwiftUI natif',
          ],
          isMultiSelect: false,
        );

        await tester.pumpWidget(
          buildTestableWidget(
            SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: AskQuestionChoiceCard(payload: payload),
              ),
            ),
            size: size,
            viewInsets: insets,
          ),
        );

        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
