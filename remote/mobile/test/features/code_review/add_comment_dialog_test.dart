import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/code_review/models/code_comment.dart';
import 'package:mobile/features/code_review/widgets/add_comment_dialog.dart';

void main() {
  testWidgets('AddCommentDialog collects comment and emits CodeComment', (tester) async {
    CodeComment? createdComment;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AddCommentDialog(
            filePath: 'lib/main.dart',
            selectedSnippet: 'final x = calculate();',
            onCommentAdded: (c) => createdComment = c,
          ),
        ),
      ),
    );

    expect(find.text('Add Comment'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Please add null check here');
    await tester.tap(find.text('Queue Comment'));
    await tester.pumpAndSettle();

    expect(createdComment, isNotNull);
    expect(createdComment!.commentText, equals('Please add null check here'));
    expect(createdComment!.snippet, equals('final x = calculate();'));
    expect(createdComment!.filePath, equals('lib/main.dart'));
    expect(createdComment!.formatPromptQuote(), contains('lib/main.dart'));
    expect(createdComment!.formatPromptQuote(), contains('final x = calculate();'));
    expect(createdComment!.formatPromptQuote(), contains('Please add null check here'));
  });

  testWidgets('CodeComment formats prompt quote properly', (tester) async {
    final comment = CodeComment(
      id: 'c1',
      filePath: 'src/main.ts',
      snippet: 'const a = 1;',
      commentText: 'Make this let',
    );

    expect(comment.formatPromptQuote(), equals('> In `src/main.ts`:\n> ```\n> const a = 1;\n> ```\nMake this let\n'));
  });
}
