import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/widgets/remote_terminal_sheet.dart';

void main() {
  testWidgets('RemoteTerminalSheet renders in offline mode with header, pills, and accessory keys',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: RemoteTerminalSheet(
            api: null,
            projectName: 'TestProject',
            initialCommand: 'echo hello',
          ),
        ),
      ),
    );

    // Header and offline badge
    expect(find.text('Terminal — TestProject'), findsOneWidget);
    expect(find.text('Hors ligne'), findsOneWidget);

    // Initial command pre-filled
    expect(find.text('echo hello'), findsOneWidget);

    // Quick command pills
    expect(find.text('git status'), findsOneWidget);
    expect(find.text('git diff --stat'), findsOneWidget);

    // Accessory keys
    expect(find.text('Ctrl+C'), findsOneWidget);
    expect(find.text('Tab'), findsOneWidget);
    expect(find.text('Clear'), findsOneWidget);
    expect(find.text('|'), findsOneWidget);

    // Tap quick command pill
    await tester.tap(find.text('git status'));
    await tester.pumpAndSettle();

    // In offline mode, error entry is displayed
    expect(find.text('Erreur: Daemon non connecté (hors ligne).'), findsOneWidget);

    // Tap Clear key
    await tester.tap(find.text('Clear'));
    await tester.pumpAndSettle();
    expect(find.text('Erreur: Daemon non connecté (hors ligne).'), findsNothing);
  });

  testWidgets('RemoteTerminalSheet handles PTY live stream and nested data payload correctly',
      (tester) async {
    final incomingController = StreamController<dynamic>.broadcast();
    final sentMessages = <Map<String, dynamic>>[];

    final api = DaemonApi(
      incoming: incomingController.stream,
      send: (msg) {
        if (msg is Map<String, dynamic>) {
          sentMessages.add(msg);
          final type = msg['type'];
          final reqId = msg['requestId'];
          if (type == 'terminal_create') {
            // Reply with pty id
            incomingController.add(jsonEncode({
              'type': 'response',
              'requestId': reqId,
              'data': {'id': 'pty-test-42'},
            }));
          } else if (reqId != null) {
            incomingController.add(jsonEncode({
              'type': 'response',
              'requestId': reqId,
              'data': {'status': 'ok'},
            }));
          }
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RemoteTerminalSheet(
            api: api,
            projectName: 'PtyProject',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    // Badge should show PTY Live
    expect(find.text('PTY Live'), findsOneWidget);

    // Simulate incoming terminal_output with nested data payload (as sent by Go daemon)
    incomingController.add(jsonEncode({
      'type': 'terminal_output',
      'data': {
        'id': 'pty-test-42',
        'data': 'Hello from Go Daemon PTY!\n',
        'kind': 'stdout',
      },
    }));

    await tester.pumpAndSettle();

    // Verify output text rendered
    expect(find.textContaining('Hello from Go Daemon PTY!'), findsOneWidget);

    // Drain batchTimer before test teardown
    await tester.pump(const Duration(milliseconds: 50));

    api.dispose();
    await incomingController.close();
  });
}
