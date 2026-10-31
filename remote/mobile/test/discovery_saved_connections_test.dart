import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/discovery/lan_discovery.dart';
import 'package:mobile/features/discovery/discovery_screen.dart';
import 'package:mobile/services/saved_connections_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    LanDiscoveryService.enabled = false;
  });

  tearDown(() {
    LanDiscoveryService.enabled = true;
  });

  group('DiscoveryScreen Saved Connections & PIN/Token Persistence', () {
    testWidgets('affiche les dernières connexions sauvegardées avec PIN et Token', (tester) async {
      final conn1 = SavedConnection(
        id: '192.168.1.42:8090',
        label: 'PC Chambre',
        host: '192.168.1.42',
        port: 8090,
        authToken: 'secret-token-1',
        pin: '123456',
        wsUrl: 'ws://192.168.1.42:8090/ws',
        lastConnectedAt: DateTime.now(),
      );
      await SavedConnectionsStore.saveConnection(conn1);

      String? connectedHost;
      int? connectedPort;
      String? connectedToken;

      await tester.pumpWidget(
        MaterialApp(
          home: DiscoveryScreen(
            onConnect: (host, port, token) async {
              connectedHost = host;
              connectedPort = port;
              connectedToken = token;
              return true;
            },
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 200));

      // Vérifie que la section des connexions sauvegardées est affichée
      expect(find.text('DERNIÈRES CONNEXIONS SAUVEGARDÉES'), findsOneWidget);
      expect(find.text('PC Chambre'), findsOneWidget);
      expect(find.textContaining('192.168.1.42:8090'), findsWidgets);
      expect(find.textContaining('🔑 Token'), findsOneWidget);

      // Vérifie que les champs ont été pré-remplis
      expect(find.text('192.168.1.42'), findsWidgets);
      expect(find.text('8090'), findsWidgets);

      // Test 1-Tap Reconnect
      final tapBtn = find.byKey(const Key('btn-connect-192.168.1.42:8090'));
      expect(tapBtn, findsOneWidget);
      await tester.tap(tapBtn);
      await tester.pump(const Duration(milliseconds: 1500));

      expect(connectedHost, '192.168.1.42');
      expect(connectedPort, 8090);
      expect(connectedToken, 'secret-token-1');

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('permet de supprimer une connexion mémorisée', (tester) async {
      final conn1 = SavedConnection(
        id: '10.0.0.5:8090',
        label: 'PC Portable',
        host: '10.0.0.5',
        port: 8090,
        authToken: 'token-laptop',
        pin: '987654',
        wsUrl: 'ws://10.0.0.5:8090/ws',
        lastConnectedAt: DateTime.now(),
      );
      await SavedConnectionsStore.saveConnection(conn1);

      await tester.pumpWidget(
        const MaterialApp(
          home: DiscoveryScreen(),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));

      expect(find.text('PC Portable'), findsOneWidget);

      // Tap bouton supprimer
      final deleteBtn = find.byKey(const Key('btn-delete-10.0.0.5:8090'));
      expect(deleteBtn, findsOneWidget);
      await tester.tap(deleteBtn);
      await tester.pump(const Duration(milliseconds: 200));

      // La connexion n'apparaît plus
      expect(find.text('PC Portable'), findsNothing);
      expect(await SavedConnectionsStore.getSavedConnections(), isEmpty);

      await tester.pumpWidget(const SizedBox());
    });
  });
}
