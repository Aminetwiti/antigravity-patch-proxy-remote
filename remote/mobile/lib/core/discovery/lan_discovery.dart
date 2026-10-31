import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Représente un serveur Daemon Antigravity découvert sur le réseau local via UDP Beacon.
class DiscoveredDaemon {
  final String hostname;
  final String host;
  final int port;
  final String authToken;
  final String? publicUrl;
  final List<String> workspaces;
  final DateTime lastSeen;

  const DiscoveredDaemon({
    required this.hostname,
    required this.host,
    required this.port,
    required this.authToken,
    this.publicUrl,
    this.workspaces = const [],
    required this.lastSeen,
  });

  String get displayName => hostname.isNotEmpty ? hostname : host;
  String get formattedAddress => '$host:$port';
}

/// Service de découverte Zero-Config UDP sur le sous-réseau Wi-Fi local.
class LanDiscoveryService {
  static const int discoveryPort = 41234;
  static const String magic = 'antigravity-remote';
  static bool enabled = true;

  RawDatagramSocket? _socket;
  final StreamController<List<DiscoveredDaemon>> _daemonsController =
      StreamController<List<DiscoveredDaemon>>.broadcast();

  final Map<String, DiscoveredDaemon> _discovered = {};
  Timer? _cleanupTimer;
  Timer? _probeTimer;
  bool _isSearching = false;

  bool get isSearching => _isSearching;
  Stream<List<DiscoveredDaemon>> get daemonsStream => _daemonsController.stream;
  List<DiscoveredDaemon> get currentDaemons => _discovered.values.toList();

  Future<void> startDiscovery() async {
    stopDiscovery();
    if (!enabled) return;
    _isSearching = true;

    try {
      _socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        0,
        reuseAddress: true,
      );
      _socket?.broadcastEnabled = true;

      _socket?.listen((event) {
        if (event == RawSocketEvent.read) {
          final dg = _socket?.receive();
          if (dg != null) {
            _handleDatagram(dg);
          }
        }
      });

      // Envoi du premier ping de sonde immédiat
      _sendProbe();

      // Sonde répétée toutes les 2.5 secondes
      _probeTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) {
        _sendProbe();
      });

      // Nettoyage des daemons hors-ligne non détectés depuis > 8s
      _cleanupTimer = Timer.periodic(const Duration(seconds: 4), (_) {
        final now = DateTime.now();
        final before = _discovered.length;
        _discovered.removeWhere(
          (k, v) => now.difference(v.lastSeen).inSeconds > 8,
        );
        if (_discovered.length != before) {
          _daemonsController.add(_discovered.values.toList());
        }
      });
    } catch (_) {}
  }

  void _sendProbe() {
    try {
      final probe = jsonEncode({'type': 'discover'});
      final data = utf8.encode(probe);
      _socket?.send(
        data,
        InternetAddress('255.255.255.255'),
        discoveryPort,
      );
    } catch (_) {}
  }

  void _handleDatagram(Datagram dg) {
    try {
      final text = utf8.decode(dg.data);
      final json = jsonDecode(text) as Map<String, dynamic>;

      if (json['magic'] != magic) return;

      final hostname = json['hostname']?.toString() ?? 'PC Antigravity';
      final port = (json['port'] as num?)?.toInt() ?? 8090;
      final token = json['authToken']?.toString() ?? '';
      final pubUrl = json['publicUrl']?.toString();
      final wsList = (json['workspaces'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [];

      final hostIp = dg.address.address;
      final key = '$hostIp:$port';

      final daemon = DiscoveredDaemon(
        hostname: hostname,
        host: hostIp,
        port: port,
        authToken: token,
        publicUrl: pubUrl,
        workspaces: wsList,
        lastSeen: DateTime.now(),
      );

      _discovered[key] = daemon;
      _daemonsController.add(_discovered.values.toList());
    } catch (_) {}
  }

  void stopDiscovery() {
    _isSearching = false;
    _probeTimer?.cancel();
    _cleanupTimer?.cancel();
    _socket?.close();
    _socket = null;
  }

  void dispose() {
    stopDiscovery();
    _daemonsController.close();
  }
}
