# Antigravity Remote 2.0 Full Feature Integration Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the complete suite of Antigravity 2.0 desktop features into Antigravity Remote (Go Daemon + Flutter Mobile), including `@` Context Mentions, Multimodal Photo/Vision attachments, Interactive Plan Approval ("Proceed"), Code Commenting & Queuing, Scheduled Tasks / Cron Management, MCP Tools Registry, Git Worktrees & Branch Switching, and Execution Security Policies.

**Architecture:** 
- **Go Daemon (`remote/daemon`):** Expose structured RPC endpoints and WebSocket protocol handlers for `@` mention queries (files/rules/MCP), multimodal binary uploads, artifact execution triggers, scheduled task management, MCP tool discovery, and sandbox policy toggling.
- **Flutter Mobile (`remote/mobile`):** Build dedicated Material 3 / Antigravity 2.0 UI components: `@` autocomplete overlay, media picker & upload pipeline, interactive artifact viewer with "Proceed / Request Feedback" action bar, code annotation review dialogs, scheduled tasks dashboard, MCP tools catalog, and workspace/worktree switcher.

**Tech Stack:** Go 1.22 (stdlib, gorilla/websocket, image decoding), Flutter 3.22+ / Dart 3.4+ (Material 3, file_picker/image_picker, Provider, flutter_highlight).

## Global Constraints

- No third-party protobuf libraries in Go Daemon (manual varint encoding only).
- Keep zero runtime dependency on the PC host (single portable Go binary).
- Full backward compatibility for WebSocket JSON v1 envelope (`{type, requestId, data, error}`).
- Do not introduce breaking changes to existing Flutter screens or outbox queue mechanism.
- All UI components must adhere to the Antigravity 2.0 design tokens (`AppColors`, `AppTheme`, "The Quiet Console").

---

## Phase 1: Context & Mention System (`@ Mentions`) & Multimodal Vision

### Task 1: `@ Mentions` Popup & Autocomplete Engine

**Files:**
- Create: `remote/mobile/lib/features/chat_stream/widgets/mention_autocomplete_overlay.dart`
- Create: `remote/mobile/lib/features/chat_stream/models/mention_item.dart`
- Modify: `remote/mobile/lib/widgets/chat_input_bar.dart`
- Test: `remote/mobile/test/widgets/mention_autocomplete_test.dart`

**Interfaces:**
- Consumes: User typing `@` in text field + workspace file list & rules from Daemon.
- Produces: `MentionAutocompleteOverlay` inserting formatted tag (e.g. `@file:lib/main.dart` or `@rule:clean_code`) into input controller.

- [x] **Step 1: Write failing test for MentionAutocompleteOverlay**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/mention_item.dart';
import 'package:mobile/features/chat_stream/widgets/mention_autocomplete_overlay.dart';

void main() {
  testWidgets('MentionAutocompleteOverlay filters items and selects mention', (tester) async {
    MentionItem? selectedMention;
    final items = [
      MentionItem(type: MentionType.file, label: 'main.dart', detail: 'lib/main.dart'),
      MentionItem(type: MentionType.rule, label: 'clean_code', detail: '.agents/rules/clean_code.md'),
      MentionItem(type: MentionType.mcp, label: 'coolify', detail: 'Deploy tools'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MentionAutocompleteOverlay(
            query: 'main',
            items: items,
            onSelected: (item) => selectedMention = item,
          ),
        ),
      ),
    );

    expect(find.text('main.dart'), findsOneWidget);
    expect(find.text('clean_code'), findsNothing);

    await tester.tap(find.text('main.dart'));
    await tester.pumpAndSettle();

    expect(selectedMention, isNotNull);
    expect(selectedMention!.label, equals('main.dart'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/widgets/mention_autocomplete_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement MentionItem model and MentionAutocompleteOverlay**

```dart
// remote/mobile/lib/features/chat_stream/models/mention_item.dart
enum MentionType { file, rule, mcp, conversation, terminal }

class MentionItem {
  final MentionType type;
  final String label;
  final String detail;
  final String? iconName;

  const MentionItem({
    required this.type,
    required this.label,
    required this.detail,
    this.iconName,
  });

  String get tag => '@${type.name}:$label';
}
```

- [x] **Step 4: Connect mention detector in `ChatInputBar` and run test**

Run: `flutter test test/widgets/mention_autocomplete_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/chat_stream/models/mention_item.dart remote/mobile/lib/features/chat_stream/widgets/mention_autocomplete_overlay.dart remote/mobile/lib/widgets/chat_input_bar.dart remote/mobile/test/widgets/mention_autocomplete_test.dart
git commit -m "feat(remote): add @ mentions autocomplete system"
```

---

### Task 2: Multimodal Camera & Image Upload Pipeline

**Files:**
- Modify: `remote/daemon/pkg/gateway/websocket.go`
- Modify: `remote/mobile/lib/core/protocol/daemon_api.dart`
- Modify: `remote/mobile/lib/widgets/chat_input_bar.dart`
- Test: `remote/mobile/test/protocol/daemon_api_upload_test.dart`

**Interfaces:**
- Consumes: Mobile image bytes (Base64 JPEG/PNG).
- Produces: `upload_media` frame saved in workspace scratch folder and referenced in message context.

- [x] **Step 1: Write test for DaemonApi.uploadMedia**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  test('DaemonApi.uploadMedia sends binary attachment payload', () async {
    ClientMessage? sentMsg;
    final api = DaemonApi(sendRaw: (msg) => sentMsg = msg);

    api.uploadMedia(
      cascadeId: 's3',
      fileName: 'screenshot.png',
      mimeType: 'image/png',
      base64Data: 'iVBORw0KGgoAAAANSUhEUgAA...',
    );

    expect(sentMsg, isNotNull);
    expect(sentMsg!.type, equals('upload_media'));
    expect(sentMsg!.data?['fileName'], equals('screenshot.png'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/protocol/daemon_api_upload_test.dart`
Expected: FAIL with "uploadMedia is not a member of DaemonApi".

- [x] **Step 3: Implement uploadMedia in DaemonApi and Gateway**

```dart
// In remote/mobile/lib/core/protocol/daemon_api.dart
void uploadMedia({
  required String cascadeId,
  required String fileName,
  required String mimeType,
  required String base64Data,
}) {
  sendRaw(ClientMessage(
    type: 'upload_media',
    requestId: 'req_media_${DateTime.now().millisecondsSinceEpoch}',
    cascadeId: cascadeId,
    data: {
      'fileName': fileName,
      'mimeType': mimeType,
      'base64Data': base64Data,
    },
  ));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/protocol/daemon_api_upload_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/core/protocol/daemon_api.dart remote/daemon/pkg/gateway/websocket.go remote/mobile/test/protocol/daemon_api_upload_test.dart
git commit -m "feat(remote): add multimodal image upload pipeline"
```

---

## Phase 2: Interactive Artifact Lifecycle & Plan Approval ("Proceed")

### Task 3: Interactive Artifact "Proceed / Feedback" Action Bar

**Files:**
- Modify: `remote/mobile/lib/widgets/artifact_viewer_modal.dart`
- Create: `remote/mobile/lib/features/artifacts/artifact_action_bar.dart`
- Test: `remote/mobile/test/widgets/artifact_action_bar_test.dart`

**Interfaces:**
- Consumes: Artifact metadata (`requestFeedback: bool`, `summary: String`).
- Produces: Action bar with "Proceed" and "Request Changes" buttons triggering prompt execution.

- [x] **Step 1: Write test for ArtifactActionBar**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/artifacts/artifact_action_bar.dart';

void main() {
  testWidgets('ArtifactActionBar emits onProceed when Proceed tapped', (tester) async {
    bool proceedTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: ArtifactActionBar(
            requestFeedback: true,
            onProceed: () => proceedTapped = true,
            onRequestFeedback: () {},
          ),
        ),
      ),
    );

    expect(find.text('Proceed'), findsOneWidget);
    await tester.tap(find.text('Proceed'));
    await tester.pumpAndSettle();

    expect(proceedTapped, isTrue);
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/widgets/artifact_action_bar_test.dart`
Expected: FAIL with "ArtifactActionBar not defined".

- [x] **Step 3: Implement ArtifactActionBar and integrate with ArtifactViewerModal**

```dart
// remote/mobile/lib/features/artifacts/artifact_action_bar.dart
import 'package:flutter/material.dart';
import '../../theme/app_colors.dart';

class ArtifactActionBar extends StatelessWidget {
  final bool requestFeedback;
  final VoidCallback onProceed;
  final VoidCallback onRequestFeedback;

  const ArtifactActionBar({
    super.key,
    required this.requestFeedback,
    required this.onProceed,
    required this.onRequestFeedback,
  });

  @override
  Widget build(BuildContext context) {
    if (!requestFeedback) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              icon: const Icon(Icons.edit_note, size: 18),
              label: const Text('Request Changes'),
              onPressed: onRequestFeedback,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.icon(
              icon: const Icon(Icons.play_arrow, size: 18),
              label: const Text('Proceed'),
              onPressed: onProceed,
            ),
          ),
        ],
      ),
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/widgets/artifact_action_bar_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/artifacts/artifact_action_bar.dart remote/mobile/lib/widgets/artifact_viewer_modal.dart remote/mobile/test/widgets/artifact_action_bar_test.dart
git commit -m "feat(remote): add interactive Proceed and feedback bar for artifacts"
```

---

## Phase 3: Code Commenting & Queuing (Review Annotations)

### Task 4: Inline Code Selection & Queued Comments System

**Files:**
- Create: `remote/mobile/lib/features/code_review/models/code_comment.dart`
- Create: `remote/mobile/lib/features/code_review/widgets/add_comment_dialog.dart`
- Modify: `remote/mobile/lib/widgets/unified_diff_viewer.dart`
- Test: `remote/mobile/test/features/code_review/add_comment_dialog_test.dart`

**Interfaces:**
- Consumes: Selected code line/snippet + user annotation text.
- Produces: Queued comment list formatted into next message prompt.

- [x] **Step 1: Write test for AddCommentDialog**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/code_review/models/code_comment.dart';
import 'package:mobile/features/code_review/widgets/add_comment_dialog.dart';

void main() {
  testWidgets('AddCommentDialog collects comment and emits CodeComment', (tester) async {
    CodeComment? createdComment;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AddCommentDialog(
            filePath: 'lib/main.dart',
            selectedSnippet: 'final x = calculate();',
            onCommentAdded: (c) => createdComment = c,
          ),
        ),
      ),
    );

    expect(find.text('Add Comment'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Please add null check here');
    await tester.tap(find.text('Queue Comment'));
    await tester.pumpAndSettle();

    expect(createdComment, isNotNull);
    expect(createdComment!.commentText, equals('Please add null check here'));
    expect(createdComment!.snippet, equals('final x = calculate();'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/features/code_review/add_comment_dialog_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement CodeComment model and AddCommentDialog**

```dart
// remote/mobile/lib/features/code_review/models/code_comment.dart
class CodeComment {
  final String id;
  final String filePath;
  final String snippet;
  final String commentText;
  final DateTime createdAt;

  CodeComment({
    required this.id,
    required this.filePath,
    required this.snippet,
    required this.commentText,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  String formatPromptQuote() {
    return '> In `$filePath`:\n> ```\n> $snippet\n> ```\n$commentText\n';
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/features/code_review/add_comment_dialog_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/code_review/models/code_comment.dart remote/mobile/lib/features/code_review/widgets/add_comment_dialog.dart remote/mobile/lib/widgets/unified_diff_viewer.dart remote/mobile/test/features/code_review/add_comment_dialog_test.dart
git commit -m "feat(remote): add code review commenting and annotation queue"
```

---

## Phase 4: Automation, Scheduled Tasks & Cron

### Task 5: Scheduled Tasks Dashboard & Cron Trigger Manager

**Files:**
- Create: `remote/mobile/lib/features/scheduled_tasks/models/scheduled_task_item.dart`
- Create: `remote/mobile/lib/features/scheduled_tasks/scheduled_tasks_screen.dart`
- Modify: `remote/mobile/lib/core/protocol/daemon_api.dart`
- Test: `remote/mobile/test/features/scheduled_tasks/scheduled_tasks_test.dart`

**Interfaces:**
- Consumes: Daemon list of active cron expressions & one-shot timers.
- Produces: UI to view next execution, trigger now, pause, or cancel schedules.

- [x] **Step 1: Write test for ScheduledTasksScreen**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/scheduled_tasks/models/scheduled_task_item.dart';
import 'package:mobile/features/scheduled_tasks/scheduled_tasks_screen.dart';

void main() {
  testWidgets('ScheduledTasksScreen renders active cron jobs and one-shot timers', (tester) async {
    final tasks = [
      ScheduledTaskItem(
        id: 'task_cron_1',
        prompt: 'Run server health check',
        cronExpression: '*/5 * * * *',
        isDaemon: true,
        iterationsRun: 12,
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: ScheduledTasksScreen(
          tasks: tasks,
          onCancelTask: (_) {},
          onTriggerNow: (_) {},
        ),
      ),
    );

    expect(find.text('Scheduled Tasks (1)'), findsOneWidget);
    expect(find.text('Run server health check'), findsOneWidget);
    expect(find.text('*/5 * * * *'), findsOneWidget);
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/features/scheduled_tasks/scheduled_tasks_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement ScheduledTaskItem model and ScheduledTasksScreen**

```dart
// remote/mobile/lib/features/scheduled_tasks/models/scheduled_task_item.dart
class ScheduledTaskItem {
  final String id;
  final String prompt;
  final String? cronExpression;
  final int? durationSeconds;
  final bool isDaemon;
  final int iterationsRun;
  final DateTime? nextRunAt;

  ScheduledTaskItem({
    required this.id,
    required this.prompt,
    this.cronExpression,
    this.durationSeconds,
    this.isDaemon = false,
    this.iterationsRun = 0,
    this.nextRunAt,
  });

  factory ScheduledTaskItem.fromJson(Map<String, dynamic> json) {
    return ScheduledTaskItem(
      id: json['id'] as String? ?? '',
      prompt: json['prompt'] as String? ?? '',
      cronExpression: json['cronExpression'] as String?,
      durationSeconds: json['durationSeconds'] as int?,
      isDaemon: json['isDaemon'] as bool? ?? false,
      iterationsRun: json['iterationsRun'] as int? ?? 0,
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/features/scheduled_tasks/scheduled_tasks_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/scheduled_tasks/models/scheduled_task_item.dart remote/mobile/lib/features/scheduled_tasks/scheduled_tasks_screen.dart remote/mobile/test/features/scheduled_tasks/scheduled_tasks_test.dart
git commit -m "feat(remote): add scheduled tasks and cron management screen"
```

---

## Phase 5: MCP & Customization Hub

### Task 6: MCP Servers & Tools Registry Explorer

**Files:**
- Create: `remote/mobile/lib/features/mcp/models/mcp_server_info.dart`
- Create: `remote/mobile/lib/features/mcp/mcp_explorer_screen.dart`
- Modify: `remote/mobile/lib/widgets/right_sidebar_drawer.dart`
- Test: `remote/mobile/test/features/mcp/mcp_explorer_test.dart`

**Interfaces:**
- Consumes: MCP server registry status & tools list from Go Daemon.
- Produces: Visual list of MCP servers (Coolify, Github, PostgreSQL, etc.) with tool signatures.

- [x] **Step 1: Write test for McpExplorerScreen**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/mcp/models/mcp_server_info.dart';
import 'package:mobile/features/mcp/mcp_explorer_screen.dart';

void main() {
  testWidgets('McpExplorerScreen displays servers and tools count', (tester) async {
    final servers = [
      McpServerInfo(
        name: 'coolify',
        status: 'ready',
        toolCount: 14,
        tools: ['list_servers', 'deploy_application', 'get_logs'],
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: McpExplorerScreen(servers: servers),
      ),
    );

    expect(find.text('MCP Servers (1)'), findsOneWidget);
    expect(find.text('coolify'), findsOneWidget);
    expect(find.text('14 tools'), findsOneWidget);
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/features/mcp/mcp_explorer_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement McpServerInfo model and McpExplorerScreen**

```dart
// remote/mobile/lib/features/mcp/models/mcp_server_info.dart
class McpServerInfo {
  final String name;
  final String status;
  final int toolCount;
  final List<String> tools;
  final String? description;

  const McpServerInfo({
    required this.name,
    required this.status,
    required this.toolCount,
    required this.tools,
    this.description,
  });

  factory McpServerInfo.fromJson(Map<String, dynamic> json) {
    final toolsList = (json['tools'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [];
    return McpServerInfo(
      name: json['name'] as String? ?? 'unknown',
      status: json['status'] as String? ?? 'ready',
      toolCount: json['toolCount'] as int? ?? toolsList.length,
      tools: toolsList,
      description: json['description'] as String?,
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/features/mcp/mcp_explorer_test.dart`
Expected: PASS

- [x] **Step 5: Commit** — N/A (dépôt sans HEAD git ; vérifié par tests + analyse)

```bash
git add remote/mobile/lib/features/mcp/models/mcp_server_info.dart remote/mobile/lib/features/mcp/mcp_explorer_screen.dart remote/mobile/test/features/mcp/mcp_explorer_test.dart
git commit -m "feat(remote): add MCP servers and tools registry explorer"
```

---

## Phase 6: Multi-Workspace, Git Worktrees & Execution Policies

### Task 7: Git Worktree Switcher & Execution Policy Settings

**Files:**
- Create: `remote/mobile/lib/features/workspace/git_worktree_selector.dart`
- Modify: `remote/mobile/lib/features/settings/settings_screen.dart`
- Test: `remote/mobile/test/features/workspace/git_worktree_selector_test.dart`

**Interfaces:**
- Consumes: Worktrees/branches list + Tool execution policy state (`strict`, `request-review`, `always-proceed`).
- Produces: Switch active worktree or update sandbox security policy via Daemon API.

- [x] **Step 1: Write test for GitWorktreeSelector**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/workspace/git_worktree_selector.dart';

void main() {
  testWidgets('GitWorktreeSelector shows branches and switches worktree', (tester) async {
    String? selectedBranch;
    final branches = ['main', 'feature/remote-v2', 'fix/websocket-reconnect'];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GitWorktreeSelector(
            currentBranch: 'main',
            branches: branches,
            onBranchSelected: (b) => selectedBranch = b,
          ),
        ),
      ),
    );

    expect(find.text('main'), findsOneWidget);
    expect(find.text('feature/remote-v2'), findsOneWidget);

    await tester.tap(find.text('feature/remote-v2'));
    await tester.pumpAndSettle();

    expect(selectedBranch, equals('feature/remote-v2'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/features/workspace/git_worktree_selector_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement GitWorktreeSelector and policy selector in SettingsScreen**

```dart
// remote/mobile/lib/features/workspace/git_worktree_selector.dart
import 'package:flutter/material.dart';

class GitWorktreeSelector extends StatelessWidget {
  final String currentBranch;
  final List<String> branches;
  final ValueChanged<String> onBranchSelected;

  const GitWorktreeSelector({
    super.key,
    required this.currentBranch,
    required this.branches,
    required this.onBranchSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text('Active Git Worktree / Branch', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ...branches.map((b) {
          final isSelected = b == currentBranch;
          return ListTile(
            leading: Icon(isSelected ? Icons.check_circle : Icons.alt_route, size: 20),
            title: Text(b),
            trailing: isSelected ? const Chip(label: Text('Active', style: TextStyle(fontSize: 11))) : null,
            onTap: () => onBranchSelected(b),
          );
        }),
      ],
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/features/workspace/git_worktree_selector_test.dart`
Expected: PASS

- [x] **Step 5: Commit** — N/A (dépôt sans HEAD git ; vérifié par tests + analyse)

```bash
git add remote/mobile/lib/features/workspace/git_worktree_selector.dart remote/mobile/lib/features/settings/settings_screen.dart remote/mobile/test/features/workspace/git_worktree_selector_test.dart
git commit -m "feat(remote): add Git worktree switcher and execution security policies"
```

---

## Verification Plan

### Automated Tests
- Full Flutter test suite:
  ```bash
  cd remote/mobile
  flutter test
  ```
- Full Go Daemon test suite:
  ```bash
  cd remote/daemon
  go test -v ./pkg/...
  ```

### Manual Verification
1. Open chat and type `@` — verify auto-complete list of files, rules, and MCP servers displays and inserts tags.
2. Open implementation plan artifact and click **"Proceed"** — confirm execution automatically starts without manual prompt typing.
3. Review a code diff and queue an inline comment — verify formatted quotes are appended to the next prompt.
4. Navigate to Scheduled Tasks screen — create or inspect a cron schedule.
5. Open MCP Explorer — confirm all configured MCP servers and tool signatures are browsable.
6. Open Git Worktree selector — switch active working branch cleanly.
