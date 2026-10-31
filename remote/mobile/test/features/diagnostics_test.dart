import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/diagnostics/diagnostics_screen.dart';

void main() {
  testWidgets('DiagnosticsScreen renders profiling options and system metrics', (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (_) {},
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: DiagnosticsScreen(api: api),
      ),
    );

    expect(find.text('Diagnostics & Profiling 📊'), findsOneWidget);
    expect(find.text('Go FlightRecorder Engine'), findsOneWidget);
    expect(find.text('Métriques d\'Exécution'), findsOneWidget);
    expect(find.text('Statut Language Server'), findsOneWidget);
    expect(find.text('Protocole Wire'), findsOneWidget);
  });
}
