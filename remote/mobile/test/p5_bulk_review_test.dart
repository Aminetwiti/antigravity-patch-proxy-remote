import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/session_review_view.dart';
import 'package:mobile/widgets/markdown_bubble.dart';

void main() {
  group('SessionReviewView', () {
    const files = [
      SessionModifiedFile(path: 'lib/a.dart', additions: 2, deletions: 0),
      SessionModifiedFile(path: 'lib/b.dart', additions: 0, deletions: 1),
    ];

    testWidgets('renders modified files list and no bulk accept/discard buttons', (tester) async {
      SessionModifiedFile? openedFile;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SessionReviewView(
            files: files,
            onOpenFileDiff: (f) => openedFile = f,
          ),
        ),
      ));
      expect(find.text('Tout accepter'), findsNothing);
      expect(find.text('Tout rejeter'), findsNothing);
      expect(find.text('a.dart'), findsOneWidget);
      expect(find.text('b.dart'), findsOneWidget);
      await tester.tap(find.text('a.dart'));
      expect(openedFile?.fileName, 'a.dart');
    });
  });

  group('P3 — MarkdownBubble Run chip', () {
    testWidgets('bash block renders without daemon (no crash)', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: MarkdownBubble(
            text: '```bash\nls -la\n```',
            api: null, // not connected → Run chip hidden
          ),
        ),
      ));
      expect(find.textContaining('ls -la', findRichText: true), findsOneWidget);
    });
  });
}
