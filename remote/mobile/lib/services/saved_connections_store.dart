import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import 'secure_credentials.dart';

/// Modèle d'une connexion sauvegardée persistée sur l'appareil.
class SavedConnection {
  final String id;
  final String label;
  final String host;
  final int port;
  final bool ssl;
  final String authToken;
  final String pin;
  final String wsUrl;
  final DateTime lastConnectedAt;
  final String? deviceName;

  const SavedConnection({
    required this.id,
    required this.label,
    required this.host,
    required this.port,
    this.ssl = false,
    this.authToken = '',
    this.pin = '',
    this.wsUrl = '',
    required this.lastConnectedAt,
    this.deviceName,
  });

  /// toJson persiste dans SharedPreferences : SEC-04 — authToken et pin ne
  /// sont volontairement PAS sérialisés (stockage sécurisé par id, cf.
  /// SavedConnectionsStore._secretKeys).
  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'host': host,
        'port': port,
        'ssl': ssl,
        'wsUrl': wsUrl,
        'lastConnectedAt': lastConnectedAt.toIso8601String(),
        if (deviceName != null) 'deviceName': deviceName,
      };

  factory SavedConnection.fromJson(Map<String, dynamic> json) {
    final host = json['host'] as String? ?? '127.0.0.1';
    final port = (json['port'] as num?)?.toInt() ?? 8090;
    final id = json['id'] as String? ?? '$host:$port';
    final label = json['label'] as String? ?? (host.isNotEmpty ? host : 'Daemon');
    // Compat : les versions antérieures au correctif SEC-04 sérialisaient le
    // token dans le JSON — on l'accepte en lecture pour migration, il est
    // ré-écrit dans le coffre puis retiré du JSON à la prochaine sauvegarde.
    final legacyToken =
        json['authToken'] as String? ?? json['token'] as String? ?? '';
    final legacyPin = json['pin'] as String? ?? '';
    return SavedConnection(
      id: id,
      label: label,
      host: host,
      port: port,
      ssl: json['ssl'] as bool? ?? false,
      authToken: legacyToken,
      pin: legacyPin,
      wsUrl: json['wsUrl'] as String? ?? '',
      lastConnectedAt: DateTime.tryParse(json['lastConnectedAt'] as String? ?? '') ?? DateTime.now(),
      deviceName: json['deviceName'] as String?,
    );
  }

  SavedConnection copyWith({
    String? id,
    String? label,
    String? host,
    int? port,
    bool? ssl,
    String? authToken,
    String? pin,
    String? wsUrl,
    DateTime? lastConnectedAt,
    String? deviceName,
  }) {
    return SavedConnection(
      id: id ?? this.id,
      label: label ?? this.label,
      host: host ?? this.host,
      port: port ?? this.port,
      ssl: ssl ?? this.ssl,
      authToken: authToken ?? this.authToken,
      pin: pin ?? this.pin,
      wsUrl: wsUrl ?? this.wsUrl,
      lastConnectedAt: lastConnectedAt ?? this.lastConnectedAt,
      deviceName: deviceName ?? this.deviceName,
    );
  }
}

/// Gestionnaire de persistance pour l'historique des connexions sauvegardées.
/// Stocke la liste dans `SharedPreferences` sous forme de JSON sérialisé.
/// SEC-04 : les secrets (authToken, pin) vivent dans SecureCredentials sous
/// les clés `conn.<id>.token` / `conn.<id>.pin` — jamais dans le JSON.
class SavedConnectionsStore {
  static const _kKey = 'saved_connections.list';
  static const int _kMaxHistory = 10;

  static String _tokenKey(String id) => 'conn.$id.token';
  static String _pinKey(String id) => 'conn.$id.pin';

  SavedConnectionsStore._();

  /// Récupère la liste de toutes les connexions mémorisées, triées de la plus récente à la plus ancienne.
  static Future<List<SavedConnection>> getSavedConnections() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      if (raw == null || raw.isEmpty) return [];
      final list = jsonDecode(raw) as List?;
      if (list == null) return [];
      final connections = <SavedConnection>[];
      for (final m in (list).whereType<Map<String, dynamic>>()) {
        var conn = SavedConnection.fromJson(m);
        // Migration SEC-04 : token hérité du JSON → coffre, puis purge du JSON.
        if (conn.authToken.isNotEmpty) {
          await SecureCredentials.write(_tokenKey(conn.id), conn.authToken);
        }
        final token = await SecureCredentials.read(_tokenKey(conn.id)) ?? '';
        conn = conn.copyWith(authToken: token, pin: '');
        connections.add(conn);
      }
      connections.sort((a, b) => b.lastConnectedAt.compareTo(a.lastConnectedAt));
      return connections;
    } catch (_) {
      return [];
    }
  }

  /// Sauvegarde ou met à jour une connexion dans l'historique persistant.
  static Future<void> saveConnection(SavedConnection connection) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final current = await getSavedConnections();
      final index = current.indexWhere((c) =>
          c.id == connection.id ||
          (c.host == connection.host && c.port == connection.port && connection.host.isNotEmpty) ||
          (c.wsUrl.isNotEmpty && c.wsUrl == connection.wsUrl));

      if (index >= 0) {
        current[index] = connection.copyWith(
          authToken: connection.authToken.isNotEmpty ? connection.authToken : current[index].authToken,
          pin: '',
          wsUrl: connection.wsUrl.isNotEmpty ? connection.wsUrl : current[index].wsUrl,
          label: connection.label.isNotEmpty ? connection.label : current[index].label,
          lastConnectedAt: DateTime.now(),
        );
      } else {
        current.insert(0, connection.copyWith(pin: ''));
      }

      // Secrets par id dans le coffre (SEC-04) — jamais dans le JSON prefs.
      for (final c in current) {
        if (c.authToken.isNotEmpty) {
          await SecureCredentials.write(_tokenKey(c.id), c.authToken);
        }
      }

      current.sort((a, b) => b.lastConnectedAt.compareTo(a.lastConnectedAt));
      if (current.length > _kMaxHistory) {
        current.removeRange(_kMaxHistory, current.length);
      }

      await prefs.setString(_kKey, jsonEncode(current.map((c) => c.toJson()).toList()));
    } catch (_) {}
  }

  /// Supprime une connexion sauvegardée par son identifiant.
  static Future<void> removeConnection(String id) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final current = await getSavedConnections();
      current.removeWhere((c) => c.id == id);
      await prefs.setString(_kKey, jsonEncode(current.map((c) => c.toJson()).toList()));
      await SecureCredentials.delete(_tokenKey(id));
      await SecureCredentials.delete(_pinKey(id));
    } catch (_) {}
  }

  /// Récupère la dernière connexion réussie.
  static Future<SavedConnection?> getLastConnection() async {
    final list = await getSavedConnections();
    return list.isNotEmpty ? list.first : null;
  }

  /// Efface tout l'historique de connexions.
  static Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kKey);
    } catch (_) {}
  }
}
