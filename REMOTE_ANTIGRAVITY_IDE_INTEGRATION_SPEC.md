# 🚀 Spécification Technique Complète & Guide d'Implémentation : Antigravity IDE dans Antigravity Remote

> **Document de Référence & d'Implémentation Officiel**  
> Ce document regroupe **tous les protocoles, schémas de données, astuces de rétro-ingénierie et méthodes de contrôle** nécessaires pour intégrer le support complet d'**Antigravity IDE (VS Code v1.107.0)** dans l'écosystème **Antigravity Remote (Daemon Go + Mobile Flutter)** de façon 100% additive et modulaire.

---

## 1. Vue d'Ensemble & Topologie Multi-Shells

L'écosystème Antigravity gère deux shells de développement distincts sur la même machine :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ANTIGRAVITY REMOTE MOBILE                          │
│                          (Application Flutter)                              │
│         ┌─────────────────────────────────────────────────────────┐         │
│         │ [Tous les Projets] | [Antigravity 2.0] | [Antigravity IDE]│       │
│         └─────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket Multiplexé (Port :8090)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DAEMON GO BRIDGE (:8090)                          │
│                                                                             │
│  ┌───────────────────────────────┐     ┌─────────────────────────────────┐  │
│  │ Module Antigravity 2.0        │     │ NOUVEAU Module Antigravity IDE  │  │
│  │ (Language Server Hub :55256)  │     │ (Language Server IDE Dynamique) │  │
│  └───────────────┬───────────────┘     └────────────────┬────────────────┘  │
└──────────────────┼──────────────────────────────────────┼───────────────────┘
                   │ ConnectRPC (gRPC-Web)                │ ConnectRPC (gRPC-Web)
                   ▼                                      ▼
┌───────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Antigravity 2.0 (Classic Shell)   │  │ Antigravity IDE (VS Code v1.107.0)   │
│ - language_server.exe             │  │ - language_server_windows_x64.exe    │
│ - Mode : --subclient_type hub     │  │ - Mode : --subclient_type ide        │
│ - Données : ~/.gemini/antigravity │  │ - Données : ~/.gemini/antigravity-ide│
└───────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 2. Tous les Protocoles Utilisés & Wire Framing

### A. Protocole ConnectRPC / gRPC-Web (Daemon ↔ Language Server)
- **Transport** : HTTP/1.1 ou HTTP/2 vers `http://127.0.0.1:<port>/`
- **Headers Obligatoires** :
  ```http
  POST /exa.language_server_pb.LanguageServerService/<MethodName>
  Content-Type: application/grpc-web+proto
  Accept: application/grpc-web+proto,application/grpc-web-text
  x-codeium-csrf-token: <csrf_token>
  Connect-Protocol-Version: 1
  X-Grpc-Web: 1
  ```
- **Structure Binaire de la Trame (gRPC-Web Framing)** :
  ```text
  [1 octet: Flags] + [4 octets Big-Endian: Longueur L] + [L octets: Payload Protobuf]
  - Flags = 0x00 : Trame de données standard (Message Protobuf)
  - Flags = 0x80 : Trame de fin / Trailers gRPC (Code d'état HTTP/gRPC)
  ```

### B. Protocole WebSocket JSON-RPC (Mobile Flutter ↔ Daemon Go)
- **Transport** : WebSocket (`ws://` en local, `wss://` via tunnel Cloudflare/Pinggy) sur le port `:8090/ws`.
- **Format du Message Client (Request)** :
  ```json
  {
    "type": "send_prompt | list_sessions | create_cascade | set_focus",
    "requestId": "r_101",
    "cascadeId": "60527a47-26c6-4872-9414-d16c00994dc1",
    "prompt": "Mon instruction...",
    "modelUID": "gemini-2.5-flash",
    "data": {}
  }
  ```
- **Format du Message Serveur (Response / Stream Push)** :
  ```json
  {
    "type": "response | stream_start | stream_delta | stream_end | sessions_updated",
    "requestId": "r_101",
    "cascadeId": "60527a47-26c6-4872-9414-d16c00994dc1",
    "data": {
      "delta": "Token de texte généré...",
      "stepIndex": 5,
      "status": "CASCADE_STATUS_RUNNING"
    }
  }
  ```

### C. Protocole CLI Natif IPC (Contrôle Direct de l'Écran de l'IDE)
- **Commande** : `antigravity-ide.cmd chat -r "<prompt>"`
- **Mécanisme** : Transmet le message directement à l'Extension Host via les Named Pipes VS Code (`\\.\pipe\server_<id>`), déclenchant le rafraîchissement immédiat du Webview React à l'écran.

---

## 3. Schémas de Données Décodés

### A. Schémas Protobuf ConnectRPC Clés

#### 1. `StartCascadeRequest` (Création de Session)
```protobuf
message StartCascadeRequest {
  // Champ 4: Source (1 = CORTEX_TRAJECTORY_SOURCE_IDE / USER)
  uint32 source = 4;
  // Champ 5: TrajectoryType (1 = CORTEX_TRAJECTORY_TYPE_DEFAULT)
  uint32 trajectory_type = 5;
  // Champ 8: URI du workspace racine (ex: "file:///c:/projects/myapp")
  string workspace_uri = 8;
  // Champ 14: Enum du modèle standard (si applicable)
  uint64 requested_model_enum = 14;
  // Champ 15: Identifiant UID du modèle custom (ex: "claude-3-7-sonnet")
  string requested_model_uid = 15;
  // Champ 17: Configuration de l'environnement de projet (exclusif avec champ 8)
  ProjectEnvironmentConfig project_env = 17;
}
```

#### 2. `SendUserCascadeMessageRequest` (Envoi de Prompt & Streaming)
```protobuf
message SendUserCascadeMessageRequest {
  // Champ 1: Identifiant unique de la cascade (UUID v4)
  string cascade_id = 1;
  // Champ 2: Texte brut du prompt utilisateur
  string text = 2;
  // Champ 3: Métadonnées de session (contient l'API Key et SessionID)
  Metadata metadata = 3;
  // Champ 4: Configuration Cascade (requested_model_uid, requested_model_id, planner_mode)
  CascadeConfig cascade_config = 4;
  // Champ 6: Pièces jointes (Images base64 / documents)
  repeated MediaAttachment media = 6;
}
```

#### 3. `HandleCascadeUserInteractionRequest` (Approbation d'Outils & Questions)
```protobuf
message HandleCascadeUserInteractionRequest {
  string cascade_id = 1;
  InteractionPayload interaction = 2; // Contient trajectory_id, step_index, décision
}
```

#### 4. `SetBrowserOpenConversationRequest` (Focus UI de l'IDE)
```protobuf
message SetBrowserOpenConversationRequest {
  string cascade_id = 1; // Force le panneau Cascade de l'IDE à ouvrir cette discussion
}
```

---

### B. Schéma du Fichier Journal `transcript.jsonl`
Chaque ligne est un objet JSON représentant une étape chronologique de la trajectoire :
```json
{"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "created_at": "2026-08-24T15:40:22Z", "content": "<USER_REQUEST>...</USER_REQUEST><ADDITIONAL_METADATA>...</ADDITIONAL_METADATA>"}
{"step_index": 1, "source": "SYSTEM", "type": "CONVERSATION_HISTORY", "status": "DONE", "created_at": "2026-08-24T15:40:24Z"}
{"step_index": 2, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-08-24T15:40:24Z", "content": "Texte généré par l'IA..."}
{"step_index": 3, "source": "MODEL", "type": "TOOL_CALL", "status": "DONE", "created_at": "2026-08-24T15:40:25Z", "tool_calls": [{"name": "write_to_file", "arguments": {"TargetFile": "...", "CodeContent": "..."}}]}
{"step_index": 4, "source": "SYSTEM", "type": "CHECKPOINT", "status": "DONE", "created_at": "2026-08-24T15:40:26Z", "content": "{{ CHECKPOINT 0 }} Résumé du contexte..."}
```

---

### C. Schéma de la Base SQLite `conversations/<id>.db`
- **Table `steps`** :
  - `idx` (INTEGER PRIMARY KEY) : Numéro de l'étape (`0, 1, 2, ...`).
  - `step_type` (INTEGER) : Type d'étape (`1=USER_INPUT`, `2=PLANNER_RESPONSE`, `3=TOOL_CALL`, `4=CHECKPOINT`).
  - `status` (INTEGER) : `0=PENDING`, `1=DONE`, `2=ERROR`, `3=CANCELLED`.
  - `step_payload` (BLOB) : Charge utile binaire Protobuf du message et des métadonnées.

---

### D. Schéma de Découverte des Workspaces (`storage.json`)
Emplacement : `%APPDATA%\Antigravity IDE\User\globalStorage\storage.json`
```json
{
  "backupWorkspaces": {
    "folders": [
      { "folderUri": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main" }
    ]
  },
  "profileAssociations": {
    "workspaces": {
      "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main": "__default__profile__",
      "file:///c%3A/Users/amine/Desktop/ooredoo/posweb": "__default__profile__"
    }
  },
  "windowsState": {
    "lastActiveWindow": {
      "folder": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main"
    }
  }
}
```

---

## 4. Astuces & Secrets de Rétro-Ingénierie (Tips & Tricks)

### 💡 Astuce #1 : Découverte Automatique de l'Instance IDE Active
Puisqu'Antigravity IDE n'utilise pas un port Hub fixe (55256), le Daemon Go localise l'instance active en 3 étapes :
1. **Interrogation CIM / WMI** : Détecte les processus `language_server_windows_x64.exe` et extrait `--csrf_token <token>` et `--extension_server_port <port>`.
2. **Scan Netstat** : Récupère les ports TCP en écoute pour ce PID.
3. **Probe Heartbeat** : Envoie une requête `Heartbeat` avec le header `x-codeium-csrf-token` sur chaque port (le port `HTTP 200` confirme le serveur RPC actif, par exemple `:55432`).

### 💡 Astuce #2 : Résolution des Chemins depuis `--workspace_id`
Dans les arguments CLI de l'IDE, `--workspace_id 88586e...` est un **hash SHA-256 (64 hex)** et non un chemin direct. Pour retrouver le dossier réel :
1. Lire `windowsState.lastActiveWindow.folder` dans `storage.json`.
2. Ou extraire la ligne `"Active Document: c:\...\file.ts"` contenue dans le tag `<ADDITIONAL_METADATA>` du `transcript.jsonl` de la session.

### 💡 Astuce #3 : Contournement de la réponse vide de `GetAllCascadeTrajectories`
Dans l'instance IDE, `GetAllCascadeTrajectories` répond `HTTP 200` avec un corps vide (comportement d'isolation VS Code).
👉 **Solution élégante** : Scanner directement le dossier disque `~/.gemini/antigravity-ide/brain/` via `ListLocalSessionsOpts()`. C'est **immédiat (0 ms)** et donne accès à 100% des sessions, métadonnées, titres et dates de modification.

### 💡 Astuce #4 : Forcer la mise à jour visuelle du Webview dans l'IDE
Quand un prompt est envoyé via le backend (Remote / ConnectRPC), le Webview de l'IDE peut rester sur son affichage initial.
👉 **Solution** : Émettre un appel RPC `SetBrowserOpenConversation(cascadeId)` immédiatement après la fin du tour pour forcer le Webview à recharger les nouvelles étapes depuis SQLite.

---

## 5. Matrice des Méthodes de Gestion pour Remote

| Fonctionnalité Remote | Méthode d'Exécution dans Antigravity IDE | Source de Données / API |
|:---|:---|:---|
| **Lister les Workspaces** | Lecture de `storage.json` + scan processus actifs | `ListIdeWorkspaces()` |
| **Lister les Sessions** | Scan des répertoires `~/.gemini/antigravity-ide/brain/` | `ListIdeSessions()` |
| **Créer une Session** | `StartCascade` sur le port IDE (`:55432`) | `Client.CreateCascade()` |
| **Envoyer un Prompt** | `SendUserCascadeMessage` avec streaming gRPC-Web | `Client.SendMessageStream()` |
| **Ouvrir dans l'IDE** | `SetBrowserOpenConversation` | `Client.SetBrowserOpenConversation()` |
| **Lire l'Historique** | Lecture directe de `transcript.jsonl` ou SQLite `.db` | `GetSessionHistory()` |
| **Diffs de Code** | Extraction du diff du tour via `GetTurnDiff` | `Client.GetTurnDiff()` |
| **Approuver un Outil** | `HandleCascadeUserInteraction` avec décision utilisateur | `Client.SubmitToolApproval()` |

---

## 6. Architecture d'Implémentation dans le Code Remote

### A. Dans le Daemon Go (`remote/daemon`)

#### 1. Fichier Dédié : `pkg/gateway/ide_discovery.go`
```go
// Découvre l'instance Language Server d'Antigravity IDE en cours d'exécution
func DiscoverIdeLanguageServer() (port int, csrfToken string, err error) {
    // 1. Scan WMI/CIM des processus language_server_windows_x64.exe
    // 2. Extraction du token et du port actif via Heartbeat probe
    return port, csrfToken, nil
}
```

#### 2. Routes WebSocket Dédiées dans `pkg/gateway/websocket.go`
- `case "ide.list_workspaces":` → Renvoie tous les projets trouvés dans `storage.json`.
- `case "ide.list_sessions":` → Renvoie toutes les sessions taggées `app: "ide"`.
- `case "ide.open_in_desktop":` → Appelle `SetBrowserOpenConversation` pour afficher la session sur l'écran du PC.

---

### B. Dans l'Application Flutter (`remote/mobile`)

#### 1. Extension de `DaemonApi` (`lib/core/protocol/daemon_api.dart`)
```dart
Future<List<Map<String, dynamic>>> listIdeWorkspaces() async {
  final res = await rpc('ide.list_workspaces', {});
  return List<Map<String, dynamic>>.from(res['workspaces'] ?? []);
}

Future<List<Map<String, dynamic>>> listIdeSessions() async {
  final res = await rpc('ide.list_sessions', {});
  return List<Map<String, dynamic>>.from(res['sessions'] ?? []);
}
```

#### 2. Sélecteur de Filtre dans la Liste des Sessions (`sessions_list.dart`)
Ajout d'une barre d'onglets / Filter Chips en tête du tiroir de sessions :
- `[Tout afficher]`
- `[Antigravity 2.0]` (Badge bleu)
- `[Antigravity IDE]` (Badge violet)

---

## 7. Résumé des Garanties de Sécurité & Concurrence

1. **Isolation 100% Hermétique** : Les sessions `antigravity` et `antigravity-ide` possèdent des racines disque distinctes et ne peuvent en aucun cas s'écraser mutuellement.
2. **Préservation du Focus Mobile** : Tout événement distant provenant d'Antigravity IDE est capturé par `cascadeId` sans jamais muter l'état `_activeSessionId` de l'écran mobile en cours de lecture.
3. **Zéro Régression** : L'implémentation est 100% additive — aucune modification des flux existants d'Antigravity 2.0.
