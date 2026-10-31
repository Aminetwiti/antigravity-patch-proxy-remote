import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Service de persistance de la file d'attente hors-ligne (Offline Outbox).
/// Sauvegarde et restaure les messages en attente en cas de déconnexion réseau.
class OfflineOutboxStore {
  static const String _prefix = 'offline_outbox_';

  static String _key(String cascadeId) => '$_prefix$cascadeId';

  /// Sauvegarde les messages en attente pour une session donnée.
  static Future<void> saveQueuedMessages(
    String cascadeId,
    List<Map<String, dynamic>> messages,
  ) async {
    if (cascadeId.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    if (messages.isEmpty) {
      await prefs.remove(_key(cascadeId));
    } else {
      final jsonStr = jsonEncode(messages);
      await prefs.setString(_key(cascadeId), jsonStr);
    }
  }

  /// Charge les messages en attente pour une session.
  static Future<List<Map<String, dynamic>>> loadQueuedMessages(
    String cascadeId,
  ) async {
    if (cascadeId.isEmpty) return [];
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = prefs.getString(_key(cascadeId));
    if (jsonStr == null || jsonStr.isEmpty) return [];
    try {
      final decoded = jsonDecode(jsonStr);
      if (decoded is List) {
        return decoded
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  /// Nettoie la file d'attente d'une session.
  static Future<void> clearQueuedMessages(String cascadeId) async {
    if (cascadeId.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key(cascadeId));
  }
}
