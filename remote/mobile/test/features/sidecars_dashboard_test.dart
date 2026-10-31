import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/sidecars/sidecars_dashboard_screen.dart';

void main() {
  testWidgets('SidecarsDashboardScreen renders sidecar selector and action buttons', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String
            ? jsonDecode(d) as Map<String, dynamic>
            : Map<String, dynamic>.from(d as Map);
        if (map['type'] == 'list_sidecar_log_files') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'data': {'logFiles': ['stdout.log', 'stderr.log']},
          }));
        } else if (map['type'] == 'get_sidecar_logs') {
          ctrl.add(jsonEncode({
            'type': 'response',
            'requestId': map['requestId'],
            'data': {'logs': 'Server started on port 8080'},
          }));
        }
      },
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: SidecarsDashboardScreen(api: api),
      ),
    );

    // Pump to process all async operations
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Conteneurs & Sidecars 📦'), findsOneWidget);
    expect(find.text('Sidecar :'), findsOneWidget);
    expect(find.text('Start'), findsOneWidget);
    expect(find.text('Stop'), findsOneWidget);
    expect(find.text('Restart'), findsOneWidget);
  });
}
