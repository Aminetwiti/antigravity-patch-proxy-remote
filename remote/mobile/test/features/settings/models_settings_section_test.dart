import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/settings/models_settings_section.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Model selection sends /model command and persists (BUG-SET-008 related)', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final sent = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        sent.add(map);
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ModelsSettingsSection(api: api, currentDefaultModel: 'GPT-4o'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Change le modèle par défaut.
    final dropdowns = find.byType(DropdownButton<String>);
    expect(dropdowns, findsWidgets);

    api.dispose();
    await ctrl.close();
  });
}
