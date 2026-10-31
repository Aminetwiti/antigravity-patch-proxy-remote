import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/mention_item.dart';
import 'package:mobile/features/chat_stream/widgets/mention_autocomplete_overlay.dart';
import 'package:mobile/widgets/chat_input_bar.dart';

void main() {
  testWidgets('MentionAutocompleteOverlay filters items and selects mention', (tester) async {
    MentionItem? selectedMention;
    final items = [
      const MentionItem(type: MentionType.file, label: 'main.dart', detail: 'lib/main.dart'),
      const MentionItem(type: MentionType.rule, label: 'clean_code', detail: '.agents/rules/clean_code.md'),
      const MentionItem(type: MentionType.mcp, label: 'coolify', detail: 'Deploy tools'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MentionAutocompleteOverlay(
            query: 'main',
            items: items,
            onSelected: (item) => selectedMention = item,
          ),
        ),
      ),
    );

    expect(find.text('main.dart'), findsOneWidget);
    expect(find.text('clean_code'), findsNothing);

    await tester.tap(find.text('main.dart'));
    await tester.pumpAndSettle();

    expect(selectedMention, isNotNull);
    expect(selectedMention!.label, equals('main.dart'));
    expect(selectedMention!.tag, equals('@file:main.dart'));
  });

  testWidgets('ChatInputBar displays MentionAutocompleteOverlay on @ and inserts tag', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatInputBar(
            onSend: (_, {queued = false, modelUID, modelEnum, images, base64Data, fileName, media}) {},
          ),
        ),
      ),
    );

    // Enter '@' in the text field
    final textFieldFinder = find.byType(TextField);
    expect(textFieldFinder, findsOneWidget);

    await tester.enterText(textFieldFinder, '@');
    await tester.pumpAndSettle();

    // Verify mention overlay is shown
    expect(find.text('Mentions (11)'), findsOneWidget);
    expect(find.text('main.dart'), findsOneWidget);

    // Tap on clean_code rule mention
    await tester.tap(find.text('clean_code'));
    await tester.pumpAndSettle();

    // Verify tag is inserted in text field
    final textField = tester.widget<TextField>(textFieldFinder);
    expect(textField.controller?.text, contains('@rule:clean_code '));
  });
}
