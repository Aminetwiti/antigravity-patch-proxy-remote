# Spécification Protocolaire ConnectRPC/gRPC-Web & WebSocket Daemon — Antigravity Remote

> Document de référence officiel de l'infrastructure Antigravity Remote. Basé sur l'implémentation effective du Daemon Go (`remote/daemon`), de l'application Flutter (`remote/mobile`), et du service interne `LanguageServerService` (`language_server.exe`).

---

## 1. Moteur Backend & Découverte Processus

Le moteur d'Antigravity est composé de deux types d'instances de `language_server` (binaire Go) :
- `language_server_windows_x64.exe` — instances liées aux fenêtres IDE (`--subclient_type ide`).
- `language_server.exe` — instance centrale standalone (`--subclient_type hub`), patchée par le proxy : `--api_server_url http://localhost:50999`.

### Arguments Critiques du Hub
| Argument | Rôle | Exemple réel |
|:---|:---|:---|
| `--csrf_token` | Token d'authentification RPC du Hub | `dca42d6a-3d87-4a6b-a620-dde9bc7ce40e` |
| `--extension_server_csrf_token` | Token d'authentification des instances IDE | `61edfa3c-af9d-457c-96af-bb466dcb4eab` |
| `--extension_server_port` | Port de BASE (écoute sur `base` et `base+1`) | `55256` → actifs `55256`/`55257` |
| `--subclient_type` | `hub` ou `ide` | `hub` (Cible exclusive pour le contrôle de sessions) |

### Procédure de Découverte Automatique (`pkg/discovery/scanner.go`)
1. Scan des processus `language_server*` via WMI / PowerShell CIM.
2. Ciblage de l'instance hub (`--subclient_type hub`).
3. Détection des ports TCP en écoute via `netstat -ano`.
4. **Validation par Probe Heartbeat** :
   ```http
   POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/Heartbeat
   Content-Type: application/grpc-web+proto
   x-codeium-csrf-token: <csrf_token>
   ```
   → Le code HTTP `200` confirme le port actif du Hub.

---

## 2. Protocole HTTP gRPC-Web (Daemon ↔ LanguageServer)

### Endpoint
```http
POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>
```

### Headers Obligatoires
```http
Content-Type: application/grpc-web+proto
Accept: application/grpc-web+proto,application/grpc-web-text
x-codeium-csrf-token: <csrf_token>
Connect-Protocol-Version: 1
X-Grpc-Web: 1
```

### Framing gRPC-Web
Chaque trame binaire respecte le standard gRPC-Web :
`1 octet flags (0x00 standard, 0x80 trailers) + 4 octets longueur Big-Endian + charge utile Protobuf (ou JSON pour Jetbox)`.

---

## 3. Endpoints HTTP & Découverte Réseau (Daemon Go)

Le Daemon Go expose sur son port d'écoute (`:8090` par défaut) plusieurs points d'accès HTTP et UDP :

### A. Appairage par PIN Éphémère (`POST /pair`)
Permet à un nouveau smartphone d'échanger un code PIN à 6 chiffres contre un jeton de session cryptographique (256 bits).

- **URL** : `http://<ip>:8090/pair`
- **Méthode** : `POST`
- **Payload** :
  ```json
  {
    "pin": "481920",
    "deviceId": "samsung-s21fe-uuid",
    "name": "Galaxy S21 FE",
    "allowedProjects": []
  }
  ```
- **Réponse succès (HTTP 200)** :
  ```json
  {
    "status": "paired",
    "token": "a1f94c8e7b6d5c3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a",
    "expiresAt": "2026-09-16T14:30:00Z",
    "deviceId": "samsung-s21fe-uuid"
  }
  ```
- **Sécurité & Protection** :
  - Validité du PIN : 60 secondes (renouvelé automatiquement).
  - Anti-brute force : Verrouillage de l'IP pendant 5 minutes après 5 échecs consécutifs.

### B. Healthcheck (`GET /health`)
Retourne l'état opérationnel du serveur WebSocket.

- **Réponse (HTTP 200)** : `{"status": "ok", "time": "2026-08-17T15:30:00Z"}`

### C. Diagnostic Étendu (`GET /health/diagnostic`)
Retourne la télémétrie complète du Daemon et de sa liaison avec le Language Server.

- **Réponse (HTTP 200)** :
  ```json
  {
    "status": "ok",
    "rpcPort": 55256,
    "pid": 37136,
    "heartbeatOk": true,
    "tunnelProvider": "cloudflare",
    "publicUrl": "https://random-words.trycloudflare.com",
    "error": ""
  }
  ```

### D. Beacon Auto-Discovery UDP (Zero-Config LAN)
- **Port UDP** : `41234`
- **Fréquence** : Broadcast toutes les 3 secondes + réponse immédiate aux requêtes ping.
- **Payload diffusé** :
  ```json
  {
    "magic": "antigravity-remote",
    "protocol": "ag-discovery-v1",
    "hostname": "Antigravity-PC",
    "port": 8090,
    "publicUrl": "https://random-words.trycloudflare.com",
    "workspaces": ["antigravity-add-model-main"],
    "timestamp": 1723908600
  }
  ```
  *(Note : Le token de sécurité n'est JAMAIS diffusé sur le réseau UDP).*

---

## 4. Protocole WebSocket JSON (Mobile Flutter ↔ Daemon Go)

- **URL de connexion** : `ws://<ip>:<port>/ws?token=<token>` (ou `wss://` via tunnel).
- **Format général des messages** :
  ```json
  {
    "type": "<action_name>",
    "requestId": "<uuid_or_client_req_id>",
    "...champs spécifiques..."
  }
  ```

---

## 5. Catalogue Complet des Actions WebSocket

### A. Gestion des Sessions & Prompts

#### 1. `send_prompt` (Envoi de message & support multimodal)
```json
{
  "type": "send_prompt",
  "requestId": "req_101",
  "cascadeId": "cas_abc123",
  "prompt": "Analyse cette capture d'écran",
  "base64Data": "iVBORw0KGgoAAAANSUhEUgAA...",
  "fileName": "screen.png",
  "noTools": false
}
```

#### 2. `create_cascade` (Instanciation de session)
```json
{
  "type": "create_cascade",
  "requestId": "req_102",
  "workspacePath": "C:/Users/amine/projects/myapp"
}
```

#### 3. `sync_session` (Rattrapage StepRecovery sans perte)
```json
{
  "type": "sync_session",
  "requestId": "req_103",
  "cascadeId": "cas_abc123",
  "lastStepIndex": 42
}
```

#### 4. `submit_question_response` (Réponse au QCM interactif `ask_question`)
```json
{
  "type": "submit_question_response",
  "requestId": "req_104",
  "cascadeId": "cas_abc123",
  "trajectoryId": "traj_xyz",
  "stepIndex": 5,
  "selectedAnswers": ["Option A", "Option B"],
  "customAnswer": "Optionnel: texte libre"
}
```

#### 5. `cancel_generation` / `stop_generation` (Arrêt immédiat de la génération)
```json
{
  "type": "cancel_generation",
  "requestId": "req_105",
  "cascadeId": "cas_abc123"
}
```

#### 6. `delete_cascade` (Suppression définitive d'une session — Confirmation requise)
```json
{
  "type": "delete_cascade",
  "requestId": "req_106",
  "cascadeId": "cas_abc123",
  "confirm": true
}
```

#### 7. `get_active_session` / `session.get_active` (Session active en cours)
```json
{
  "type": "get_active_session",
  "requestId": "req_107"
}
```

#### 7b. `emergency_stop` (Arrêt d'urgence matériel & interruption OS)
```json
{
  "type": "emergency_stop",
  "requestId": "req_107b",
  "cascadeId": "cas_abc123"
}
```

#### 7c. Contrôle Processus IDE (`ide_launch`, `ide_restart`, `ide_kill`)
```json
{
  "type": "ide_launch",
  "requestId": "req_107c"
}
```

---

### B. Approbations d'Outils & Politiques de Sécurité

#### 8. `submit_approval` (Validation / Refus d'action bloquante)
> **Note canonique :** C'est le seul message valide pour approuver/refuser un outil (remplace l'ancien `tool_decision`).
```json
{
  "type": "submit_approval",
  "requestId": "req_108",
  "cascadeId": "cas_abc123",
  "callId": "call_12345",
  "decision": "allow",
  "scope": "once"
}
```
*(Champs `decision` valides : `"allow"`, `"deny"`. Champs `scope` valides : `"once"`, `"session"`).*

#### 9. `get_pending_approval` (Lecture de l'approbation en attente)
```json
{
  "type": "get_pending_approval",
  "requestId": "req_109",
  "cascadeId": "cas_abc123"
}
```

#### 10. `set_approval_timeout` (Délai d'auto-rejet des approbations)
```json
{
  "type": "set_approval_timeout",
  "requestId": "req_110",
  "data": { "minutes": 5 }
}
```

#### 11. `set_auto_accept` (Mode d'auto-approbation)
```json
{
  "type": "set_auto_accept",
  "requestId": "req_111",
  "data": { "enabled": true, "mode": "readonly" }
}
```
*(Modes valides : `"readonly"` (lectures seules autorisées), `"full"` (toutes actions), `"off"`).*

#### 12. `set_no_tools` (Forçage global du mode sans-outils Planner Mode 3)
```json
{
  "type": "set_no_tools",
  "requestId": "req_112",
  "data": { "enabled": true }
}
```

#### 13. `send_steps_to_background` (Relégation en tâche de fond)
```json
{
  "type": "send_steps_to_background",
  "requestId": "req_113",
  "cascadeId": "cas_abc123",
  "stepIndices": [3, 4]
}
```

#### 14. `skip_browser_subagent` (Saut d'un sous-agent de navigation web)
```json
{
  "type": "skip_browser_subagent",
  "requestId": "req_114",
  "cascadeId": "cas_abc123",
  "stepIndex": 5
}
```

---

### C. Terminal PTY Interactif à Distance

#### 15. `terminal_create` (Création d'une session shell)
```json
{
  "type": "terminal_create",
  "requestId": "req_115",
  "data": { "cwd": "C:/Users/amine/projects/myapp" }
}
```
**Réponse :** `{"type": "response", "requestId": "req_115", "data": {"terminalId": "pty-1"}}`

#### 16. `terminal_write` (Écriture de commandes / frappes dans le terminal)
```json
{
  "type": "terminal_write",
  "requestId": "req_116",
  "data": {
    "terminalId": "pty-1",
    "input": "git status\n"
  }
}
```

#### 17. `terminal_kill` (Fermeture forcée du terminal)
```json
{
  "type": "terminal_kill",
  "requestId": "req_117",
  "data": { "terminalId": "pty-1" }
}
```

*Événement diffusé en continu vers le client :*
```json
{
  "type": "terminal_output",
  "data": {
    "terminalId": "pty-1",
    "output": "On branch main\nnothing to commit, working tree clean\n"
  }
}
```

---

### D. Pont Android Debug Bridge (ADB)

#### 18. `adb.list_devices` (Liste des terminaux connectés en USB/Wi-Fi)
```json
{
  "type": "adb.list_devices",
  "requestId": "req_118"
}
```

#### 19. `adb.list_files` (Exploration de fichiers sur l'appareil distant)
```json
{
  "type": "adb.list_files",
  "requestId": "req_119",
  "data": { "path": "/sdcard/Download" }
}
```

#### 20. `adb.search_files` (Recherche de fichiers distant)
```json
{
  "type": "adb.search_files",
  "requestId": "req_120",
  "data": { "path": "/sdcard", "query": "*.png" }
}
```

#### 21. `adb.pull_file` (Téléchargement d'un fichier de l'appareil)
```json
{
  "type": "adb.pull_file",
  "requestId": "req_121",
  "data": { "remotePath": "/sdcard/Download/report.pdf" }
}
```

#### 22. `adb.push_file` (Téléversement d'un fichier vers l'appareil)
```json
{
  "type": "adb.push_file",
  "requestId": "req_122",
  "data": { "remotePath": "/sdcard/Download/test.txt", "content": "SGVsbG8=" }
}
```

---

### E. Tâches Planifiées & Background Cron

#### 23. `list_scheduled_tasks` (Catalogue des crons)
```json
{
  "type": "list_scheduled_tasks",
  "requestId": "req_123"
}
```

#### 24. `schedule_task` / `create_scheduled_task` (Création de tâche récurrente)
```json
{
  "type": "schedule_task",
  "requestId": "req_124",
  "data": {
    "name": "Audit quotidien de sécurité",
    "prompt": "Exécute un audit de sécurité complet et génère un rapport",
    "workspaceName": "antigravity-add-model-main",
    "cronExpression": "0 9 * * *",
    "isEnabled": true
  }
}
```

#### 25. `update_scheduled_task` (Modification de statut / cron)
```json
{
  "type": "update_scheduled_task",
  "requestId": "req_125",
  "data": { "taskId": "task_1723632000", "isEnabled": false }
}
```

#### 26. `trigger_scheduled_task` (Déclenchement immédiat manuel)
```json
{
  "type": "trigger_scheduled_task",
  "requestId": "req_126",
  "taskId": "task_1723632000"
}
```

#### 27. `cancel_scheduled_task` / `delete_scheduled_task` (Suppression de cron)
```json
{
  "type": "cancel_scheduled_task",
  "requestId": "req_127",
  "taskId": "task_1723632000"
}
```

---

### F. Gestion Administrative des Appareils Pairés

#### 28. `admin.list_devices` (Liste des smartphones autorisés)
```json
{
  "type": "admin.list_devices",
  "requestId": "req_128"
}
```

#### 29. `admin.revoke_device` (Révocation d'un accès smartphone)
```json
{
  "type": "admin.revoke_device",
  "requestId": "req_129",
  "data": { "deviceId": "old-device-uuid" }
}
```

---

### G. Fichiers & Système de Fichiers

#### 30. `list_workspaces` (Liste des workspaces reconnus)
```json
{ "type": "list_workspaces", "requestId": "req_130" }
```

#### 31. `list_files` (Arborescence avec exclusions intelligentes)
```json
{
  "type": "list_files",
  "requestId": "req_131",
  "workspacePath": "C:/Users/amine/projects/myapp"
}
```

#### 32. `read_file` (Lecture de fichier UTF-8 / Textuelle)
```json
{
  "type": "read_file",
  "requestId": "req_132",
  "filePath": "C:/Users/amine/projects/myapp/main.go"
}
```

#### 33. `write_file` (Écriture avec contenu Base64)
```json
{
  "type": "write_file",
  "requestId": "req_133",
  "filePath": "C:/Users/amine/projects/myapp/main.go",
  "content": "cGFja2FnZSBtYWluCg==",
  "overwrite": true
}
```

#### 34. `search_files` & `code_search` (Recherche textuelle et grep)
```json
{
  "type": "search_files",
  "requestId": "req_134",
  "workspacePath": "C:/Users/amine/projects/myapp",
  "query": "connectrpc"
}
```

#### 35. `upload_chunk` / `upload_file_chunk` (Téléversement par fragments)
```json
{
  "type": "upload_chunk",
  "requestId": "req_135",
  "data": {
    "uploadId": "up-123",
    "chunkIndex": 0,
    "totalChunks": 5,
    "data": "base64data..."
  }
}
```

---

### H. Gestion de Versions Git / VCS

#### 36. `git_state` / `vcs.get_state` (Statut Git complet)
```json
{ "type": "git_state", "requestId": "req_136", "workspacePath": "C:/projects/myapp" }
```

#### 37. `git_stage` / `git_unstage` (Indexation / Désindexation)
```json
{
  "type": "git_stage",
  "requestId": "req_137",
  "workspacePath": "C:/projects/myapp",
  "data": { "uris": ["file:///C:/projects/myapp/main.go"] }
}
```

#### 38. `git_commit` (Création de commit)
```json
{
  "type": "git_commit",
  "requestId": "req_138",
  "workspacePath": "C:/projects/myapp",
  "data": { "message": "feat: message de commit" }
}
```

#### 39. `git_discard` (Annulation destructive — Confirmation requise)
```json
{
  "type": "git_discard",
  "requestId": "req_139",
  "workspacePath": "C:/projects/myapp",
  "confirm": true,
  "data": { "uris": ["file:///C:/projects/myapp/main.go"] }
}
```

#### 40. `git_commit_details` / `vcs.get_commit_details` (Détails d'un commit)
```json
{
  "type": "git_commit_details",
  "requestId": "req_140",
  "workspacePath": "C:/projects/myapp",
  "commitId": "a1b2c3d"
}
```

#### 41. `list_git_branches` & `list_git_worktrees` (Branches & Worktrees)
```json
{ "type": "list_git_branches", "requestId": "req_141", "workspacePath": "C:/projects/myapp" }
```

#### 42. `checkout_git_worktree` (Changement de worktree actif)
```json
{
  "type": "checkout_git_worktree",
  "requestId": "req_142",
  "data": { "worktreePath": "C:/projects/myapp-worktree" }
}
```

#### 43. `create_worktree` / `workspace.create_worktree` (Création de worktree)
```json
{
  "type": "create_worktree",
  "requestId": "req_143",
  "branch": "feature/task-1"
}
```

#### 44. `generate_commit_message` (Génération de message par IA)
```json
{ "type": "generate_commit_message", "requestId": "req_144" }
```

---

### I. Navigation de Code LSP & Diagnostic

#### 45. `get_lint_errors` / `lsp.get_lint_errors` (Erreurs de linter)
```json
{ "type": "get_lint_errors", "requestId": "req_145", "filePath": "C:/projects/myapp/main.go" }
```

#### 46. `get_definition` / `lsp.get_definition` (Aller à la définition)
```json
{
  "type": "get_definition",
  "requestId": "req_146",
  "filePath": "C:/projects/myapp/main.go",
  "data": { "line": 42, "character": 10 }
}
```

#### 47. `get_code_validation` / `lsp.get_code_validation` (Validation de code)
```json
{ "type": "get_code_validation", "requestId": "req_147", "filePath": "C:/projects/myapp/main.go" }
```

---

### J. Modèles, Quota & Profil Utilisateur

#### 48. `get_available_models` / `list_models` (Catalogue des modèles)
```json
{ "type": "list_models", "requestId": "req_148" }
```

#### 49. `get_model_statuses` / `models.get_statuses` (Disponibilité modèles)
```json
{ "type": "get_model_statuses", "requestId": "req_149" }
```

#### 50. `get_user_status` / `user.get_status` (Profil & crédits)
```json
{ "type": "get_user_status", "requestId": "req_150" }
```

#### 51. `get_quota_summary` / `system.get_quota_summary` (Résumé des quotas)
```json
{ "type": "get_quota_summary", "requestId": "req_151" }
```

*Événement diffusé automatiquement toutes les 60s par le Scheduler :*
```json
{
  "type": "quota_update",
  "data": {
    "geminiWeekly": 25.0,
    "gemini5h": 0.0,
    "thirdPartyWeekly": 10.0,
    "thirdParty5h": 0.0
  }
}
```

#### 51b. `get_project_settings` & `update_project_settings` (Synchronisation 1:1 Agent Settings Desktop)
```json
{ "type": "get_project_settings", "requestId": "req_151b", "workspacePath": "C:/projects/myapp" }
```
```json
{
  "type": "update_project_settings",
  "requestId": "req_151c",
  "workspacePath": "C:/projects/myapp",
  "data": {
    "securityPreset": "Turbo mode",
    "artifactReviewPolicy": "Auto Approve"
  }
}
```
*Événement diffusé en broadcast temps réel à tous les clients connectés :*
```json
{
  "type": "project_settings_updated",
  "data": {
    "projectId": "4964e3d9-2519-40f1-8e3e-e4cb34232b75",
    "projectName": "myapp",
    "securityPreset": "Turbo mode",
    "artifactReviewPolicy": "Auto Approve",
    "fileAccessPolicy": "AGENT_SETTING_POLICY_ALLOW",
    "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
    "artifactReviewMode": "ARTIFACT_REVIEW_MODE_TURBO"
  }
}
```

---

### K. Trajectoires & Historique de Conversation

#### 52. `list_sessions` (Catalogue des sessions récentes)
```json
{ "type": "list_sessions", "requestId": "req_152" }
```

#### 53. `get_session_history` (Historique complet d'une cascade)
```json
{ "type": "get_session_history", "requestId": "req_153", "cascadeId": "cas_abc123" }
```

#### 54. `get_trajectory` (Détail complet d'une trajectoire avec verbosité)
```json
{
  "type": "get_trajectory",
  "requestId": "req_154",
  "cascadeId": "cas_abc123",
  "data": { "verbosity": 2 }
}
```

#### 55. `get_turn_diff` (Diff unifié des modifications d'un tour)
```json
{
  "type": "get_turn_diff",
  "requestId": "req_155",
  "cascadeId": "cas_abc123",
  "stepIndex": 4
}
```

#### 56. `get_revert_preview` / `cascade.get_revert_preview` (Aperçu du retour en arrière)
```json
{ "type": "get_revert_preview", "requestId": "req_156", "cascadeId": "cas_abc123", "stepIndex": 2 }
```

#### 57. `revert_to_step` / `cascade.revert_to_step` (Retour arrière dans la session)
```json
{ "type": "revert_to_step", "requestId": "req_157", "cascadeId": "cas_abc123", "stepIndex": 2 }
```

#### 58. `export_markdown` & `export_jsonl` (Exports de conversation)
```json
{ "type": "export_markdown", "requestId": "req_158", "cascadeId": "cas_abc123" }
```

---

### L. Mode Duel Colosseum (Battle Arena Multi-Modèles)

#### 59. `start_battle_mode` / `colosseum.start` (Lancement du duel)
```json
{
  "type": "start_battle_mode",
  "requestId": "req_159",
  "workspaceUri": "file:///C:/projects/myapp",
  "prompt": "Implémente un algorithme de tri rapide",
  "modelUIDA": "claude-3-7-sonnet",
  "modelEnumA": 312,
  "modelUIDB": "gemini-2-5-pro",
  "modelEnumB": 246
}
```

#### 60. `get_battle_diff` / `colosseum.get_diff` (Diff comparatif live)
```json
{ "type": "get_battle_diff", "requestId": "req_160", "workspaceUri": "file:///C:/projects/myapp" }
```

#### 61. `eliminate_battle_arm` / `colosseum.eliminate_arm` (Élimination d'une branche)
```json
{ "type": "eliminate_battle_arm", "requestId": "req_161", "armId": "arm_b" }
```

#### 62. `end_battle_mode` / `colosseum.end` (Arbitrage & Fusion finale)
```json
{ "type": "end_battle_mode", "requestId": "req_162", "winningArmId": "arm_a", "mergeStrategy": 2 }
```

---

### M. Intégration MCP & Sidecars

#### 63. `refresh_mcp_servers` (Rechargement à chaud des serveurs MCP)
```json
{ "type": "refresh_mcp_servers", "requestId": "req_163" }
```

#### 64. `call_mcp_tool`, `connect_mcp_server`, `list_mcp_servers` (Relais MCP Desktop)
```json
{
  "type": "call_mcp_tool",
  "requestId": "req_164",
  "data": { "server": "coolify", "tool": "list_servers", "arguments": {} }
}
```

#### 65. `complete_mcp_oauth` & `disconnect_mcp_oauth` (OAuth MCP)
```json
{ "type": "complete_mcp_oauth", "requestId": "req_165", "serverId": "coolify", "authCode": "tok-123" }
```

#### 66. `list_sidecar_log_files`, `get_sidecar_logs`, `manage_sidecar` (Contrôle Sidecars)
```json
{ "type": "manage_sidecar", "requestId": "req_166", "sidecarId": "sc-web-01", "data": { "action": 3 } }
```

---

### N. Diagnostics & RAG

#### 67. `dump_flight_recorder` (Extraction du trace profiling Go)
```json
{ "type": "dump_flight_recorder", "requestId": "req_167" }
```

#### 68. `rag.hybrid_search` / `hybrid_search` (Recherche sémantique + lexicale)
```json
{ "type": "rag.hybrid_search", "requestId": "req_168", "query": "auth middleware", "limit": 20 }
```

---

## 6. Flux Temps Réel Dédiés (Connect JSON)

1. **`JetboxSubscribeToSummaries`** : Flux ouvert au boot du Daemon maintenant la sidebar mobile alimentée en temps réel avec des snapshots et mises à jour différentielles sans saturer le bus RPC.
2. **`StreamReactiveUpdates`** : Flux surveillant l'état d'exécution (`IDLE`, `RUNNING`, `CANCELING`, `BUSY`) et les demandes d'interactions bloquantes (`requestedInteraction`).

---

## 7. Sécurité & Résilience Réseau

1. **Anti-DNS Rebinding** : `checkOrigin` n'autorise que `localhost`, `127.0.0.1`, les sous-réseaux privés locaux (`192.168.*`, `10.*`, `172.16.*`) et les tunnels certifiés (`trycloudflare.com`, `pinggy.link`, `ngrok.io`).
2. **Confinement Path Traversal** : `resolvePath` valide strictement l'ancrage des chemins sous la racine du workspace ou sous `brain/<cascadeId>/scratch/`.
3. **Protection Temporelle** : Tokens d'authentification comparés en temps constant via `crypto/subtle.ConstantTimeCompare`.
4. **Buffer Circulaire `StepRecovery`** : 100 trames conservées en RAM par cascade pour un rattrapage immédiat post-reconnexion réseau.
5. **Garde destructive** : `delete_cascade` et `git_discard` exigent impérativement `confirm: true`.
6. **Écriture confinée** : `write_file` passe exclusivement par le RPC `WriteFile` du Language Server ou sous la racine vérifiée.

---

## 8. Source de Vérité Canonique : `remote/tools/`

Pour toute inspection des schémas RPC Protobuf et des composants de référence :
- Schémas gRPC & Protobuf : [`remote/tools/protocols/grpc-schemas/`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/tools/protocols/grpc-schemas) et [`remote/proto/remote_service.proto`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/proto/remote_service.proto).
- Implémentations clientes de référence : [`remote/tools/clients/`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/tools/clients).
- Bridges & Proxies : [`remote/tools/bridges/`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/tools/bridges).
