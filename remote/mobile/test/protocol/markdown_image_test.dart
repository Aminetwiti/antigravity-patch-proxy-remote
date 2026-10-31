import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/markdown_renderer.dart';
import 'package:mobile/widgets/markdown_bubble.dart';

void main() {
  test('MarkdownRenderer inlineSpans extracts markdown images', () {
    const text = 'Here is a chart: ![Architecture Diagram](file:///C:/Users/test/scratch/upload_123.png)';
    final spans = MarkdownRenderer.inlineSpans(
      text,
      const TextStyle(fontSize: 14),
      scheme: const ColorScheme.dark(),
    );

    expect(spans.length, greaterThanOrEqualTo(2));
    final widgetSpans = spans.whereType<WidgetSpan>().toList();
    expect(widgetSpans.isNotEmpty, isTrue);
  });

  testWidgets('MarkdownBubble renders markdown image widget', (tester) async {
    String? openedFile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MarkdownBubble(
            text: '![Screenshot](file:///C:/Users/test/scratch/upload_123.png)',
            onLocalFile: (path) => openedFile = path,
          ),
        ),
      ),
    );

    expect(find.text('Screenshot'), findsOneWidget);
    expect(find.text("Image enregistrée sur l'hôte"), findsOneWidget);
    expect(find.byIcon(Icons.image_outlined), findsOneWidget);

    // Tap to open on host
    await tester.tap(find.text('Screenshot'));
    await tester.pump();

    expect(openedFile, contains('upload_123.png'));
  });

  testWidgets('MarkdownBubble renders bracketed image attachment [Images jointes: ...]', (tester) async {
    String? openedFile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MarkdownBubble(
            text: '[Images jointes: file:///C:/Users/test/scratch/upload_456.png]\n\nVoici le bug UI',
            onLocalFile: (path) => openedFile = path,
          ),
        ),
      ),
    );

    expect(find.text('Images jointes'), findsOneWidget);
    expect(find.text("Image enregistrée sur l'hôte"), findsOneWidget);
    expect(find.text('Voici le bug UI'), findsOneWidget);

    await tester.tap(find.text('Images jointes'));
    await tester.pump();

    expect(openedFile, contains('upload_456.png'));
  });

  testWidgets('MarkdownBubble renders bracketed file attachment [Fichier: ...]', (tester) async {
    String? openedFile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MarkdownBubble(
            text: '[Fichier: file:///C:/Users/test/config.json]\n\nRegarde la config',
            onLocalFile: (path) => openedFile = path,
          ),
        ),
      ),
    );

    expect(find.text('config.json'), findsOneWidget);
    expect(find.text('Regarde la config'), findsOneWidget);
    expect(find.byIcon(Icons.insert_drive_file_outlined), findsOneWidget);

    await tester.tap(find.text('config.json'));
    await tester.pump();

    expect(openedFile, contains('config.json'));
  });
}
