import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/workspace/git_commit_dialog.dart';

void main() {
  testWidgets('GitCommitDialog génère un message IA et valide le commit',
      (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String
            ? jsonDecode(d) as Map<String, dynamic>
            : Map<String, dynamic>.from(d as Map);
        if (map['type'] == 'generate_commit_message') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'data': {'commitMessage': 'feat: ajouter la nouvelle fonctionnalité'},
          }));
        }
      },
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    String? committed;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  committed = await GitCommitDialog.show(
                    context,
                    api: api,
                    workspacePath: '.',
                  );
                },
                child: const Text('Ouvrir'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Ouvrir'));
    await tester.pumpAndSettle();

    expect(find.text('Créer un commit Git'), findsOneWidget);

    await tester.tap(find.text('Générer avec l\'IA'));
    await tester.pumpAndSettle();

    // Le hint contient aussi "feat: ..." — on cible la valeur du champ.
    final field = tester.widget<EditableText>(
      find.byType(EditableText).first,
    );
    expect(
      field.controller.text,
      'feat: ajouter la nouvelle fonctionnalité',
    );

    await tester.tap(find.text('Valider le Commit'));
    await tester.pumpAndSettle();

    expect(committed, 'feat: ajouter la nouvelle fonctionnalité');
  });
}
