import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/workspace/workspace_screen.dart';

/// Répond aux RPC du workspace (list_files, list_git_branches) via le
/// même pattern StreamController que les autres tests du projet.
void main() {
  testWidgets('WorkspaceScreen Axe 2 : filtre par extension + compteur + branche',
      (tester) async {
    final ctrl = StreamController<dynamic>();
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d is String
            ? jsonDecode(d) as Map<String, dynamic>
            : Map<String, dynamic>.from(d as Map);
        switch (map['type']) {
          case 'list_files':
            ctrl.add(jsonEncode({
              'type': 'response',
              'requestId': map['requestId'],
              'data': {
                'files': [
                  {
                    'name': 'main.dart',
                    'isDir': false,
                    'depth': 0,
                    'fullPath': 'lib/main.dart',
                  },
                  {
                    'name': 'daemon_api.go',
                    'isDir': false,
                    'depth': 0,
                    'fullPath': 'pkg/daemon_api.go',
                  },
                  {
                    'name': 'pubspec.yaml',
                    'isDir': false,
                    'depth': 0,
                    'fullPath': 'pubspec.yaml',
                  },
                  {
                    'name': 'lib',
                    'isDir': true,
                    'depth': 0,
                    'fullPath': 'lib',
                  },
                ],
              },
            }));
          case 'list_git_branches':
            ctrl.add(jsonEncode({
              'type': 'response',
              'requestId': map['requestId'],
              'data': {
                'branches': ['* main', 'feature/axe2'],
              },
            }));
          default:
            if (map['requestId'] != null) {
              ctrl.add(jsonEncode({
                'type': 'response',
                'requestId': map['requestId'],
                'data': {},
              }));
            }
        }
      },
    );
    addTearDown(() {
      api.dispose();
      ctrl.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceScreen(api: api, workspacePath: '.'),
      ),
    );
    await tester.pumpAndSettle();

    // Badge de branche courante affiché.
    expect(find.text('main'), findsOneWidget);

    // Compteur fichiers/dossiers.
    expect(find.textContaining('3 fichiers'), findsOneWidget);
    expect(find.textContaining('1 dossiers'), findsOneWidget);

    // Puce de filtre .dart présente ; tap → ne montre plus que main.dart.
    expect(find.text('Dart'), findsOneWidget);
    await tester.tap(find.text('Dart'));
    await tester.pumpAndSettle();

    expect(find.text('main.dart'), findsOneWidget);
    expect(find.text('daemon_api.go'), findsNothing);
    expect(find.text('pubspec.yaml'), findsNothing);

    // Désactivation du filtre → tout réapparaît.
    await tester.tap(find.text('Dart'));
    await tester.pumpAndSettle();
    expect(find.text('daemon_api.go'), findsOneWidget);
  });
}
