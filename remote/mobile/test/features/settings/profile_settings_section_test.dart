import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/settings/profile_settings_section.dart';

void main() {
  testWidgets('ProfileSettingsSection renders correctly and handles interaction', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ProfileSettingsSection(
            initialName: 'Test Name',
            initialRole: 'Test Role',
            initialStatus: 'Online',
          ),
        ),
      ),
    );

    // Initial render
    expect(find.text('Test Name'), findsOneWidget);
    expect(find.text('Test Role'), findsOneWidget);
    expect(find.text('Online'), findsOneWidget);
    expect(find.text('T'), findsOneWidget); // Avatar initial

    // Open status dialog
    await tester.tap(find.byIcon(Icons.photo_camera_outlined));
    await tester.pumpAndSettle();

    expect(find.text('Statut de présence'), findsOneWidget);
    expect(find.text('Busy'), findsOneWidget);

    // Change status
    await tester.tap(find.text('Busy'));
    await tester.pumpAndSettle();

    expect(find.text('Busy'), findsOneWidget);
  });
}
