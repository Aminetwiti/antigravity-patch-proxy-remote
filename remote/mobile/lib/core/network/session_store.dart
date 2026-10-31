import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../protocol/messages.dart';

/// Persists the last known daemon endpoint (host/port/token) and the session
/// list, so the app reconnects instantly and shows sessions while offline.
///
/// ponytail: `dart:io` File + JSON — zero external dependencies. This is a
/// single small JSON document (tens of KB max); no sqlite needed.
class SessionStore {
  SessionStore({String? path}) : _path = path ?? _defaultPath();

  final String _path;
  File? _cache;

  static String _defaultPath() {
    final dir = Directory.systemTemp.createTempSync('antigravity-remote');
    return '${dir.path}/session_store.json';
  }

  Future<File> _file() async {
    if (_cache != null) return _cache!;
    final file = File(_path);
    await file.parent.create(recursive: true);
    return _cache = file;
  }

  Future<Map<String, dynamic>?> load() async {
    try {
      final file = await _file();
      if (!await file.exists()) return null;
      final raw = await file.readAsString();
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null; // corrupt/missing cache — treat as no cache
    }
  }

  Future<void> save({
    required String host,
    required int port,
    String? token,
    List<CascadeSession> sessions = const [],
  }) async {
    try {
      final file = await _file();
      // SEC-04 : le token n'est volontairement PAS persisté sur disque
      // (répertoire temp monde-lisible sur desktop) — cf. SecureCredentials.
      await file.writeAsString(jsonEncode({
        'host': host,
        'port': port,
        'sessions': sessions.map((s) => s.toJson()).toList(),
      }));
      // `token` conservé dans la signature pour compat appelants — ignoré.
    } catch (_) {
      // ponytail: cache is best-effort — never crash the app on disk errors.
    }
  }

  Future<void> clear() async {
    try {
      final file = await _file();
      if (await file.exists()) await file.delete();
    } catch (_) {}
  }
}
