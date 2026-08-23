import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

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

  Future<void> saveSessionMessages(String sessionId, List<dynamic> messages) async {
    final db = await instance.database;
    
    await db.insert(
      'session_messages',
      {
        'session_id': sessionId,
        'messages_json': jsonEncode(messages),
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<dynamic>?> getSessionMessages(String sessionId) async {
    final db = await instance.database;
    final maps = await db.query(
      'session_messages',
      columns: ['messages_json'],
      where: 'session_id = ?',
      whereArgs: [sessionId],
    );

    if (maps.isNotEmpty) {
      final jsonStr = maps.first['messages_json'] as String;
      return jsonDecode(jsonStr) as List<dynamic>;
    }
    return null;
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}
