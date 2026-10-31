import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/chat_stream/widgets/revert_step_preview_dialog.dart';

void main() {
  group('RevertStepPreviewDialog widget tests', () {
    testWidgets('renders dialog with step title, description and cancel button', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: RevertStepPreviewDialog(
              api: null,
              cascadeId: 'cascade-123',
              stepIndex: 2,
              stepDescription: 'donner un plan pour corrige all',
            ),
          ),
        ),
      );

      expect(find.text('Revenir à cette étape'), findsOneWidget);
      expect(find.textContaining('Étape #3 • donner un plan pour corrige all'), findsOneWidget);
      expect(find.textContaining('Toutes les actions'), findsOneWidget);
      expect(find.text('Annuler'), findsOneWidget);
      expect(find.text('Confirmer le rollback'), findsOneWidget);
    });

    testWidgets('cancels dialog when close icon or Annuler is tapped', (tester) async {
      bool? dialogResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () async {
                  dialogResult = await RevertStepPreviewDialog.show(
                    context,
                    api: null,
                    cascadeId: 'casc-1',
                    stepIndex: 1,
                    stepDescription: 'test rollback',
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Revenir à cette étape'), findsOneWidget);

      await tester.tap(find.text('Annuler'));
      await tester.pumpAndSettle();

      expect(find.text('Revenir à cette étape'), findsNothing);
      expect(dialogResult, isFalse);
    });
  });

  group('ChatMessage stepIndex serialization tests', () {
    test('serializes and deserializes stepIndex properly', () {
      const msg = ChatMessage(
        id: 'user-1',
        sender: 'user',
        text: 'hello',
        timestamp: '16:44',
        stepIndex: 5,
      );

      final json = msg.toJson();
      expect(json['stepIndex'], 5);

      final deserialized = ChatMessage.fromJson(json);
      expect(deserialized.stepIndex, 5);
      expect(deserialized.text, 'hello');
      expect(deserialized.timestamp, '16:44');
    });
  });
}
