# Antigravity IDE Remote Full Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intégrer de manière complète, fluide et 100% additive le support d'Antigravity IDE (VS Code v1.107.0) dans le Daemon Go (`remote/daemon`) et l'application mobile Flutter (`remote/mobile`), permettant de lister les workspaces/sessions, d'envoyer des prompts avec streaming temps réel, d'approuver les outils et de basculer entre les shells (2.0 vs IDE) sans aucune régression sur Antigravity 2.0.

**Architecture:** Le Daemon Go utilise `pkg/ide` pour la découverte dynamique zéro-port et expose des routes WebSocket `ide.*` dédiées et unifiée avec les résumés Jetbox. L'application mobile Flutter introduit un sélecteur de shell (`ShellFilter: all, classic, ide`) et un badge visuel distinctif violet `[IDE]`, tout en maintenant le partitionnement hermétique par `cascadeId` (`_sessionMessages`).

**Tech Stack:** Go 1.25+ (`github.com/gorilla/websocket`, `modernc.org/sqlite`), ConnectRPC / gRPC-Web framing, Dart 3.x / Flutter 3.x, SQLite WAL.

## Global Constraints

- **Approche 100% Additive** : Ne jamais altérer ni casser le fonctionnement d'Antigravity 2.0 (Hub `:55256`).
- **Préservation des Invariants** : Respect absolu de $I1$–$I15$ et $ID1$–$ID6$ (`EVENT(Y) ≠ SELECT(Y)`).
- **Zéro Dépendance CGO** : Utilisation exclusive de `modernc.org/sqlite` en Go pur.
- **Sécurité** : Validation systématique du token CSRF et du confinement de workspace.
- **TDD & Vérification** : Chaque tâche inclut ses tests unitaires et sa commande de validation.

---

### Task 1: Intégration des Routes WebSocket `ide.*` dans le Daemon Go

**Files:**
- Modify: `remote/daemon/pkg/gateway/websocket.go:4200-4700`
- Create: `remote/daemon/pkg/gateway/ide_handlers.go`
- Test: `remote/daemon/pkg/gateway/ide_handlers_test.go`

**Interfaces:**
- Consumes: `ide.FindActiveInstance()`, `ide.ListWorkspaces()`, `ide.ListSessions()`, `ide.NewClient()` depuis `pkg/ide`.
- Produces: Messages WebSocket `ide_workspaces_response`, `ide_sessions_response`, `ide_session_created`, `ide_prompt_started`.

- [ ] **Step 1: Écrire le test unitaire pour les handlers `ide.*`**

```go
// remote/daemon/pkg/gateway/ide_handlers_test.go
package gateway

import (
	"testing"
)

func TestHandleIDEMessagesRouting(t *testing.T) {
	s := NewServer(":0", "test-token")
	if s == nil {
		t.Fatal("Serveur non instancié")
	}
	// Vérifie que les routes ide.* sont bien enregistrées dans la table de dispatch
	actions := []string{"ide.list_workspaces", "ide.list_sessions", "ide.create_session", "ide.send_prompt", "ide.focus"}
	for _, act := range actions {
		if !s.IsSupportedAction(act) {
			t.Errorf("Action %s non supportée dans le dispatcher", act)
		}
	}
}
```

- [ ] **Step 2: Exécuter le test pour vérifier l'échec initial**

Run: `go test -v ./pkg/gateway -run TestHandleIDEMessagesRouting`
Expected: FAIL ("IsSupportedAction undefined" ou "Action non supportée")

- [ ] **Step 3: Implémenter `pkg/gateway/ide_handlers.go` et câbler dans `websocket.go`**

```go
// remote/daemon/pkg/gateway/ide_handlers.go
package gateway

import (
	"encoding/json"
	"fmt"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/ide"
)

func (s *Server) IsSupportedAction(action string) bool {
	switch action {
	case "ide.list_workspaces", "ide.list_sessions", "ide.create_session", "ide.send_prompt", "ide.focus":
		return true
	default:
		return false
	}
}

func (s *Server) handleIDEMessage(conn *clientConn, msg IncomingMessage) error {
	switch msg.Type {
	case "ide.list_workspaces":
		ws, err := ide.ListWorkspaces()
		if err != nil {
			return s.sendError(conn, msg.RequestID, err.Error())
		}
		return s.sendResponse(conn, msg.RequestID, "ide_workspaces_response", ws)

	case "ide.list_sessions":
		sessions, err := ide.ListSessions()
		if err != nil {
			return s.sendError(conn, msg.RequestID, err.Error())
		}
		return s.sendResponse(conn, msg.RequestID, "ide_sessions_response", sessions)

	case "ide.create_session":
		client, err := ide.NewAutoClient()
		if err != nil {
			return s.sendError(conn, msg.RequestID, err.Error())
		}
		wsPath := msg.WorkspacePath
		cid, err := client.CreateSession(wsPath, msg.Model)
		if err != nil {
			return s.sendError(conn, msg.RequestID, err.Error())
		}
		return s.sendResponse(conn, msg.RequestID, "ide_session_created", map[string]string{"cascadeId": cid})

	case "ide.focus":
		client, err := ide.NewAutoClient()
		if err != nil {
			return s.sendError(conn, msg.RequestID, err.Error())
		}
		_ = client.SetFocus(msg.CascadeID)
		return s.sendResponse(conn, msg.RequestID, "ide_focused", map[string]string{"status": "ok"})

	default:
		return fmt.Errorf("action IDE inconnue: %s", msg.Type)
	}
}
```

- [ ] **Step 4: Exécuter le test unitaire pour vérifier le succès**

Run: `go test -v ./pkg/gateway -run TestHandleIDEMessagesRouting`
Expected: PASS

- [ ] **Step 5: Valider la non-régression sur l'ensemble du Daemon**

Run: `go test ./...`
Expected: ok 100% PASS

---

### Task 2: Modèle de Données et Sélecteur Multi-Shells dans Flutter

**Files:**
- Modify: `remote/mobile/lib/core/protocol/daemon_api.dart:50-120`
- Modify: `remote/mobile/lib/features/sessions/sessions_drawer.dart:100-250`
- Test: `remote/mobile/test/session_model_switching_history_test.dart`

**Interfaces:**
- Consumes: `ide.list_sessions`, `ide.list_workspaces` RPCs.
- Produces: Champ `shellType` ('classic' | 'ide') sur `CascadeSession`, filtre UI par shell.

- [ ] **Step 1: Écrire le test unitaire Dart pour le parsing des sessions IDE**

```dart
// remote/mobile/test/ide_session_parsing_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/session_parser.dart';

void main() {
  test('Parsing session IDE attribue shellType ide et le badge violet', () {
    final raw = {
      'cascadeId': '60527a47-26c6-4872-9414-d16c00994dc1',
      'title': 'Test IDE Session',
      'workspacePath': 'c:/Users/amine/Downloads',
      'stepCount': 12,
      'shellType': 'ide',
    };
    final session = SessionParser.parseSingle(raw);
    expect(session.id, '60527a47-26c6-4872-9414-d16c00994dc1');
    expect(session.shellType, 'ide');
    expect(session.isIde, isTrue);
  });
}
```

- [ ] **Step 2: Exécuter le test pour vérifier l'échec initial**

Run: `flutter test test/ide_session_parsing_test.dart`
Expected: FAIL (shellType undefined)

- [ ] **Step 3: Ajouter `shellType` dans `CascadeSession` et `DaemonApi`**

```dart
// Dans remote/mobile/lib/core/protocol/daemon_api.dart
class CascadeSession {
  final String id;
  final String title;
  final String workspacePath;
  final String status;
  final String time;
  final String shellType; // 'classic' ou 'ide'

  const CascadeSession({
    required this.id,
    required this.title,
    required this.workspacePath,
    required this.status,
    required this.time,
    this.shellType = 'classic',
  });

  bool get isIde => shellType == 'ide';
  // ... copyWith et JSON serializers
}
```

- [ ] **Step 4: Intégrer les Filter Chips dans `sessions_drawer.dart`**

```dart
// Dans remote/mobile/lib/features/sessions/sessions_drawer.dart
enum ShellFilter { all, classic, ide }

// Widget filter chips en tête de drawer :
Row(
  children: [
    ChoiceChip(
      label: const Text('Tous'),
      selected: _currentFilter == ShellFilter.all,
      onSelected: (_) => setState(() => _currentFilter = ShellFilter.all),
    ),
    ChoiceChip(
      label: const Text('2.0'),
      selected: _currentFilter == ShellFilter.classic,
      onSelected: (_) => setState(() => _currentFilter = ShellFilter.classic),
    ),
    ChoiceChip(
      label: const Text('IDE'),
      selected: _currentFilter == ShellFilter.ide,
      onSelected: (_) => setState(() => _currentFilter = ShellFilter.ide),
    ),
  ],
)
```

- [ ] **Step 5: Exécuter les tests Dart pour valider le comportement**

Run: `flutter test test/ide_session_parsing_test.dart`
Expected: PASS

---

### Task 3: Streaming et Focus Automatique dans le Webview d'Antigravity IDE

**Files:**
- Modify: `remote/daemon/pkg/ide/client.go:80-130`
- Modify: `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart:1800-1850`
- Test: `remote/mobile/test/multi_session_isolation_test.dart`

**Interfaces:**
- Consumes: `SetBrowserOpenConversation`, `SendMessageStream`.
- Produces: Rafraîchissement automatique de l'interface graphique de l'IDE sans refresh manuel.

- [ ] **Step 1: Écrire le test d'isolation de streaming multi-IDE**

```dart
// Dans remote/mobile/test/multi_session_isolation_test.dart
testWidgets('IDE streaming delta does not mutate classic active session', (tester) async {
  final harness = _mkApi();
  await _pumpScreen(tester, api: harness.api, activeSessionId: 'classic-session-1');
  
  // Émission d'un stream_delta pour une session IDE en arrière-plan
  harness.ctrl.add(jsonEncode({
    'type': 'stream_delta',
    'cascadeId': 'ide-session-2',
    'data': {'delta': 'Code généré pour IDE', 'stepIndex': 1},
  }));
  await tester.pump();
  
  // Vérifie que l'écran actif classic-session-1 ne contient pas le texte de l'IDE
  expect(find.textContaining('Code généré pour IDE'), findsNothing);
});
```

- [ ] **Step 2: Exécuter le test d'isolation pour vérifier le respect de l'invariant**

Run: `flutter test test/multi_session_isolation_test.dart`
Expected: PASS

- [ ] **Step 3: Mettre à jour `chat_stream_screen.dart` pour déclencher le focus IDE via `DaemonApi` lors de la sélection d'une session IDE**

```dart
// Dans chat_stream_screen.dart lors de la sélection / envoi de prompt
if (widget.activeSession?.isIde ?? false) {
  widget.api?.rpc('ide.focus', {'cascadeId': widget.activeSessionId});
}
```

- [ ] **Step 4: Exécuter toute la suite de tests mobiles (215+ tests)**

Run: `flutter test --exclude-tags=live`
Expected: 100% PASS

---

### Task 4: Compilation Globale, Intégration CLI et Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`
- Test: `remote/daemon/bin/ag-ide.exe`

- [ ] **Step 1: Compiler le binaire CLI `ag-ide.exe`**

Run: `cd remote/daemon && go build -o bin/ag-ide.exe ./cmd/ag-ide`
Expected: Build exit code 0

- [ ] **Step 2: Vérifier le bon fonctionnement des commandes CLI**

Run: `.\bin\ag-ide.exe workspaces && .\bin\ag-ide.exe sessions`
Expected: Affiche les workspaces actifs et la liste des 140+ sessions IDE

- [ ] **Step 3: Exécuter l'ensemble des tests du repository (Proxy, Daemon, Mobile)**

Run: `npm test && cd remote/daemon && go test ./... && cd ../mobile && flutter test --exclude-tags=live`
Expected: All tests PASS across all 3 stacks

- [ ] **Step 4: Mettre à jour `AGENTS.md` et `ARCHITECTURE.md` pour refléter le support natif d'Antigravity IDE**

Commit: `feat: complete Antigravity IDE remote integration with multi-shell discovery and UI chips`
