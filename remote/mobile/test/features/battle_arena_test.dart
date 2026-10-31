import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/battle_arena/battle_arena_screen.dart';

void main() {
  testWidgets('BattleArenaScreen renders initial duel configuration', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (_) {},
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: BattleArenaScreen(
          api: api,
          workspaceUri: 'file:///workspace',
        ),
      ),
    );

    expect(find.text('Colosseum Battle Arena ⚔️'), findsOneWidget);
    expect(find.text('Arm A (Modèle 1)'), findsOneWidget);
    expect(find.text('Arm B (Modèle 2)'), findsOneWidget);
    expect(find.text('Lancer le Duel Multi-Modèles'), findsOneWidget);
  });

  testWidgets('BattleArenaScreen allows entering prompt', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (_) {},
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: BattleArenaScreen(
          api: api,
          workspaceUri: 'file:///workspace',
        ),
      ),
    );

    final input = find.byType(TextField);
    expect(input, findsOneWidget);
    await tester.enterText(input, 'Écrire un parser JSON en Rust');
    expect(find.text('Écrire un parser JSON en Rust'), findsOneWidget);
  });
}
