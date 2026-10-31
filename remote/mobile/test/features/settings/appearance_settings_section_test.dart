import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/settings/appearance_settings_section.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Changing Dark preset persists selection (BUG-SET-006)', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppearanceSettingsSection(
            initialIndex: 0,
            onThemeModeChanged: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Ouvre le dropdown Dark Theme (le second DropdownButton de la page).
    final dropdowns = find.byType(DropdownButton<String>);
    await tester.scrollUntilVisible(dropdowns.last, 200,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(dropdowns.last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Dracula').last);
    await tester.pumpAndSettle();

    final s = await SettingsStore.load();
    expect(s['darkPreset'], 'Dracula');
  });
}
