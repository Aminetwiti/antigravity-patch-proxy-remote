import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/chat_input_bar.dart';

void main() {
  testWidgets('ChatInputBar renders attachment preview and clears on tap', (tester) async {
    String? sentMessage;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatInputBar(
            onSend: (msg, {modelEnum, modelUID, queued = false, images, base64Data, fileName, media}) {
              sentMessage = msg;
            },
          ),
        ),
      ),
    );

    // Initial state: no attachment preview
    expect(find.byIcon(Icons.close_rounded), findsNothing);

    // Verify attachment button is present
    expect(find.byIcon(Icons.add), findsOneWidget);

    // Tap attachment button to open bottom sheet menu
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();

    // Verify menu items
    expect(find.text('Prendre une photo'), findsOneWidget);
    expect(find.text('Choisir des images'), findsOneWidget);
    expect(find.text('Sélectionner des fichiers'), findsOneWidget);
    expect(find.text('Coller depuis le presse-papier mobile'), findsOneWidget);
    expect(find.text('Saisie manuelle (Base64 / Texte)'), findsOneWidget);

    // Tap manual entry
    await tester.tap(find.text('Saisie manuelle (Base64 / Texte)'));
    await tester.pumpAndSettle();

    // Dialog is shown
    expect(find.text('Joindre un fichier (.txt, .json, .md, .csv)'), findsOneWidget);

    // Enter file name and content
    await tester.enterText(find.widgetWithText(TextField, 'Nom du fichier (ex: data.json, doc.md)'), 'test_config.json');
    await tester.enterText(find.widgetWithText(TextField, 'Contenu'), '{"theme": "zenithal"}');

    // Tap 'Joindre'
    await tester.tap(find.text('Joindre'));
    await tester.pumpAndSettle();

    // Verify attachment preview card is displayed
    expect(find.text('test_config.json'), findsOneWidget);
    expect(find.byIcon(Icons.close_rounded), findsOneWidget);

    // Send message with attachment
    await tester.enterText(find.byType(TextField), 'Check this config');
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pumpAndSettle();

    expect(sentMessage, isNotNull);
    expect(sentMessage, contains('[Fichier: test_config.json]'));
    expect(sentMessage, contains('{"theme": "zenithal"}'));
    expect(sentMessage, contains('Check this config'));

    // Verify attachment preview is cleared after send
    expect(find.byIcon(Icons.close_rounded), findsNothing);
  });

  testWidgets('ChatInputBar supports multi-attachments and deletion', (tester) async {
    String? sentMessage;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatInputBar(
            onSend: (msg, {modelEnum, modelUID, queued = false, images, base64Data, fileName, media}) {
              sentMessage = msg;
            },
          ),
        ),
      ),
    );

    // Add first attachment
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Saisie manuelle (Base64 / Texte)'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nom du fichier (ex: data.json, doc.md)'), 'file1.txt');
    await tester.enterText(find.widgetWithText(TextField, 'Contenu'), 'Content 1');
    await tester.tap(find.text('Joindre'));
    await tester.pumpAndSettle();

    // Add second attachment
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Saisie manuelle (Base64 / Texte)'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nom du fichier (ex: data.json, doc.md)'), 'file2.txt');
    await tester.enterText(find.widgetWithText(TextField, 'Contenu'), 'Content 2');
    await tester.tap(find.text('Joindre'));
    await tester.pumpAndSettle();

    // Multi-attachment header should be visible
    expect(find.textContaining('2 pièces jointes'), findsOneWidget);
    expect(find.text('Tout effacer'), findsOneWidget);
    expect(find.text('file1.txt'), findsOneWidget);
    expect(find.text('file2.txt'), findsOneWidget);

    // Send combined message
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pumpAndSettle();

    expect(sentMessage, isNotNull);
    expect(sentMessage, contains('[Fichier: file1.txt]'));
    expect(sentMessage, contains('Content 1'));
    expect(sentMessage, contains('[Fichier: file2.txt]'));
    expect(sentMessage, contains('Content 2'));

    // Cleared after send
    expect(find.textContaining('pièces jointes'), findsNothing);
  });

  testWidgets('ChatInputBar passes fallback Base64 data when image upload is offline', (tester) async {
    String? sentMsg;
    String? sentB64;
    String? sentFile;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatInputBar(
            onSend: (msg, {modelEnum, modelUID, queued = false, images, base64Data, fileName, media}) {
              sentMsg = msg;
              sentB64 = base64Data;
              sentFile = fileName;
            },
          ),
        ),
      ),
    );

    // Open bottom sheet
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();

    // Open image dialog
    await tester.tap(find.text('Saisie manuelle (Base64 / Texte)'));
    await tester.pumpAndSettle();

    // Switch to photo by adding base64 image
    await tester.enterText(find.widgetWithText(TextField, 'Nom du fichier (ex: data.json, doc.md)'), 'photo.png');
    await tester.enterText(find.widgetWithText(TextField, 'Contenu'), 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    await tester.tap(find.text('Joindre'));
    await tester.pumpAndSettle();

    // Send message
    await tester.enterText(find.byType(TextField), 'analyser');
    await tester.tap(find.byKey(const Key('send-message-button')));
    await tester.pumpAndSettle();

    expect(sentMsg, contains('analyser'));
    expect(sentB64, isNotNull);
    expect(sentFile, equals('photo.png'));
  });
}
