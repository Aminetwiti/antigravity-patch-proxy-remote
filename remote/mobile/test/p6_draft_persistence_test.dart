import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/chat_input_bar.dart';

void main() {
  group('P6 — brouillon persisté (ChatInputBar)', () {
    testWidgets('initialText est chargé dans le champ', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatInputBar(
              onSend: (_, {queued = false, modelUID, modelEnum, images, base64Data, fileName, media}) {},
              initialText: 'brouillon persisté',
            ),
          ),
        ),
      );
      expect(find.text('brouillon persisté'), findsOneWidget);
    });

    testWidgets('chaque frappe notifie le parent (onDraftChanged)',
        (tester) async {
      String? lastDraft;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatInputBar(
              onSend: (_, {queued = false, modelUID, modelEnum, images, base64Data, fileName, media}) {},
              onDraftChanged: (d) => lastDraft = d,
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pump();
      expect(lastDraft, 'hello');
    });

    testWidgets('envoi purge le brouillon (onDraftChanged(""))',
        (tester) async {
      String? lastDraft;
      var sent = '';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatInputBar(
              onSend: (m, {queued = false, modelUID, modelEnum, images, base64Data, fileName, media}) => sent = m,
              onDraftChanged: (d) => lastDraft = d,
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), 'message');
      await tester.pump();
      expect(lastDraft, 'message');
      await tester.tap(find.byKey(const Key('send-message-button')));
      await tester.pump();
      expect(sent, 'message');
      expect(lastDraft, '');
      // Laisse expirer le verrou d'envoi de 300 ms (timer encore pendant).
      await tester.pump(const Duration(milliseconds: 400));
    });
  });
}
