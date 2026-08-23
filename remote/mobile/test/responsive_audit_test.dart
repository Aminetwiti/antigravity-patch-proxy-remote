import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/battle_arena/battle_arena_screen.dart';
import 'package:mobile/features/code_review/widgets/add_comment_dialog.dart';
import 'package:mobile/features/mcp/mcp_explorer_screen.dart';
import 'package:mobile/features/scheduled_tasks/models/scheduled_task_item.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_task_detail_screen.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_tasks_screen.dart';
import 'package:mobile/features/sessions/conversation_history_screen.dart';
import 'package:mobile/features/sessions/sessions_list.dart';
import 'package:mobile/features/settings/account_settings_section.dart';
import 'package:mobile/features/settings/app_settings_section.dart';
import 'package:mobile/features/settings/appearance_settings_section.dart';
import 'package:mobile/features/settings/browser_settings_section.dart';
import 'package:mobile/features/settings/customizations_settings_section.dart';
import 'package:mobile/features/settings/general_settings_section.dart';
import 'package:mobile/features/settings/models_settings_section.dart';
import 'package:mobile/features/settings/settings_screen.dart';
import 'package:mobile/features/settings/shortcuts_modal.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/subagents_drawer.dart';
import 'package:mobile/features/subagents/widgets/subagent_detail_modal.dart';
import 'package:mobile/features/workspace/git_commit_dialog.dart';
import 'package:mobile/features/workspace/git_worktree_selector.dart';
import 'package:mobile/widgets/tool_approval_card.dart';

const List<Size> testResolutions = [
  Size(320, 568),
  Size(360, 640),
  Size(375, 667),
  Size(390, 844),
  Size(412, 915),
  Size(600, 800),
  Size(768, 1024),
  Size(1024, 768),
  Size(1280, 720),
  Size(1366, 768),
  Size(1440, 900),
  Size(1920, 1080),
];

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Deep UI Responsiveness Audit - Multi-resolution Matrix', () {
    for (final size in testResolutions) {
      final label = '${size.width.toInt()}x${size.height.toInt()}';

      testWidgets('SettingsScreen and sub-sections render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        await tester.pumpWidget(
          const MaterialApp(
            home: SettingsScreen(
              initialSettings: {
                'themeIndex': 2,
                'defaultModel': 'Gemini 3.7 Flash Medium',
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Account
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: AccountSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // General
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: GeneralSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Appearance
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: AppearanceSettingsSection(
                initialIndex: 0,
                onThemeModeChanged: (_) {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Models
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ModelsSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Customizations
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: CustomizationsSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Browser
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: BrowserSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // App
        await tester.pumpWidget(const MaterialApp(home: Scaffold(body: AppSettingsSection())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ScheduledTasksScreen and Detail render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        final sampleTask = ScheduledTaskItem(
          id: 'task-1',
          name: 'Backup Repository Task',
          prompt: 'Run full unit tests and create git tag',
          cronExpression: '*/15 * * * *',
          isDaemon: true,
          isEnabled: true,
          events: [
            ScheduledTaskEvent(
              id: 'evt-1',
              timestamp: DateTime.now(),
              outcome: 'done',
              message: 'Execution completed successfully',
              durationMs: 420,
            ),
          ],
        );

        await tester.pumpWidget(
          MaterialApp(
            home: ScheduledTasksScreen(
              tasks: [sampleTask],
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(
          MaterialApp(
            home: ScheduledTaskDetailScreen(
              task: sampleTask,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('McpExplorerScreen and BattleArenaScreen render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        await tester.pumpWidget(
          const MaterialApp(
            home: McpExplorerScreen(),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(
          const MaterialApp(
            home: BattleArenaScreen(
              workspaceUri: 'c:/Users/amine/Downloads/antigravity',
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('SubagentsDrawer and SubagentDetailModal render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        final sampleSubagent = SubagentItem(
          id: 'subagent-70e11446-3317-4327-a377-31208aedcf53',
          role: 'Codebase Researcher & Architectural Auditor',
          status: 'idle',
          typeName: 'researcher',
          stateDetail: 'Grep pattern matching in progress...',
          inheritCustomizations: true,
          prompt: 'Thoroughly scan all 99 Dart files for layout overflow vulnerabilities.',
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              drawer: SubagentsDrawer(
                subagents: [sampleSubagent],
              ),
              body: const Center(child: Text('Body')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SubagentDetailModal(
                agent: sampleSubagent,
                projectName: 'antigravity-add-model-main',
                sessionTitle: 'DEEP UI RESPONSIVENESS AUDIT',
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('Dialogs and Modals render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        // AddCommentDialog
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => AddCommentDialog(
                  filePath: 'lib/features/chat_stream/chat_stream_screen.dart',
                  selectedSnippet: 'final screenWidth = MediaQuery.of(context).size.width;',
                  initialComment: 'Ensure responsive constraints are enforced.',
                  onCommentAdded: (_) {},
                  onDelete: () {},
                  lineNumber: 120,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // GitCommitDialog
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: GitCommitDialog(api: null),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // GitWorktreeSelector
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: GitWorktreeSelector(
                currentBranch: 'main',
                branches: const ['main', 'feature/responsive-audit', 'fix/renderflex-overflow'],
                onBranchSelected: (_) {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // ShortcutsModal
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: ShortcutsModal(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ToolApprovalCard renders on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        final req = ToolApprovalRequest(
          callId: 'call-1',
          toolName: 'run_command',
          command: 'powershell -NoProfile -Command flutter analyze',
          description: 'powershell -NoProfile -Command flutter analyze',
          approvalType: 'command',
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: ToolApprovalCard(
                  request: req,
                  onDecision: (_, {scope = ApprovalScope.once, denyReason = ''}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('ConversationHistoryScreen and LeftSidebarDrawer render on $label', (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() => tester.view.resetPhysicalSize());

        final List<CascadeSession> sessions = [
          const CascadeSession(
            id: 'sess-1',
            title: 'Fix Flutter UI Responsiveness & RenderFlex Overflow',
            workspacePath: 'c:/Users/amine/Downloads/antigravity',
            status: 'CASCADE_STATUS_READY',
            time: '2m',
          ),
          const CascadeSession(
            id: 'sess-2',
            title: 'Architecture & ConnectRPC Wire Protocol Review',
            workspacePath: 'c:/Users/amine/Downloads/antigravity/remote/daemon',
            status: 'CASCADE_STATUS_READY',
            time: '1h',
          ),
        ];

        await tester.pumpWidget(
          MaterialApp(
            home: ConversationHistoryScreen(
              sessions: sessions,
              activeSessionId: 'sess-1',
              onSessionSelected: (_) {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              drawer: LeftSidebarDrawer(
                activeSessionId: 'sess-1',
                sessions: sessions,
                onSessionSelected: (_) {},
                onNewConversation: () {},
                onToggleConnection: () {},
              ),
              body: const Center(child: Text('Home')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
