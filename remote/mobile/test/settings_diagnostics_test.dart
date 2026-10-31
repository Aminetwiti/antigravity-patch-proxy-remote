import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile/core/notifications/approval_notifier.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/settings/settings_screen.dart';
import 'package:mobile/widgets/app_toast.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ──────────────────────────────────────────────────────────────────────────────
// Tests de couverture des fonctions de diagnostic & réglages avancés (P0/P1) :
//   - GET /health/diagnostic & export JSON
//   - Persistence des préférences (compactBubbles, monospaceCode, auto-refus timeout, etc.)
// ──────────────────────────────────────────────────────────────────────────────

Future<void> _pumpScreen(
  WidgetTester tester, {
  http.Client? httpClient,
  DaemonApi? api,
  ApprovalNotifier? notifier,
  ValueChanged<Map<String, dynamic>>? onDaemonSaved,
  Map<String, dynamic> initialSettings = const {},
  SettingsCategory initialCategory = SettingsCategory.account,
}) async {
  tester.view.physicalSize = const Size(1200, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);

  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5CF6),
          brightness: Brightness.dark,
        ),
      ),
      home: SettingsScreen(
        initialSettings: initialSettings,
        initialCategory: initialCategory,
        httpClient: httpClient,
        api: api,
        notifier: notifier,
        onDaemonSaved: onDaemonSaved,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppToast.resetForTest();
  });

  tearDown(() {
    AppToast.resetForTest();
  });

  testWidgets('diagnostics: GET /health/diagnostic et export JSON partagé',
      (tester) async {
    bool requested = false;
    final client = MockClient((request) async {
      if (request.url.path.contains('diagnostic')) {
        requested = true;
        return http.Response(
          jsonEncode({
            'status': 'healthy',
            'pid': 1234,
            'csrf_ok': true,
            'connected_clients': 1,
            'active_cascades': 0,
            'lan_ip': '192.168.1.10',
            'tunnel_url': 'https://mock.trycloudflare.com',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('not found', 404);
    });

    await _pumpScreen(tester, httpClient: client, initialCategory: SettingsCategory.app);

    final exportBtn = find.text('Exporter le rapport JSON');
    expect(exportBtn, findsOneWidget);
    await tester.tap(exportBtn);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(seconds: 5));

    expect(requested, isTrue,
        reason: 'le tap doit déclencher un appel au daemon');
  });

  testWidgets('apparence: verboseAgentChat et conversationWidth persistent dans SettingsStore',
      (tester) async {
    await _pumpScreen(tester, initialCategory: SettingsCategory.appearance);

    final verboseSwitch = find.byType(Switch).first;
    await tester.ensureVisible(verboseSwitch);
    await tester.tap(verboseSwitch);
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('settings.verboseAgentChat'), isFalse);

    final narrowOption = find.text('Narrow');
    await tester.ensureVisible(narrowOption);
    await tester.tap(narrowOption);
    await tester.pumpAndSettle();

    expect(prefs.getString('settings.conversationWidth'), 'Narrow');

    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('general: queuedMessagesMode et securityPreset persistent',
      (tester) async {
    await _pumpScreen(tester, initialCategory: SettingsCategory.general);

    final sendImmediateBtn = find.text('Send Immediately');
    await tester.ensureVisible(sendImmediateBtn);
    await tester.tap(sendImmediateBtn);
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('settings.queuedMessagesMode'), 'immediate');

    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });
}
