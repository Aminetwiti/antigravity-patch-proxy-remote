# Notifications Bidirectionnelles de Résolution d'Approbation & Gestion des Conflits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les notifications visuelles bidirectionnelles lorsqu'une approbation est résolue par le PC (bannière flottante sur mobile) ou par le mobile (notification système Windows / log Desktop), avec arbitrage atomique des conflits de concurrence (race condition).

**Architecture:** Le Daemon Go arbitre atomiquement toute soumission d'approbation et diffuse `approval_resolved` avec métadonnées (`source`, `decision`, `conflict`). Le client Mobile Flutter affiche une bannière flottante animée non-intrusive (`FloatingResolutionBanner`) pour notifier l'utilisateur de la résolution Desktop ou d'un conflit évité. Le Daemon Go émet une notification OS Windows quand une action est résolue depuis le mobile.

**Tech Stack:** Go (Daemon Bridge, ConnectRPC, WebSocket Gorilla), Dart / Flutter (AnimationController, Custom Painter, HapticFeedback), Windows PowerShell / Shell notifications.

## Global Constraints
- Règle Ponytail : solutions stdlib/minimales, modification au point de passage unique, pas de dépendances superflues.
- Règle Impeccable : respect strict des tokens Antigravity Quiet Console (AppColors, typographie monospace, durée d'animation 200ms).
- Zero Race Condition : le premier événement validé gagne, le second est absorbé avec statut `already_resolved`.

---

### Task 1: Daemon Arbitrage & Windows OS Notification (Go Daemon)

**Files:**
- Modify: `remote/daemon/pkg/gateway/websocket.go`
- Test: `remote/daemon/pkg/gateway/zz_all_approvals_bidirectional_test.go`

**Interfaces:**
- Consumes: WebSocket incoming message `submit_approval`
- Produces: `notifyDesktopAction(action, tool, decision string)`, `already_resolved` guard in `submit_approval`, enriched `approval_resolved` broadcast payload.

- [ ] **Step 1: Write failing test for concurrent approval collision handling**

Dans `remote/daemon/pkg/gateway/zz_all_approvals_bidirectional_test.go`, ajouter `TestApprovalConflict_SecondSubmissionHandledCleanly` :
```go
func TestApprovalConflict_SecondSubmissionHandledCleanly(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// Poser approbation
	gw.MarkApprovalPending("casc-conflict-1", connectrpc.StreamEvent{
		CallID:       "call-conf-1",
		TrajectoryID: "traj-conf-1",
		StepIndex:    601,
		Tool:         "run_command",
	})

	// 1ère soumission : réussit
	submit1 := `{"type":"submit_approval","requestId":"req-1","cascadeId":"casc-conflict-1","callId":"call-conf-1","trajectoryId":"traj-conf-1","stepIndex":601,"decision":"allow","approvalType":"run_command"}`
	_ = client.conn.WriteMessage(websocket.TextMessage, []byte(submit1))

	// 2ème soumission concurrente : doit renvoyer already_resolved sans erreur fatale
	submit2 := `{"type":"submit_approval","requestId":"req-2","cascadeId":"casc-conflict-1","callId":"call-conf-1","trajectoryId":"traj-conf-1","stepIndex":601,"decision":"deny","approvalType":"run_command"}`
	_ = client.conn.WriteMessage(websocket.TextMessage, []byte(submit2))
}
```

- [ ] **Step 2: Run test to verify expected failure or lack of collision handling**

Run: `go test -v ./pkg/gateway -run TestApprovalConflict_SecondSubmissionHandledCleanly`

- [ ] **Step 3: Implement atomic clearance, collision detection, and notifyDesktopAction**

Dans `remote/daemon/pkg/gateway/websocket.go` :
1. Ajouter la détection de collision dans `case "submit_approval"` : si l'approbation n'existe plus dans `s.approvals[msg.CascadeID]`, répondre immédiatement avec `{"status":"already_resolved","conflict":true}`.
2. Ajouter la fonction `notifyDesktopAction` : émet un log structuré et une notification toast Windows non-bloquante via PowerShell `New-BurntToastNotification` ou `notify-send`.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test -v ./pkg/gateway -run TestApprovalConflict_SecondSubmissionHandledCleanly`
Expected: PASS

---

### Task 2: Floating Resolution Banner & Conflict Pill (Flutter Mobile)

**Files:**
- Create: `remote/mobile/lib/widgets/floating_resolution_banner.dart`
- Modify: `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart`
- Test: `remote/mobile/test/features/collaboration_approval_realtime_test.dart`

**Interfaces:**
- Consumes: `approval_resolved` payload avec `source`, `decision`, `approvalType`, `conflict`.
- Produces: `FloatingResolutionBanner` widget animé et méthode `_showResolutionBanner(String message, {bool isConflict = false})` dans `ChatStreamScreen`.

- [ ] **Step 1: Write test for resolution banner trigger on desktop resolution**

Dans `remote/mobile/test/features/collaboration_approval_realtime_test.dart`, ajouter un test vérifiant que `approval_resolved (source: desktop)` déclenche l'affichage d'un indicateur de résolution PC.

- [ ] **Step 2: Run test to verify failure before component implementation**

Run: `flutter test test/features/collaboration_approval_realtime_test.dart`

- [ ] **Step 3: Implement FloatingResolutionBanner widget**

Créer `remote/mobile/lib/widgets/floating_resolution_banner.dart` avec :
- Style "Quiet Console" : fond sombre `AppColors.surfaceCard`, bordure subtile, icône `Icons.desktop_windows_outlined` ou `Icons.bolt_rounded`.
- Animation slide-in fluide depuis le haut (200ms easeOutCubic) et fade-out après 3 secondes.
- Bouton de fermeture manuelle `x` et support du tap pour dismiss.

- [ ] **Step 4: Connect FloatingResolutionBanner in ChatStreamScreen**

Dans `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart` :
- Écouter `approval_resolved`.
- Si `source == 'desktop'`, appeler `_showResolutionBanner(...)` :
  - Si `conflict == true` : `"⚡ Conflit évité : action déjà arbitrée sur votre PC"`
  - Sinon : `"💻 Action $decisionTxt sur le PC ($toolTxt)"`
- Déclencher `HapticFeedback.selectionClick()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/features/collaboration_approval_realtime_test.dart`
Expected: PASS (8/8)

---

### Task 3: Build, Full Verification & Mobile Deployment

**Files:**
- Output: `remote/daemon/daemon.exe`
- Output: `remote/mobile/build/app/outputs/flutter-apk/app-debug.apk`

- [ ] **Step 1: Run static analysis & proxy linter**

Run: `flutter analyze` dans `remote/mobile` (doit être 0 erreur).
Run: `npm run lint` à la racine (doit être 0 erreur).

- [ ] **Step 2: Recompile and restart Go Daemon bridge**

Run: `go build -o daemon.exe main.go` dans `remote/daemon`.
Redémarrer `daemon.exe --port 8091`.

- [ ] **Step 3: Compile APK and deploy to physical Samsung Galaxy S21 FE**

Run: `flutter build apk --debug`
Run: `adb -s RZCT80F971A install -r build/app/outputs/flutter-apk/app-debug.apk`
Run: `adb shell am start -n com.antigravity.remote.mobile/.MainActivity`

- [ ] **Step 4: Live screen capture and verification**

Capture d'écran de l'appareil pour valider la bonne connexion (13ms de latence) et l'état opérationnel.
