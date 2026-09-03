import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/markdown_renderer.dart';

void main() {
  group('MarkdownRenderer.blocksOf', () {
    test('splits fenced code blocks from paragraphs', () {
      final blocks = MarkdownRenderer.blocksOf(
        'Before\n```dart\nvoid main() {}\n```\nAfter',
      );
      expect(blocks.length, 3);
      expect(blocks[0].paragraph, 'Before');
      expect(blocks[1].code!.language, 'dart');
      expect(blocks[1].code!.code, 'void main() {}');
      expect(blocks[2].paragraph, 'After');
    });

    test('marks bullet and numbered list items', () {
      final blocks = MarkdownRenderer.blocksOf('- item one\n2. item two');
      expect(blocks.length, 2);
      expect(blocks[0].isListItem, isTrue);
      expect(blocks[0].paragraph, 'item one');
      expect(blocks[1].isListItem, isTrue);
      expect(blocks[1].paragraph, 'item two');
    });

    test('unterminated fence still yields a code block', () {
      final blocks = MarkdownRenderer.blocksOf('```python\nprint(1)');
      expect(blocks.length, 1);
      expect(blocks[0].code!.language, 'python');
      expect(blocks[0].code!.code, 'print(1)');
    });

    test('parses markdown headers with levels', () {
      final blocks = MarkdownRenderer.blocksOf('# Titre 1\n## Titre 2\n### Titre 3');
      expect(blocks.length, 3);
      expect(blocks[0].headerLevel, 1);
      expect(blocks[0].paragraph, 'Titre 1');
      expect(blocks[1].headerLevel, 2);
      expect(blocks[1].paragraph, 'Titre 2');
      expect(blocks[2].headerLevel, 3);
      expect(blocks[2].paragraph, 'Titre 3');
    });

    test('parses dividers and blockquotes', () {
      final blocks = MarkdownRenderer.blocksOf('---\n> Note importante');
      expect(blocks.length, 2);
      expect(blocks[0].isDivider, isTrue);
      expect(blocks[1].isQuote, isTrue);
      expect(blocks[1].paragraph, 'Note importante');
    });

    test('strips SYSTEM_MESSAGE tags and background notifications', () {
      final raw = '''<SYSTEM_MESSAGE>
[Message] timestamp=2026-08-17T16:13:24Z
sender=cd7ffa3c/task-146
priority=MESSAGE_PRIORITY_HIGH
content=Wait for go test to complete
</SYSTEM_MESSAGE>

Hello user, here is your result:
# All tests passed!''';
      final blocks = MarkdownRenderer.blocksOf(raw);
      expect(blocks.length, 2);
      expect(blocks[0].paragraph, 'Hello user, here is your result:');
      expect(blocks[1].headerLevel, 1);
      expect(blocks[1].paragraph, 'All tests passed!');
    });
  });

  group('MarkdownRenderer.inlineSpans', () {
    final scheme = const ColorScheme.light();
    test('resolves bold, italic and inline code', () {
      const base = TextStyle(fontSize: 14, color: Color(0xFFF4F4F5));
      final spans = MarkdownRenderer.inlineSpans(
        '**bold** and *italic* and `code` and plain',
        base,
        scheme: scheme,
      );
      final texts = spans.map((s) => (s as TextSpan).text).join();
      expect(texts, 'bold and italic and code and plain');

      final bold = spans[0] as TextSpan;
      expect(bold.style?.fontWeight, FontWeight.w700);
      final italic = spans[2] as TextSpan;
      expect(italic.style?.fontStyle, FontStyle.italic);
      final code = spans[4] as TextSpan;
      expect(code.style?.fontFamily, 'monospace');
    });

    test('ignores lone asterisks (no emphasis)', () {
      const base = TextStyle(fontSize: 14);
      final spans = MarkdownRenderer.inlineSpans('a * b * c', base, scheme: scheme);
      expect(spans.length, 1);
      expect((spans[0] as TextSpan).text, 'a * b * c');
    });

    test('file:/// link is tappable and reports the host path', () {
      const base = TextStyle(fontSize: 14);
      String? tapped;
      final spans = MarkdownRenderer.inlineSpans(
        '[plan](file:///C:/projet/implementation_plan.md)',
        base,
        scheme: scheme,
        onLocalFile: (p) => tapped = p,
      );
      expect(spans.length, 1);
      final span = spans[0] as WidgetSpan;
      final tooltip = span.child as Tooltip;
      final detector = tooltip.child as GestureDetector;
      detector.onTap!();
      expect(tapped, 'C:/projet/implementation_plan.md');
    });

    test('non-file links keep the tooltip (no tap handler)', () {
      const base = TextStyle(fontSize: 14);
      final spans = MarkdownRenderer.inlineSpans(
        '[site](https://example.com)',
        base,
        scheme: scheme,
        onLocalFile: (_) => fail('should not fire'),
      );
      final span = spans[0] as WidgetSpan;
      expect(span.child, isA<Tooltip>());
      expect((span.child as Tooltip).message, 'Chemin complet : https://example.com');
    });

    test('percent-encoded file URI is decoded', () {
      final spans = MarkdownRenderer.inlineSpans(
        '[a](file:///C:/projet/mon%20fichier.md)',
        const TextStyle(fontSize: 14),
        scheme: scheme,
        onLocalFile: (p) => expect(p, 'C:/projet/mon fichier.md'),
      );
      final span = spans[0] as WidgetSpan;
      final tooltip = span.child as Tooltip;
      (tooltip.child as GestureDetector).onTap!();
    });

    test('parses GFM markdown table with alignments', () {
      const md = '''
| Amélioration | Impact | Effort |
| --- | :---: | ---: |
| Micro-buffering | 100% fluide | Faible |
| Micro-Haptics | Physique | Très faible |
''';
      final blocks = MarkdownRenderer.blocksOf(md);
      expect(blocks.length, 1);
      final table = blocks[0].table;
      expect(table, isNotNull);
      expect(table!.headers, ['Amélioration', 'Impact', 'Effort']);
      expect(table.alignments, [
        TableCellAlignment.left,
        TableCellAlignment.center,
        TableCellAlignment.right,
      ]);
      expect(table.rows.length, 2);
      expect(table.rows[0], ['Micro-buffering', '100% fluide', 'Faible']);
      expect(table.rows[1], ['Micro-Haptics', 'Physique', 'Très faible']);
    });

    test('parses GitHub alerts blocks ([!IMPORTANT], > [!NOTE])', () {
      final blocks = MarkdownRenderer.blocksOf('''
[!IMPORTANT]
Mise à jour requise

> [!NOTE] Remarque utile
''');
      expect(blocks.length, 2);
      expect(blocks[0].alertType, 'IMPORTANT');
      expect(blocks[0].paragraph, 'Mise à jour requise');
      expect(blocks[1].alertType, 'NOTE');
      expect(blocks[1].paragraph, 'Remarque utile');
    });

    test('normalizes LaTeX symbols to unicode in inlineSpans', () {
      final spans = MarkdownRenderer.inlineSpans(
        r'Step 1 $\rightarrow$ Step 2 $\Rightarrow$ Done',
        const TextStyle(fontSize: 14),
        scheme: scheme,
      );
      final fullText = spans.map((s) => s.toPlainText()).join();
      expect(fullText, contains('Step 1 → Step 2 ⇒ Done'));
    });
  });
}
