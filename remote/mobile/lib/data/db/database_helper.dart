import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('antigravity_remote.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    const idType = 'TEXT PRIMARY KEY';
    const textType = 'TEXT NOT NULL';

    await db.execute('''
CREATE TABLE sessions (
  id $idType,
  title $textType,
  time $textType,
  updated_at INTEGER NOT NULL
)
''');

    await db.execute('''
CREATE TABLE session_messages (
  session_id TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id)
)
''');

    await db.execute('''
CREATE TABLE IF NOT EXISTS session_scroll_state (
  session_id TEXT PRIMARY KEY,
  scroll_index INTEGER NOT NULL,
  scroll_offset REAL NOT NULL,
  updated_at INTEGER NOT NULL
)
''');

    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions (updated_at DESC)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_session_messages_updated_at ON session_messages (updated_at DESC)',
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
          final title = session['title']?.toString() ?? 'Session';
          final time = session['time']?.toString() ?? session['updatedAt']?.toString() ?? '';
          batch.insert(
            'sessions',
            {
              'id': id,
              'title': title,
              'time': time,
              'updated_at': DateTime.now().millisecondsSinceEpoch,
            },
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, dynamic>>> getSessions() async {
    final db = await instance.database;
    final result = await db.query('sessions', orderBy: 'updated_at DESC');
    return result;
  }

  /// Sauvegarde les messages de session avec compression GZIP pour les payloads volumineux (réduction > 75%).
  Future<void> saveSessionMessages(String sessionId, List<dynamic> messages) async {
    final db = await instance.database;
    final rawJson = jsonEncode(messages);
    
    String payload = rawJson;
    if (rawJson.length > 512) {
      final bytes = utf8.encode(rawJson);
      final compressed = gzip.encode(bytes);
      payload = 'gz:${base64Encode(compressed)}';
    }
    
    await db.insert(
      'session_messages',
      {
        'session_id': sessionId,
        'messages_json': payload,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Récupère et décompresse automatiquement les messages de session.
  Future<List<dynamic>?> getSessionMessages(String sessionId) async {
    final db = await instance.database;
    final maps = await db.query(
      'session_messages',
      columns: ['messages_json'],
      where: 'session_id = ?',
      whereArgs: [sessionId],
    );

    if (maps.isNotEmpty) {
      final rawStr = maps.first['messages_json'] as String;
      if (rawStr.startsWith('gz:')) {
        final compressed = base64Decode(rawStr.substring(3));
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
    await db.execute('''
CREATE TABLE IF NOT EXISTS session_scroll_state (
  session_id TEXT PRIMARY KEY,
  scroll_index INTEGER NOT NULL,
  scroll_offset REAL NOT NULL,
  updated_at INTEGER NOT NULL
)
''');
    await db.insert(
      'session_scroll_state',
      {
        'session_id': sessionId,
        'scroll_index': index,
        'scroll_offset': offset,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Récupère la position de scroll mémorisée.
  Future<Map<String, dynamic>?> getScrollState(String sessionId) async {
    final db = await instance.database;
    await db.execute('''
CREATE TABLE IF NOT EXISTS session_scroll_state (
  session_id TEXT PRIMARY KEY,
  scroll_index INTEGER NOT NULL,
  scroll_offset REAL NOT NULL,
  updated_at INTEGER NOT NULL
)
''');
    final maps = await db.query(
      'session_scroll_state',
      where: 'session_id = ?',
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

