import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/settings/account_settings_section.dart';
import 'package:mobile/features/settings/customizations_settings_section.dart';
import 'package:mobile/features/settings/general_settings_section.dart';
import 'package:mobile/features/settings/models_settings_section.dart';
import 'package:mobile/features/settings/settings_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });
  testWidgets('SettingsScreen renders master-detail layout on wide screen', (WidgetTester tester) async {
    // Set wide screen dimensions (tablet/desktop)
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() => tester.view.resetPhysicalSize());

    final ctrl = StreamController<dynamic>.broadcast();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;
        if (reqId != null && type == 'get_account_info') {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({
                'requestId': reqId,
                'email': 'lesjardindelavie@gmail.com',
                'plan': 'Google AI Pro',
                'telemetryEnabled': true,
                'marketingEmails': false,
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: SettingsScreen(
          api: api,
          workspacePath: 'c:\\repos\\antigravity-add-model-main',
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify categories in sidebar
    expect(find.text('SETTINGS'), findsOneWidget);
    expect(find.text('Account'), findsAtLeastNWidgets(1));
    expect(find.text('General'), findsAtLeastNWidgets(1));
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Models'), findsOneWidget);
    expect(find.text('Customizations'), findsOneWidget);
    expect(find.text('Browser'), findsOneWidget);
    expect(find.text('App'), findsOneWidget);

    // Verify Account section content matching Antigravity Desktop
    expect(find.text('Enable Telemetry'), findsOneWidget);
    expect(find.text('Marketing Emails'), findsOneWidget);
    expect(find.text('Your Plan: Google AI Pro'), findsOneWidget);
    expect(find.text('Upgrade'), findsOneWidget);
    expect(find.text('Sign Out'), findsOneWidget);
    expect(find.text('By using this app, you agree to its Terms of Service'), findsOneWidget);

    // Switch to Models category
    await tester.tap(find.text('Models'));
    await tester.pumpAndSettle();

    expect(find.byType(ModelsSettingsSection), findsOneWidget);
    expect(find.text('Models & Usage'), findsOneWidget);
    expect(find.text('Gemini Models'), findsOneWidget);
    expect(find.text('Claude and GPT models'), findsOneWidget);
    expect(find.text('Medium (8k)'), findsOneWidget);

    // Switch to Customizations category
    await tester.tap(find.text('Customizations'));
    await tester.pumpAndSettle();

    expect(find.byType(CustomizationsSettingsSection), findsOneWidget);
    expect(find.text('Token Usage'), findsOneWidget);
    expect(find.textContaining('of the customization budget is available.'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });

  testWidgets('AccountSettingsSection allows toggling telemetry and marketing', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final sent = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        sent.add(map);
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;
        if (reqId != null && type == 'set_account_preferences') {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({
                'requestId': reqId,
                'ok': true,
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountSettingsSection(api: api),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify switches
    final switches = find.byType(Switch);
    expect(switches, findsNWidgets(2));

    // Toggle marketing emails (second switch)
    await tester.tap(switches.at(1));
    await tester.pumpAndSettle();

    expect(sent.any((m) => m['type'] == 'set_account_preferences'), isTrue);

    api.dispose();
    await ctrl.close();
  });

  testWidgets('GeneralSettingsSection displays security presets and syncs with daemon', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final sent = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        sent.add(map);
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;
        if (reqId != null && type == 'get_project_settings') {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({
                'type': 'response',
                'requestId': reqId,
                'data': {
                  'projectId': 'p1',
                  'securityPreset': 'Turbo mode',
                  'artifactReviewPolicy': 'Auto Approve',
                },
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GeneralSettingsSection(api: api),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpAndSettle();

    // Verify presence of Security Preset & Execution
    expect(find.text('Security Preset'), findsOneWidget);
    expect(find.text('Artifact Review Policy'), findsOneWidget);
    expect(find.text('Disables all safety barriers for maximal iteration velocity.'), findsOneWidget);

    // Simulate WebSocket event from Desktop IDE changing settings to Full machine
    ctrl.add(jsonEncode({
      'type': 'project_settings_updated',
      'data': {
        'securityPreset': 'Full machine',
        'artifactReviewPolicy': 'Always Ask',
      },
    }));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();

    // Verify updated UI description from real-time sync
    expect(find.text('All terminal commands require review. The agent can read or write to any file in the machine.'), findsOneWidget);

    api.dispose();
    await ctrl.close();
  });
}
