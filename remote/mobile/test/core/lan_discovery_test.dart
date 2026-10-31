import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/discovery/lan_discovery.dart';

void main() {
  group('LanDiscoveryService Unit Tests', () {
    test('DiscoveredDaemon getters formatting', () {
      final now = DateTime.now();
      final daemon = DiscoveredDaemon(
        hostname: 'DESKTOP-DEV',
        host: '192.168.1.50',
        port: 8090,
        authToken: 'secret-123',
        workspaces: const ['antigravity-add-model-main', 'pos'],
        lastSeen: now,
      );

      expect(daemon.displayName, 'DESKTOP-DEV');
      expect(daemon.formattedAddress, '192.168.1.50:8090');
      expect(daemon.workspaces.length, 2);
    });

    test('LanDiscoveryService start and stop lifecycle', () async {
      final service = LanDiscoveryService();
      expect(service.isSearching, isFalse);

      await service.startDiscovery();
      expect(service.isSearching, isTrue);

      service.stopDiscovery();
      expect(service.isSearching, isFalse);

      service.dispose();
    });
  });
}
