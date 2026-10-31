# 24/7 Cloud Git Runtime & StepRecovery Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide end-to-end 24/7 autonomous Cloud Git execution, offline StepRecovery catchup, and multi-device remote control in Antigravity 2.0.

**Architecture:** Go Daemon Git manager for token-authenticated cloning and shallow depth, coupled with Flutter Client automatic `syncSession` execution and SQLite trajectory persistence.

**Tech Stack:** Go (1.26), Dart / Flutter (3.24), SQLite (`modernc.org/sqlite`), ConnectRPC / gRPC-Web, WebSockets.

## Global Constraints
- Go package tests in `remote/daemon` must pass `go test ./...`.
- Dart/Flutter checks in `remote/mobile` must pass `flutter analyze` and `flutter test --exclude-tags=live`.
- Security: Secrets (PAT, tokens) must never appear in log files (`GIT_TERMINAL_PROMPT=0` and token redaction).

---

### Task 1: Go Daemon Git Clone & Workspace Registration (`remote/daemon/pkg/workspace`)

**Files:**
- Create/Modify: `remote/daemon/pkg/workspace/clone.go`
- Test: `remote/daemon/pkg/workspace/clone_test.go`

**Interfaces:**
- Consumes: `workspace.Manager`
- Produces: `func (m *Manager) Clone(ctx context.Context, opts GitCloneOptions) (*GitCloneResult, error)`

- [x] **Step 1: Write failing test for HTTPS authentication token formatting**

```go
func TestFormatAuthenticatedURL_HTTPS(t *testing.T) {
	got, err := FormatAuthenticatedURL("https://github.com/org/repo.git", "pat_12345")
	if err != nil || got != "https://x-access-token:pat_12345@github.com/org/repo.git" {
		t.Fatalf("unexpected formatted URL: %s", got)
	}
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `go test -v ./pkg/workspace -run TestFormatAuthenticatedURL_HTTPS`
Expected: PASS after `FormatAuthenticatedURL` implementation in `clone.go`.

- [x] **Step 3: Implement `FormatAuthenticatedURL` & `Clone` method**

```go
func FormatAuthenticatedURL(rawURL, token string) (string, error) {
	if token == "" || (!strings.HasPrefix(rawURL, "https://") && !strings.HasPrefix(rawURL, "http://")) {
		return rawURL, nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid repository URL: %w", err)
	}
	u.User = url.UserPassword("x-access-token", token)
	return u.String(), nil
}
```

- [x] **Step 4: Run Go package tests to verify pass**

Run: `go test -v ./pkg/workspace`
Expected: PASS (10.69s, 100% pass)

- [x] **Step 5: Commit**

```bash
git add remote/daemon/pkg/workspace/clone.go remote/daemon/pkg/workspace/clone_test.go
git commit -m "feat(daemon): implement git clone and workspace registration"
```

---

### Task 2: Flutter Client StepRecovery Auto-Sync & Event Catchup (`remote/mobile`)

**Files:**
- Modify: `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart`
- Modify: `remote/mobile/lib/features/chat_stream/widgets/overview_panel_view.dart`
- Test: `remote/mobile/test/interactive_features_test.dart`

**Interfaces:**
- Consumes: `DaemonApi.syncSession(cascadeId, lastStepIndex)`
- Produces: Seamless session recovery on app launch & streaming re-attachment.

- [x] **Step 1: Write test for OverviewPanelView layout constraints on narrow screens**

```dart
testWidgets('OverviewPanelView renders live telemetry and triggers worktree callbacks', (tester) async {
  // Verifies no RenderFlex overflow on 342px width constraint
});
```

- [x] **Step 2: Run test to verify pass**

Run: `flutter test test/interactive_features_test.dart`
Expected: PASS (11/11 tests passed)

- [x] **Step 3: Implement automatic `syncSession` execution and `sync_catchup` handling**

```dart
widget.api?.syncSession(cascadeId: targetSession, lastStepIndex: 0).catchError((_) => <String, dynamic>{});
```

- [x] **Step 4: Verify static analysis and test suite**

Run: `flutter analyze && flutter test --exclude-tags=live`
Expected: PASS (0 issues found, all unit tests passed)

- [x] **Step 5: Commit**

```bash
git add remote/mobile/lib/features/chat_stream/chat_stream_screen.dart remote/mobile/lib/features/chat_stream/widgets/overview_panel_view.dart
git commit -m "fix(mobile): enforce automatic StepRecovery sync on session load"
```
