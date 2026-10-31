import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('SettingsStore sauvegarde et restaure les toggles browser (BUG-SET-001)', () async {
    await SettingsStore.save({
      'browserHeadlessMode': false,
      'browserAutoCapture': false,
    });

    final s = await SettingsStore.load();

    expect(s['browserHeadlessMode'], isFalse);
    expect(s['browserAutoCapture'], isFalse);
  });

  test('SettingsStore retombe sur les defauts quand rien n est persiste', () async {
    final s = await SettingsStore.load();
    expect(s['browserHeadlessMode'], isTrue);
    expect(s['browserAutoCapture'], isTrue);
  });
}
