import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  // ── Constantes de Configuration & Schéma ──
  static const String dbName = 'antigravity_remote.db';
  static const int dbVersion = 1;

  static const String tableSessions = 'sessions';
  static const String tableSessionMessages = 'session_messages';
  static const String tableSessionScrollState = 'session_scroll_state';

  static const String colId = 'id';
  static const String colTitle = 'title';
  static const String colTime = 'time';
  static const String colUpdatedAt = 'updated_at';

  static const String colSessionId = 'session_id';
  static const String colMessagesJson = 'messages_json';

  static const String colScrollIndex = 'scroll_index';
  static const String colScrollOffset = 'scroll_offset';

  static const int gzipCompressionThresholdBytes = 512;
  static const String gzipPrefix = 'gz:';
  static const String defaultSessionTitle = 'Session';

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB(dbName);
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: dbVersion,
      onConfigure: (db) async {
        await db.rawQuery('PRAGMA journal_mode = WAL;');
        await db.rawQuery('PRAGMA synchronous = NORMAL;');
      },
      onOpen: (db) async {
        try {
          await db.execute('ALTER TABLE $tableSessions ADD COLUMN raw_json TEXT;');
        } catch (_) {}
      },
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    const idType = 'TEXT PRIMARY KEY';
    const textType = 'TEXT NOT NULL';

    await db.execute('''
CREATE TABLE $tableSessions (
  $colId $idType,
  $colTitle $textType,
  $colTime $textType,
  $colUpdatedAt INTEGER NOT NULL
)
''');

    await db.execute('''
CREATE TABLE $tableSessionMessages (
  $colSessionId TEXT NOT NULL,
  $colMessagesJson TEXT NOT NULL,
  $colUpdatedAt INTEGER NOT NULL,
  PRIMARY KEY ($colSessionId)
)
''');

    await db.execute('''
CREATE TABLE IF NOT EXISTS $tableSessionScrollState (
  $colSessionId TEXT PRIMARY KEY,
  $colScrollIndex INTEGER NOT NULL,
  $colScrollOffset REAL NOT NULL,
  $colUpdatedAt INTEGER NOT NULL
)
''');

    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON $tableSessions ($colUpdatedAt DESC)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_session_messages_updated_at ON $tableSessionMessages ($colUpdatedAt DESC)',
    );
  }

  Future<void> saveSessions(List<dynamic> sessions) async {
    final db = await instance.database;
    await db.transaction((txn) async {
      final batch = txn.batch();
      for (final session in sessions) {
        if (session is Map) {
          final id = session['id']?.toString() ?? session['cascadeId']?.toString() ?? '';
          if (id.isEmpty) continue;
          final title = session['title']?.toString() ?? defaultSessionTitle;
          final time = session['time']?.toString() ?? session['updatedAt']?.toString() ?? '';
          String? rawJson;
          try {
            rawJson = jsonEncode(session);
          } catch (_) {}
          final values = <String, dynamic>{
            colId: id,
            colTitle: title,
            colTime: time,
            colUpdatedAt: DateTime.now().millisecondsSinceEpoch,
          };
          if (rawJson != null) {
            values['raw_json'] = rawJson;
          }
          batch.insert(
            tableSessions,
            values,
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, dynamic>>> getSessions() async {
    final db = await instance.database;
    final result = await db.query(tableSessions, orderBy: '$colUpdatedAt DESC');
    return result.map((row) {
      final raw = row['raw_json'] as String?;
      if (raw != null && raw.isNotEmpty) {
        try {
          final decoded = jsonDecode(raw);
          if (decoded is Map<String, dynamic>) return decoded;
          if (decoded is Map) return Map<String, dynamic>.from(decoded);
        } catch (_) {}
      }
      return <String, dynamic>{
        'cascadeId': row[colId],
        'id': row[colId],
        'title': row[colTitle],
        'time': row[colTime],
        'updatedAt': DateTime.fromMillisecondsSinceEpoch((row[colUpdatedAt] as num?)?.toInt() ?? 0).toIso8601String(),
      };
    }).toList();
  }

  /// Sauvegarde les messages de session avec compression GZIP pour les payloads volumineux (réduction > 75%).
  Future<void> saveSessionMessages(String sessionId, List<dynamic> messages) async {
    final db = await instance.database;
    final rawJson = jsonEncode(messages);
    
    String payload = rawJson;
    if (rawJson.length > gzipCompressionThresholdBytes) {
      final bytes = utf8.encode(rawJson);
      final compressed = gzip.encode(bytes);
      payload = '$gzipPrefix${base64Encode(compressed)}';
    }
    
    await db.insert(
      tableSessionMessages,
      {
        colSessionId: sessionId,
        colMessagesJson: payload,
        colUpdatedAt: DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Récupère et décompresse automatiquement les messages de session.
  Future<List<dynamic>?> getSessionMessages(String sessionId) async {
    final db = await instance.database;
    final maps = await db.query(
      tableSessionMessages,
      columns: [colMessagesJson],
      where: '$colSessionId = ?',
      whereArgs: [sessionId],
    );

    if (maps.isNotEmpty) {
      final rawStr = maps.first[colMessagesJson] as String;
      if (rawStr.startsWith(gzipPrefix)) {
        final compressed = base64Decode(rawStr.substring(gzipPrefix.length));
        final decompressed = gzip.decode(compressed);
        return jsonDecode(utf8.decode(decompressed)) as List<dynamic>;
      }
      return jsonDecode(rawStr) as List<dynamic>;
    }
    return null;
  }

  /// Mémorise la position exacte de scroll d'une session.
  Future<void> saveScrollState(String sessionId, int index, double offset) async {
    final db = await instance.database;
    await db.insert(
      tableSessionScrollState,
      {
        colSessionId: sessionId,
        colScrollIndex: index,
        colScrollOffset: offset,
        colUpdatedAt: DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Récupère la position de scroll mémorisée.
  Future<Map<String, dynamic>?> getScrollState(String sessionId) async {
    final db = await instance.database;
    final maps = await db.query(
      tableSessionScrollState,
      where: '$colSessionId = ?',
      whereArgs: [sessionId],
    );
    if (maps.isNotEmpty) {
      return maps.first;
    }
    return null;
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}
