import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/protocol/messages.dart';

/// Instant 0ms offline history cache for Antigravity Remote sessions.
/// Persists the most recent messages per session into SharedPreferences
/// so session switching and app boot load immediately with 0ms latency.
class SessionHistoryCacheStore {
  static const String _prefix = 'session_history_cache_';
  static const int _maxMessagesPerSession = 80;

  SessionHistoryCacheStore._();
  static final SessionHistoryCacheStore instance = SessionHistoryCacheStore._();

  /// In-memory fast cache (0ms instant lookup without waiting for disk)
  final Map<String, List<ChatMessage>> _memCache = {};

  /// Loads cached messages for a session. Returns immediately from memory or SharedPreferences.
  Future<List<ChatMessage>> loadSessionHistory(String sessionId) async {
    if (sessionId.isEmpty) return const [];

    if (_memCache.containsKey(sessionId) && _memCache[sessionId]!.isNotEmpty) {
      return List.unmodifiable(_memCache[sessionId]!);
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_prefix$sessionId');
      if (raw == null || raw.isEmpty) return const [];

      final list = jsonDecode(raw) as List?;
      if (list == null) return const [];

      final parsed = list
          .whereType<Map<String, dynamic>>()
          .map((m) => ChatMessage.fromJson(m))
          .toList();

      _memCache[sessionId] = parsed;
      return List.unmodifiable(parsed);
    } catch (e) {
      debugPrint('[SessionHistoryCacheStore] Failed to load cached history for $sessionId: $e');
      return const [];
    }
  }

  /// Synchronously returns currently loaded in-memory cached messages for 0ms frame render.
  List<ChatMessage>? getInMemory(String sessionId) {
    if (sessionId.isEmpty) return null;
    return _memCache[sessionId];
  }

  /// Saves a session's messages into local persistent cache.
  Future<void> saveSessionHistory(String sessionId, List<ChatMessage> messages) async {
    if (sessionId.isEmpty || messages.isEmpty) return;

    // Filter out active streaming/transient bubbles before persisting
    final toPersist = messages
        .where((m) => !m.isStreaming || m.text.trim().isNotEmpty)
        .map((m) => m.copyWith(isStreaming: false))
        .toList();

    if (toPersist.length > _maxMessagesPerSession) {
      toPersist.removeRange(0, toPersist.length - _maxMessagesPerSession);
    }

    _memCache[sessionId] = toPersist;

    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonList = toPersist.map((m) => m.toJson()).toList();
      await prefs.setString('$_prefix$sessionId', jsonEncode(jsonList));
    } catch (e) {
      debugPrint('[SessionHistoryCacheStore] Failed to save cached history for $sessionId: $e');
    }
  }

  /// Removes cached history for a deleted session.
  Future<void> removeSessionHistory(String sessionId) async {
    _memCache.remove(sessionId);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('$_prefix$sessionId');
    } catch (_) {}
  }

  /// Clears in-memory cache (for unit testing).
  @visibleForTesting
  void clearMemory() {
    _memCache.clear();
  }
}
