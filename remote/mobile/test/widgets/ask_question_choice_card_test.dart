import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/ask_question_choice_card.dart';

void main() {
  testWidgets('AskQuestionChoiceCard allows selecting option and submits', (tester) async {
    List<String>? submittedSelected;
    String? submittedCustom;

    final testRequest = AskQuestionChoiceRequest(
      requestId: 'call_123',
      question: 'Which database do you prefer?',
      options: const ['PostgreSQL', 'SQLite', 'MongoDB'],
      isMultiSelect: false,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AskQuestionChoiceCard(
            request: testRequest,
            onSubmit: (List<String> selected, String? custom) {
              submittedSelected = selected;
              submittedCustom = custom;
            },
          ),
        ),
      ),
    );

    expect(find.text('Which database do you prefer?'), findsOneWidget);
    expect(find.text('PostgreSQL'), findsOneWidget);
    expect(find.text('SQLite'), findsOneWidget);

    await tester.tap(find.text('PostgreSQL'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Submit Choice'));
    await tester.pumpAndSettle();

    expect(submittedSelected, isNotNull);
    expect(submittedSelected, contains('PostgreSQL'));
    expect(submittedCustom, isNull);
  });
}
