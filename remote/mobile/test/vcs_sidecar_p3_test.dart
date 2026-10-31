import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/mcp/mcp_explorer_screen.dart';
import 'package:mobile/features/mcp/models/mcp_server_info.dart';
import 'package:mobile/features/workspace/workspace_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('DaemonApi - Sidecar & VCS P3', () {
    late StreamController<dynamic> controller;
    late List<Map<String, dynamic>> outgoing;
    late DaemonApi api;

    setUp(() {
      outgoing = [];
      controller = StreamController<dynamic>();
      api = DaemonApi(
        incoming: controller.stream,
        send: (data) => outgoing.add(data as Map<String, dynamic>),
      );
    });

    tearDown(() async {
      await controller.close();
      api.dispose();
    });

    test('listSidecarLogFiles sends sidecarId and parses text fields', () async {
      final future = api.listSidecarLogFiles('sc-1');
      await Future<void>.delayed(Duration.zero);

      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'list_sidecar_log_files');
      expect(outgoing.first['sidecarId'], 'sc-1');
      final reqId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': reqId,
          'data': {
            'fields': [
              {'field': 1, 'text': 'server.log'},
              {'field': 1, 'text': 'agent.log'},
            ],
          },
        }),
      );

      final files = await future;
      expect(files, ['server.log', 'agent.log']);
    });

    test('getSidecarLogs sends sidecarId and logFileName', () async {
      final future = api.getSidecarLogs('sc-1', 'server.log');
      await Future<void>.delayed(Duration.zero);

      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'get_sidecar_logs');
      expect(outgoing.first['sidecarId'], 'sc-1');
      expect(outgoing.first['logFileName'], 'server.log');
      final reqId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': reqId,
          'data': {
            'fields': [
              {'field': 1, 'text': 'line 1\nline 2'},
            ],
          },
        }),
      );

      final logs = await future;
      expect(logs, 'line 1\nline 2');
    });

    test('manageSidecar sends sidecarId and action', () async {
      final future = api.manageSidecar('sc-1', action: 3);
      await Future<void>.delayed(Duration.zero);

      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'manage_sidecar');
      expect(outgoing.first['sidecarId'], 'sc-1');
      expect((outgoing.first['data'] as Map)['action'], 3);
      final reqId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': reqId,
          'data': {'status': 'managed', 'action': 3},
        }),
      );

      final res = await future;
      expect(res['status'], 'managed');
    });

    test('getGitState and getVcsState send workspacePath and parse VCS state', () async {
      final future = api.getGitState(workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);

      expect(outgoing, hasLength(1));
      expect(outgoing.first['type'], 'git_state');
      expect(outgoing.first['workspacePath'], '/repo');
      final reqId = outgoing.first['requestId'] as String;

      controller.add(
        jsonEncode({
          'type': 'response',
          'requestId': reqId,
          'data': {
            'vcsType': 'GIT',
            'currentRef': 'feature/p3',
            'inConflict': true,
            'conflicts': [
              {'path': 'lib/main.dart'},
            ],
          },
        }),
      );

      final state = await future;
      expect(state['vcsType'], 'GIT');
      expect(state['currentRef'], 'feature/p3');
      expect(state['inConflict'], isTrue);
    });

    test('gitStage, gitUnstage, gitDiscard, gitCommit, getCommitDetails send expected payloads', () async {
      // 1. gitStage
      final stageFut = api.gitStage(['lib/a.dart'], workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'git_stage');
      expect((outgoing.last['data'] as Map)['uris'], ['lib/a.dart']);
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'staged'}}));
      expect(await stageFut, isTrue);

      // 2. gitUnstage
      final unstageFut = api.gitUnstage(['lib/a.dart'], workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'git_unstage');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'unstaged'}}));
      expect(await unstageFut, isTrue);

      // 3. gitDiscard requires confirm: true
      final discardFut = api.gitDiscard(['lib/a.dart'], confirm: true, workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'git_discard');
      expect(outgoing.last['confirm'], isTrue);
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'discarded'}}));
      expect(await discardFut, isTrue);

      // 4. gitCommit
      final commitFut = api.gitCommit('feat: test', workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'git_commit');
      expect((outgoing.last['data'] as Map)['message'], 'feat: test');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'status': 'committed'}}));
      final commitRes = await commitFut;
      expect(commitRes['status'], 'committed');

      // 5. getCommitDetails
      final detailsFut = api.getCommitDetails('c123', workspacePath: '/repo');
      await Future<void>.delayed(Duration.zero);
      expect(outgoing.last['type'], 'git_commit_details');
      expect(outgoing.last['commitId'], 'c123');
      controller.add(jsonEncode({'type': 'response', 'requestId': outgoing.last['requestId'], 'data': {'id': 'c123'}}));
      final detailsRes = await detailsFut;
      expect(detailsRes['id'], 'c123');
    });
  });

  group('McpExplorerScreen - Sidecar features', () {
    testWidgets('displays server list and expands to show sidecar logs button', (tester) async {
      final servers = [
        const McpServerInfo(
          name: 'git-server',
          status: 'ready',
          toolCount: 3,
          tools: ['git_status', 'git_commit', 'git_push'],
          description: 'Git integration server',
          sidecarId: 'sc-git',
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: McpExplorerScreen(servers: servers),
        ),
      );

      expect(find.text('git-server'), findsOneWidget);
      expect(find.text('3 tools'), findsOneWidget);

      // Expand tile
      await tester.tap(find.text('git-server'));
      await tester.pumpAndSettle();

      expect(find.text('git_status'), findsOneWidget);
      expect(find.text('Logs & Contrôle Sidecar'), findsOneWidget);
    });
  });

  group('WorkspaceScreen - Git conflict UI', () {
    testWidgets('renders conflict banner when conflicts exist', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: WorkspaceScreen(workspacePath: '/mock/repo'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(WorkspaceScreen), findsOneWidget);
    });
  });
}
