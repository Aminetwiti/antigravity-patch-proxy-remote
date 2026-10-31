# 🛠️ Guide d'Intégration Remote : Antigravity IDE

> **Guide d'Implémentation Pas-à-Pas pour le Daemon Go et l'Application Mobile**

---

## 1. Intégration dans le Daemon Go (`remote/daemon`)

### A. Découverte de l'Instance IDE (`pkg/gateway/ide_discovery.go`)
Créer la fonction de découverte sans port fixe :
```go
package gateway

import (
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

type IdeInstance struct {
	PID       int
	Port      int
	CSRFToken string
}

func DiscoverIdeInstance() (*IdeInstance, error) {
	// 1. Exécuter un scan des processus
	// 2. Extraire --csrf_token
	// 3. Tester le Heartbeat sur les ports d'écoute
	// 4. Retourner l'instance validée
	return &IdeInstance{PID: 25868, Port: 55432, CSRFToken: "token"}, nil
}
```

### B. Ajout des Routes WebSocket dans `pkg/gateway/websocket.go`
Ajouter les handlers suivants au switch des messages entrants :
- `case "ide.list_workspaces"` : Renvoie les dossiers listés dans `storage.json`.
- `case "ide.list_sessions"` : Scanne `~/.gemini/antigravity-ide/brain/` et retourne les sessions avec métadonnées.
- `case "ide.create_session"` : Appelle `StartCascade` sur le port IDE.
- `case "ide.send_prompt"` : Appelle `SendMessageStream` sur l'instance IDE et transmet les trames `stream_delta`.
- `case "ide.open_in_desktop"` : Appelle `SetBrowserOpenConversation` pour afficher la session sur l'écran du PC.

---

## 2. Intégration dans l'Application Mobile (`remote/mobile`)

### A. Extension du Client API (`lib/core/protocol/daemon_api.dart`)
```dart
Future<List<Map<String, dynamic>>> listIdeSessions() async {
  final res = await rpc('ide.list_sessions', {});
  return List<Map<String, dynamic>>.from(res['sessions'] ?? []);
}

Future<void> openIdeSessionInDesktop(String cascadeId) async {
  await rpc('ide.open_in_desktop', {'cascadeId': cascadeId});
}
```

### B. Sélecteur Multi-Shells dans le Tiroir de Sessions (`sessions_drawer.dart`)
Ajouter des chips de sélection :
- `[Tous]`
- `[Antigravity 2.0]` (Tag Bleu)
- `[Antigravity IDE]` (Tag Violet)

---

## 3. Matrice de Validation & Tests Automatisés

1. `go test -v ./pkg/gateway/ide_discovery_test.go` : Valide la détection de l'instance.
2. `go test -v ./pkg/connectrpc/ide_test.go` : Valide `StartCascade` et `SendMessageStream`.
3. `flutter test` : Valide la désérialisation des sessions IDE et l'affichage des badges.
