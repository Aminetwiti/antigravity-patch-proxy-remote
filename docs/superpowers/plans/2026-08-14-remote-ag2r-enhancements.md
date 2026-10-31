# Antigravity Remote AG2R-Inspired Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the Antigravity Remote system with high-impact features inspired by AG2R: interactive multi-choice decision cards (`ask_question`), quick action macro pills & `/btw` side-question support, code review diff inspector with unified syntax view, subagent lifecycle dashboard, and emergency stop generation controls.

**Architecture:** Extend the existing Go Daemon bridge (`remote/daemon`) to expose rich tool approval and subagent metadata payloads over WebSocket, and expand the Flutter mobile client (`remote/mobile`) with dedicated reactive widgets, interactive selection cards, and quick action macro bars.

**Tech Stack:** Go 1.22 (Daemon bridge, gorilla/websocket), Flutter 3.22+ / Dart 3.4+ (Material 3, Provider/ValueNotifier, Custom Animated Widgets).

## Global Constraints

- Never use third-party protobuf libraries in Go daemon (manual varint encoding only per project standard).
- Keep zero runtime dependency for Go daemon (single binary).
- Ensure 100% backward compatibility for the existing WebSocket JSON v1 envelope (`{type, requestId, data, error}`).
- Do not introduce breaking changes to existing Flutter screens.
- All code additions must follow Material 3 design and the existing theme palette (`AppColors`, `AppTheme`).

---

### Task 1: Interactive Choice Decision Cards Model & UI (`ask_question`)

**Files:**
- Create: `remote/mobile/lib/features/chat_stream/models/question_choice.dart`
- Modify: `remote/mobile/lib/widgets/ask_question_choice_card.dart`
- Test: `remote/mobile/test/widgets/ask_question_choice_card_test.dart`

**Interfaces:**
- Consumes: JSON payload with `question`, `options`, `isMultiSelect`, and `toolCallId`.
- Produces: `AskQuestionChoiceCard` emitting `onSubmitted(Map<String, dynamic> response)` back to the session stream.

- [x] **Step 1: Write the failing unit test for AskQuestionChoiceCard**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/question_choice.dart';
import 'package:mobile/widgets/ask_question_choice_card.dart';

void main() {
  testWidgets('AskQuestionChoiceCard allows selecting option and submits', (tester) async {
    QuestionChoicePayload? submittedPayload;

    final testPayload = QuestionChoicePayload(
      toolCallId: 'call_123',
      question: 'Which database do you prefer?',
      options: ['PostgreSQL', 'SQLite', 'MongoDB'],
      isMultiSelect: false,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AskQuestionChoiceCard(
            payload: testPayload,
            onSubmit: (payload) => submittedPayload = payload,
          ),
        ),
      ),
    );

    expect(find.text('Which database do you prefer?'), findsOneWidget);
    expect(find.text('PostgreSQL'), findsOneWidget);
    expect(find.text('SQLite'), findsOneWidget);

    await tester.tap(find.text('PostgreSQL'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Submit Answer'));
    await tester.pumpAndSettle();

    expect(submittedPayload, isNotNull);
    expect(submittedPayload!.selectedOptions, contains('PostgreSQL'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/widgets/ask_question_choice_card_test.dart`
Expected: FAIL with compilation error (missing QuestionChoicePayload or AskQuestionChoiceCard constructor mismatch).

- [x] **Step 3: Implement QuestionChoicePayload model and update AskQuestionChoiceCard**

```dart
// remote/mobile/lib/features/chat_stream/models/question_choice.dart
class QuestionChoicePayload {
  final String toolCallId;
  final String question;
  final List<String> options;
  final bool isMultiSelect;
  final List<String> selectedOptions;
  final String customResponse;

  QuestionChoicePayload({
    required this.toolCallId,
    required this.question,
    required this.options,
    this.isMultiSelect = false,
    this.selectedOptions = const [],
    this.customResponse = '',
  });

  factory QuestionChoicePayload.fromJson(Map<String, dynamic> json) {
    return QuestionChoicePayload(
      toolCallId: json['toolCallId'] as String? ?? '',
      question: json['question'] as String? ?? '',
      options: (json['options'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      isMultiSelect: json['isMultiSelect'] as bool? ?? false,
      selectedOptions: (json['selectedOptions'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      customResponse: json['customResponse'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'toolCallId': toolCallId,
      'question': question,
      'options': options,
      'isMultiSelect': isMultiSelect,
      'selectedOptions': selectedOptions,
      'customResponse': customResponse,
    };
  }

  QuestionChoicePayload copyWith({
    List<String>? selectedOptions,
    String? customResponse,
  }) {
    return QuestionChoicePayload(
      toolCallId: toolCallId,
      question: question,
      options: options,
      isMultiSelect: isMultiSelect,
      selectedOptions: selectedOptions ?? this.selectedOptions,
      customResponse: customResponse ?? this.customResponse,
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/widgets/ask_question_choice_card_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/chat_stream/models/question_choice.dart remote/mobile/lib/widgets/ask_question_choice_card.dart remote/mobile/test/widgets/ask_question_choice_card_test.dart
git commit -m "feat(remote): add interactive question choice cards"
```

---

### Task 2: Action Macro Pills & Slash Commands Bar (`chat_input_bar.dart`)

**Files:**
- Modify: `remote/mobile/lib/widgets/chat_input_bar.dart`
- Create: `remote/mobile/lib/features/chat_stream/widgets/action_pills_bar.dart`
- Test: `remote/mobile/test/widgets/action_pills_bar_test.dart`

**Interfaces:**
- Consumes: List of available slash commands (`/btw`, `/grill-me`, `/teamwork-preview`, `/learn`, `/goal`, `/schedule`).
- Produces: `ActionPillsBar` widget emitting `onActionSelected(String command)`.

- [x] **Step 1: Write failing test for ActionPillsBar**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/action_pills_bar.dart';

void main() {
  testWidgets('ActionPillsBar renders slash actions and triggers callback', (tester) async {
    String? selectedAction;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ActionPillsBar(
            onActionSelected: (cmd) => selectedAction = cmd,
          ),
        ),
      ),
    );

    expect(find.text('/btw'), findsOneWidget);
    expect(find.text('/grill-me'), findsOneWidget);
    expect(find.text('/teamwork-preview'), findsOneWidget);

    await tester.tap(find.text('/btw'));
    await tester.pumpAndSettle();

    expect(selectedAction, equals('/btw'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/widgets/action_pills_bar_test.dart`
Expected: FAIL with "ActionPillsBar not defined".

- [x] **Step 3: Implement ActionPillsBar component**

```dart
// remote/mobile/lib/features/chat_stream/widgets/action_pills_bar.dart
import 'package:flutter/material.dart';

class SlashAction {
  final String command;
  final String label;
  final IconData icon;

  const SlashAction({
    required this.command,
    required this.label,
    required this.icon,
  });
}

class ActionPillsBar extends StatelessWidget {
  const ActionPillsBar({
    super.key,
    required this.onActionSelected,
    this.actions = const [
      SlashAction(command: '/btw', label: 'BTW (Side Question)', icon: Icons.help_outline),
      SlashAction(command: '/grill-me', label: 'Grill Me (Plan Interview)', icon: Icons.psychology_outlined),
      SlashAction(command: '/teamwork-preview', label: 'Teamwork (Multi-Agent)', icon: Icons.group_work_outlined),
      SlashAction(command: '/goal', label: 'Goal (Long Task)', icon: Icons.flag_outlined),
      SlashAction(command: '/learn', label: 'Learn (Save Habit)', icon: Icons.school_outlined),
    ],
  });

  final ValueChanged<String> onActionSelected;
  final List<SlashAction> actions;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemCount: actions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final action = actions[index];
          return ActionChip(
            avatar: Icon(action.icon, size: 14),
            label: Text(action.command, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            tooltip: action.label,
            onPressed: () => onActionSelected(action.command),
            visualDensity: VisualDensity.compact,
          );
        },
      ),
    );
  }
}
```

- [x] **Step 4: Integrate ActionPillsBar into `chat_input_bar.dart` and run tests**

Run: `flutter test test/widgets/action_pills_bar_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/chat_stream/widgets/action_pills_bar.dart remote/mobile/lib/widgets/chat_input_bar.dart remote/mobile/test/widgets/action_pills_bar_test.dart
git commit -m "feat(remote): add quick action macro pills bar to chat input"
```

---

### Task 3: Emergency Stop Generation & Task Interruption

**Files:**
- Modify: `remote/daemon/pkg/gateway/server.go`
- Modify: `remote/mobile/lib/core/protocol/daemon_api.dart`
- Modify: `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart`
- Test: `remote/mobile/test/protocol/daemon_api_stop_test.dart`

**Interfaces:**
- Consumes: WebSocket message `{type: "cancel_generation", cascadeId: "s3"}`.
- Produces: Cancels active RPC context in Go Daemon and stops token stream.

- [x] **Step 1: Write test for stop generation API in Flutter**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  test('DaemonApi.stopGeneration sends cancel_generation message', () async {
    ClientMessage? sentMsg;
    final api = DaemonApi(sendRaw: (msg) {
      sentMsg = msg;
    });

    api.stopGeneration(cascadeId: 's3_session');

    expect(sentMsg, isNotNull);
    expect(sentMsg!.type, equals('cancel_generation'));
    expect(sentMsg!.cascadeId, equals('s3_session'));
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/protocol/daemon_api_stop_test.dart`
Expected: FAIL with "stopGeneration is not a member of DaemonApi".

- [x] **Step 3: Implement stopGeneration in DaemonApi and Go Gateway**

```dart
// In remote/mobile/lib/core/protocol/daemon_api.dart
void stopGeneration({required String cascadeId}) {
  sendRaw(ClientMessage(
    type: 'cancel_generation',
    requestId: 'req_${DateTime.now().millisecondsSinceEpoch}',
    cascadeId: cascadeId,
  ));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/protocol/daemon_api_stop_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/core/protocol/daemon_api.dart remote/daemon/pkg/gateway/server.go remote/mobile/test/protocol/daemon_api_stop_test.dart
git commit -m "feat(remote): add stop generation and task cancellation support"
```

---

### Task 4: Subagent & Background Tasks Dashboard Drawer

**Files:**
- Create: `remote/mobile/lib/features/subagents/subagents_drawer.dart`
- Create: `remote/mobile/lib/features/subagents/models/subagent_item.dart`
- Test: `remote/mobile/test/features/subagents/subagents_drawer_test.dart`

**Interfaces:**
- Consumes: List of `SubagentItem` with status (`running`, `idle`, `waiting_for_input`, `errored`).
- Produces: Drawer showing subagent hierarchy with kill buttons.

- [x] **Step 1: Write test for SubagentsDrawer**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/subagents_drawer.dart';

void main() {
  testWidgets('SubagentsDrawer renders list of active subagents', (tester) async {
    final subagents = [
      SubagentItem(id: 'agent-1', role: 'Codebase Researcher', status: 'running'),
      SubagentItem(id: 'agent-2', role: 'Test Runner', status: 'waiting_for_input'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          endDrawer: SubagentsDrawer(subagents: subagents, onKillAgent: (_) {}),
          body: const SizedBox(),
        ),
      ),
    );

    expect(find.text('Subagents (2)'), findsNothing); // Not opened yet
  });
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `flutter test test/features/subagents/subagents_drawer_test.dart`
Expected: FAIL with missing classes.

- [x] **Step 3: Implement SubagentItem model and SubagentsDrawer**

```dart
// remote/mobile/lib/features/subagents/models/subagent_item.dart
class SubagentItem {
  final String id;
  final String role;
  final String status;
  final String? stateDetail;

  const SubagentItem({
    required this.id,
    required this.role,
    required this.status,
    this.stateDetail,
  });

  factory SubagentItem.fromJson(Map<String, dynamic> json) {
    return SubagentItem(
      id: json['conversationId'] as String? ?? json['id'] as String? ?? '',
      role: json['role'] as String? ?? 'Subagent',
      status: json['state'] as String? ?? json['status'] as String? ?? 'idle',
      stateDetail: json['stateDetail'] as String?,
    );
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `flutter test test/features/subagents/subagents_drawer_test.dart`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/subagents/models/subagent_item.dart remote/mobile/lib/features/subagents/subagents_drawer.dart remote/mobile/test/features/subagents/subagents_drawer_test.dart
git commit -m "feat(remote): add subagent tracking and background tasks drawer"
```

---

## Verification Plan

### Automated Tests
- Mobile unit & widget tests:
  ```bash
  cd remote/mobile
  flutter test
  ```
- Daemon Go test suite:
  ```bash
  cd remote/daemon
  go test ./...
  ```

### Manual Verification
1. Launch the Go Daemon and start session.
2. Open Flutter Mobile and connect via WebSocket.
3. Trigger an `ask_question` tool event and confirm rich choice cards render and submit in 1 tap.
4. Tap the `/btw` pill in the input bar and verify quick macro insertion.
5. Open the Subagents drawer and verify active background tasks display with live statuses.
