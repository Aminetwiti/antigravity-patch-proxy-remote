import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/services/session_history_cache_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SessionHistoryCacheStore.instance.clearMemory();
  });

  group('SessionHistoryCacheStore Tests', () {
    test('saves and loads session messages instantly', () async {
      const sessionId = 'test-session-123';
      final messages = [
        const ChatMessage(
          id: 'msg-1',
          sender: 'user',
          text: 'Hello Antigravity',
          timestamp: '12:00:00',
        ),
        const ChatMessage(
          id: 'msg-2',
          sender: 'assistant',
          text: 'How can I assist you?',
          thought: 'Thinking...',
          timestamp: '12:00:01',
          additions: 10,
          deletions: 2,
          filesChanged: ['lib/main.dart'],
        ),
      ];

      await SessionHistoryCacheStore.instance.saveSessionHistory(sessionId, messages);

      // Verify in-memory retrieval (0ms)
      final inMemory = SessionHistoryCacheStore.instance.getInMemory(sessionId);
      expect(inMemory, isNotNull);
      expect(inMemory!.length, equals(2));
      expect(inMemory.first.text, equals('Hello Antigravity'));
      expect(inMemory.last.filesChanged, equals(['lib/main.dart']));

      // Clear memory and verify persistent reload
      SessionHistoryCacheStore.instance.clearMemory();
      final loaded = await SessionHistoryCacheStore.instance.loadSessionHistory(sessionId);
      expect(loaded.length, equals(2));
      expect(loaded.last.thought, equals('Thinking...'));
      expect(loaded.last.additions, equals(10));
    });

    test('removes history cache cleanly', () async {
      const sessionId = 'to-delete';
      final messages = [
        const ChatMessage(id: 'm1', sender: 'user', text: 'hi', timestamp: '12:00'),
      ];

      await SessionHistoryCacheStore.instance.saveSessionHistory(sessionId, messages);
      await SessionHistoryCacheStore.instance.removeSessionHistory(sessionId);

      final loaded = await SessionHistoryCacheStore.instance.loadSessionHistory(sessionId);
      expect(loaded, isEmpty);
    });
  });
}
