import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/websocket_client.dart';
import 'package:mobile/widgets/connection_banner.dart';

void main() {
  group('ConnectionBanner (UX perte/reprise de connexion)', () {
    testWidgets('ne s\'affiche pas quand on est connecté', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectionBanner(
              status: ConnectionStatus.connected,
              attempt: 0,
              nextRetryIn: Duration.zero,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Connexion perdue'), findsNothing);
      expect(find.text('Reconnexion en cours…'), findsNothing);
    });

    testWidgets('affiche « Connexion perdue » + tentative + compte à rebours',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectionBanner(
              status: ConnectionStatus.disconnected,
              attempt: 2,
              nextRetryIn: const Duration(seconds: 8),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Connexion perdue'), findsOneWidget);
      expect(find.text('Tentative 2 · prochaine dans 8s'), findsOneWidget);
      // Le bouton Réessayer n'est rendu que si onRetry est fourni.
      expect(find.text('Réessayer'), findsNothing);
    });

    testWidgets('affiche état Reconnexion en cours avec spinner',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectionBanner(
              status: ConnectionStatus.connecting,
              attempt: 3,
              nextRetryIn: Duration.zero,
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Reconnexion en cours…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('mode hors-ligne manuel : pas de bouton Réessayer',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectionBanner(
              status: ConnectionStatus.disconnected,
              attempt: 0,
              nextRetryIn: Duration.zero,
              isManualDisconnect: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Déconnecté (mode hors-ligne)'), findsOneWidget);
      expect(find.text('Réessayer'), findsNothing);
    });

    testWidgets('le bouton Réessayer déclenche onRetry', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConnectionBanner(
              status: ConnectionStatus.disconnected,
              attempt: 1,
              nextRetryIn: const Duration(seconds: 4),
              onRetry: () => retried = true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Réessayer'));
      await tester.pumpAndSettle();
      expect(retried, isTrue);
    });

    testWidgets('Masquer replie le banner, réapparaît à la prochaine panne',
        (tester) async {
      Widget build(ConnectionStatus status) => MaterialApp(
            home: Scaffold(
              body: ConnectionBanner(
                status: status,
                attempt: 1,
                nextRetryIn: const Duration(seconds: 4),
              ),
            ),
          );

      await tester.pumpWidget(build(ConnectionStatus.disconnected));
      await tester.pumpAndSettle();
      expect(find.text('Connexion perdue'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.close));
      // L'AnimatedSize se replie : pump 3 frames pour finir l'animation sans
      // attendre l'infini (le spinner de la panne suivante re-anime).
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Connexion perdue'), findsNothing);

      // Repasse en ligne puis re-coupe → le banner revient (nouvelle session).
      await tester.pumpWidget(build(ConnectionStatus.connected));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpWidget(build(ConnectionStatus.disconnected));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Connexion perdue'), findsOneWidget);
    });
  });
}
