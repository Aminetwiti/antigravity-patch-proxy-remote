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
  static const int _maxSessionsInMemory = 30;
  static const int _offloadThresholdChars = 20000;

  static String encodeHistoryJson(List<ChatMessage> messages) =>
      jsonEncode(messages.map((m) => m.toJson()).toList());

  static List<ChatMessage> decodeHistoryJson(String raw) {
    final list = jsonDecode(raw);
    if (list is! List) return const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(ChatMessage.fromJson)
        .toList();
  }

  SessionHistoryCacheStore._();
  static final SessionHistoryCacheStore instance = SessionHistoryCacheStore._();

  /// In-memory fast cache (0ms instant lookup without waiting for disk)
  final Map<String, List<ChatMessage>> _memCache = {};

  void _touchInMemory(String sessionId, List<ChatMessage> messages) {
    _memCache.remove(sessionId);
    while (_memCache.length >= _maxSessionsInMemory) {
      _memCache.remove(_memCache.keys.first);
    }
    _memCache[sessionId] = messages;
  }

  /// Loads cached messages for a session. Returns immediately from memory or SharedPreferences.
  Future<List<ChatMessage>> loadSessionHistory(String sessionId) async {
    if (sessionId.isEmpty) return const [];

    final inMem = _memCache.remove(sessionId);
    if (inMem != null && inMem.isNotEmpty) {
      _memCache[sessionId] = inMem;
      return List.unmodifiable(inMem);
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_prefix$sessionId');
      if (raw == null || raw.isEmpty) return const [];

      final parsed = raw.length >= _offloadThresholdChars
          ? await compute(decodeHistoryJson, raw)
          : decodeHistoryJson(raw);

      _touchInMemory(sessionId, parsed);
      return List.unmodifiable(parsed);
    } catch (e) {
      debugPrint('[SessionHistoryCacheStore] Failed to load cached history for $sessionId: $e');
      return const [];
    }
  }

  /// Synchronously returns currently loaded in-memory cached messages for 0ms frame render.
  List<ChatMessage>? getInMemory(String sessionId) {
    if (sessionId.isEmpty) return null;
    final inMem = _memCache.remove(sessionId);
    if (inMem != null) {
      _memCache[sessionId] = inMem;
      return inMem;
    }
    return null;
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

    _touchInMemory(sessionId, toPersist);

    try {
      final prefs = await SharedPreferences.getInstance();
      final estimated =
          toPersist.fold<int>(0, (acc, m) => acc + m.text.length + 64);
      final encoded = estimated >= _offloadThresholdChars
          ? await compute(encodeHistoryJson, toPersist)
          : encodeHistoryJson(toPersist);
      await prefs.setString('$_prefix$sessionId', encoded);
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
