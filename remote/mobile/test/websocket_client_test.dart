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

  group('DaemonWebSocketClient.formatWsUrl', () {
    test('normalise domaine HTTPS avec port 8090 laissé par défaut vers WSS sans port', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('https://dqlwdgordp4apddvek8gvgn0.ty-dev.site', 8090),
        'wss://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws',
      );
    });

    test('normalise domaine HTTPS avec port 443 explicite vers WSS sans :443', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('https://dqlwdgordp4apddvek8gvgn0.ty-dev.site', 443),
        'wss://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws',
      );
    });

    test('normalise domaine nu sans schéma vers WSS sans port', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('dqlwdgordp4apddvek8gvgn0.ty-dev.site', 8090),
        'wss://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws',
      );
    });

    test('retire les slashs de fin et /ws en trop', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('https://dqlwdgordp4apddvek8gvgn0.ty-dev.site/'),
        'wss://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('https://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws'),
        'wss://dqlwdgordp4apddvek8gvgn0.ty-dev.site/ws',
      );
    });

    test('préserve ws:// et le port pour les adresses IP locales LAN', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('192.168.1.50', 8090),
        'ws://192.168.1.50:8090/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('127.0.0.1', 8090),
        'ws://127.0.0.1:8090/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('127.0.0.1:8090'),
        'ws://127.0.0.1:8090/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('http://192.168.1.100:8080'),
        'ws://192.168.1.100:8080/ws',
      );
    });

    test('gère les tunnels Cloudflare et Pinggy', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('https://formula.trycloudflare.com', 8090),
        'wss://formula.trycloudflare.com/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('pinggy.io:443'),
        'wss://pinggy.io/ws',
      );
    });

    test('gère les ports personnalisés non-standards sur domaine distant', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('https://my-vps.com:8443'),
        'wss://my-vps.com:8443/ws',
      );
      expect(
        DaemonWebSocketClient.formatWsUrl('my-vps.com:9000'),
        'wss://my-vps.com:9000/ws',
      );
    });

    test('préserve les paramètres de requête si présents', () {
      expect(
        DaemonWebSocketClient.formatWsUrl('ws://127.0.0.1:8090/ws?token=test123'),
        'ws://127.0.0.1:8090/ws?token=test123',
      );
    });
  });
}
