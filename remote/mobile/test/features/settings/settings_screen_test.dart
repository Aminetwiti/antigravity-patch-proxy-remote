import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/settings/settings_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('SettingsScreen displays modular categories and navigates to subpage', (tester) async {
    // Narrow mobile viewport
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() => tester.view.resetPhysicalSize());

    await tester.pumpWidget(
      const MaterialApp(
        home: SettingsScreen(
          initialSettings: {},
        ),
      ),
    );

    await tester.pumpAndSettle();

    // Verify categories in mobile hub
    expect(find.text('SETTINGS'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('General'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Models'), findsOneWidget);
    expect(find.text('Customizations'), findsOneWidget);
    expect(find.text('Browser'), findsOneWidget);
    expect(find.text('App & Daemon Bridge'), findsOneWidget);

    // Tap on Account category
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();

    expect(find.text('Enable Telemetry'), findsOneWidget);
    expect(find.text('Marketing Emails'), findsOneWidget);
    expect(find.text('Your Plan: Google AI Pro'), findsOneWidget);
  });

  testWidgets('SettingsScreen opens Shortcuts modal from shortcuts item', (tester) async {
    // Narrow mobile viewport
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() => tester.view.resetPhysicalSize());

    await tester.pumpWidget(
      const MaterialApp(
        home: SettingsScreen(
          initialSettings: {},
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();

    final shortcutsTile = find.widgetWithText(ListTile, 'Shortcuts');
    expect(shortcutsTile, findsOneWidget);

    await tester.tap(shortcutsTile);
    await tester.pumpAndSettle();

    expect(find.text('Ctrl/Cmd + K'), findsOneWidget);
    expect(find.text('Fermer'), findsOneWidget);

    await tester.tap(find.text('Fermer'));
    await tester.pumpAndSettle();

    expect(find.text('Ctrl/Cmd + K'), findsNothing);
  });
}



