import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Antigravity Remote App smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const AntigravityRemoteApp());
    // Laisse l'auto-connexion (postFrameCallback) se lancer puis échouer
    // (pas de daemon en test) — la panne déclenche le banner + le backoff.
    await tester.pump();

    // Verify main screen renders
    expect(find.byType(AntigravityMainScreen), findsOneWidget);

    // Unmount : dispose() du State annule les timers de reconnexion du WS,
    // sinon la vérification « no pending timers » du binding échoue.
    await tester.pumpWidget(const SizedBox());
  });
}
