import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/websocket_client.dart';

void main() {
  group('DaemonWebSocketClient.backoffDelay', () {
    test('escalade exponentielle avec plafond à 30s', () {
      expect(DaemonWebSocketClient.backoffDelay(0), const Duration(seconds: 2));
      expect(DaemonWebSocketClient.backoffDelay(1), const Duration(seconds: 4));
      expect(DaemonWebSocketClient.backoffDelay(2), const Duration(seconds: 8));
      expect(DaemonWebSocketClient.backoffDelay(3), const Duration(seconds: 16));
      expect(DaemonWebSocketClient.backoffDelay(4), const Duration(seconds: 30));
      expect(DaemonWebSocketClient.backoffDelay(9), const Duration(seconds: 30));
    });
  });
}
