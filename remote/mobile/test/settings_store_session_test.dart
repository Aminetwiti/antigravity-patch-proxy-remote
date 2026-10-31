import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/services/saved_connections_store.dart';
import 'package:mobile/services/secure_credentials.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SecureCredentials.testValues = {};
  });

  group('SettingsStore & SavedConnectionsStore Persistence', () {
    test('round-trip save/load session avec token et PIN', () async {
      final before = await SettingsStore.loadSession();
      expect(before, isEmpty);

      await SettingsStore.saveSession(
        wsUrl: 'wss://abc.trycloudflare.com/ws',
        token: 'tok-123',
        pin: '654321',
        host: 'abc.trycloudflare.com',
        port: 443,
        sessionId: 'sess-1',
      );
      final after = await SettingsStore.loadSession();
      expect(after['wsUrl'], 'wss://abc.trycloudflare.com/ws');
      expect(after['token'], 'tok-123');
      expect(after['pin'], '654321');
      expect(after['host'], 'abc.trycloudflare.com');
      expect(after['port'], 443);
      expect(after['sessionId'], 'sess-1');
      expect(after['savedAt'], isA<DateTime>());
    });

    test('la session persiste indéfiniment même après fermeture/réouverture (> 24 h)', () async {
      SharedPreferences.setMockInitialValues({
        'session.lastWsUrl': 'ws://192.168.1.50:8090/ws',
        'session.lastWsToken': 'tok-persist',
        'session.lastPin': '123456',
        'session.lastHost': '192.168.1.50',
        'session.lastPort': 8090,
        'session.lastSessionId': 'sess-persist',
        'session.savedAt':
            DateTime.now().subtract(const Duration(days: 5)).toIso8601String(),
      });
      final s = await SettingsStore.loadSession();
      expect(s['wsUrl'], 'ws://192.168.1.50:8090/ws');
      expect(s['token'], 'tok-persist');
      expect(s['pin'], '123456');
      expect(s['host'], '192.168.1.50');
      expect(s['port'], 8090);
    });

    test('clearSession efface la session sans corrompre les réglages généraux', () async {
      SharedPreferences.setMockInitialValues({});
      await SettingsStore.saveSession(
        wsUrl: 'wss://x/ws',
        token: 't',
        pin: '999999',
        sessionId: 's',
      );
      await SettingsStore.clearSession();
      final s = await SettingsStore.loadSession();
      expect(s, isEmpty);
    });

    test('SavedConnectionsStore mémorise la liste des connexions récentes et permet 1-Tap', () async {
      SharedPreferences.setMockInitialValues({});
      expect(await SavedConnectionsStore.getSavedConnections(), isEmpty);

      // Enregistre 2 connexions
      final conn1 = SavedConnection(
        id: '192.168.1.10:8090',
        label: 'PC Bureau',
        host: '192.168.1.10',
        port: 8090,
        authToken: 'token-pc-1',
        pin: '111111',
        wsUrl: 'ws://192.168.1.10:8090/ws',
        lastConnectedAt: DateTime.now().subtract(const Duration(minutes: 10)),
      );

      final conn2 = SavedConnection(
        id: 'tunnel.trycloudflare.com:443',
        label: 'Tunnel Cloudflare',
        host: 'tunnel.trycloudflare.com',
        port: 443,
        ssl: true,
        authToken: 'token-tunnel-2',
        pin: '222222',
        wsUrl: 'wss://tunnel.trycloudflare.com/ws',
        lastConnectedAt: DateTime.now(),
      );

      await SavedConnectionsStore.saveConnection(conn1);
      await SavedConnectionsStore.saveConnection(conn2);

      final list = await SavedConnectionsStore.getSavedConnections();
      expect(list.length, 2);
      expect(list.first.label, 'Tunnel Cloudflare'); // Le plus récent en premier
      expect(list.first.pin, ''); // PIN non persisté par sécurité
      expect(list.first.authToken, 'token-tunnel-2');

      final last = await SavedConnectionsStore.getLastConnection();
      expect(last?.host, 'tunnel.trycloudflare.com');

      // Suppression d'une connexion
      await SavedConnectionsStore.removeConnection(conn1.id);
      final remaining = await SavedConnectionsStore.getSavedConnections();
      expect(remaining.length, 1);
      expect(remaining.first.id, conn2.id);
    });

    test('autoFollowEnabled default is true and persists', () async {
      SharedPreferences.setMockInitialValues({});
      final defaults = await SettingsStore.load();
      expect(defaults['autoFollowEnabled'], isTrue);

      await SettingsStore.save({'autoFollowEnabled': false});
      final updated = await SettingsStore.load();
      expect(updated['autoFollowEnabled'], isFalse);
    });
  });
}
