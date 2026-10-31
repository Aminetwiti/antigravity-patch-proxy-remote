import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/services/offline_outbox_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('OfflineOutboxStore Tests', () {
    test('saveQueuedMessages and loadQueuedMessages properly persists and retrieves messages', () async {
      final messages = [
        {'id': 'm1', 'prompt': 'Refactor user auth', 'modelUID': 'gemini-3.7-flash'},
        {'id': 'm2', 'prompt': 'Run test suite', 'modelUID': 'gemini-3.7-flash'},
      ];

      await OfflineOutboxStore.saveQueuedMessages('cascade-123', messages);
      final loaded = await OfflineOutboxStore.loadQueuedMessages('cascade-123');

      expect(loaded.length, equals(2));
      expect(loaded[0]['prompt'], equals('Refactor user auth'));
      expect(loaded[1]['prompt'], equals('Run test suite'));
    });

    test('clearQueuedMessages removes all persisted messages for the session', () async {
      final messages = [
        {'id': 'm1', 'prompt': 'Some task'},
      ];

      await OfflineOutboxStore.saveQueuedMessages('cascade-456', messages);
      var loaded = await OfflineOutboxStore.loadQueuedMessages('cascade-456');
      expect(loaded.length, equals(1));

      await OfflineOutboxStore.clearQueuedMessages('cascade-456');
      loaded = await OfflineOutboxStore.loadQueuedMessages('cascade-456');
      expect(loaded, isEmpty);
    });

    test('empty cascadeId returns empty list without error', () async {
      final loaded = await OfflineOutboxStore.loadQueuedMessages('');
      expect(loaded, isEmpty);
    });
  });
}
