# PRD — Antigravity Remote Control OS (V2 Implémentée)

## Product Requirements Document

---

## 1. Périmètre & Fonctionnalités Clés

Antigravity Remote Control OS transforme un smartphone (Android / iOS) en un centre de commandement pour les agents autonomes de Google Antigravity IDE.

### P0 — Critique (Opérationnel ✅)
| # | Fonctionnalité | Protocole / Action | Description |
|:--|:---|:---|:---|
| 1 | Découverte automatique du Hub | Scanner WMI + Probe Heartbeat | Détecte le port TCP et le jeton CSRF sans configuration manuelle. |
| 2 | Création de session | `create_cascade` / `StartCascade` | Instancie une Cascade rattachée à un workspace local. |
| 3 | Envoi de prompt & Streaming | `send_prompt` / `SendUserCascadeMessage` | Envoie des prompts texte et images avec streaming temps réel. |
| 4 | Approbation d'outils tactile | `submit_approval` / `SubmitToolApproval` | Approuve ou refuse les commandes terminal et accès fichiers. |
| 5 | Liste & Switch de sessions | `list_sessions` / `JetboxSubscribeToSummaries` | Maintient la sidebar des sessions synchronisée en direct. |
| 6 | QCM Interactif | `submit_question_response` | Permet de répondre aux questions de clarification de l'agent. |

### P1 — Fonctionnalités Avancées (Opérationnel ✅)
| # | Fonctionnalité | Protocole / Action | Description |
|:--|:---|:---|:---|
| 7 | Revue de Code & Diffs | `get_turn_diff` / `UnifiedDiffViewer` | Visualisation des modifications avec coloration syntaxique et annotations. |
| 8 | Terminal PTY Distant | `terminal_create`, `terminal_write` | Console interactive connectée directement au shell du PC hôte. |
| 9 | Pont ADB Distant | `adb.list_devices`, `adb.pull_file` | Gestion de fichiers et tests sur terminaux Android connectés. |
| 10 | Mode Colosseum Multi-Modèles | `start_battle_mode`, `end_battle_mode` | Duels de modèles (ex: Claude vs Gemini) sur worktrees Git isolés. |
| 11 | Tâches Planifiées (Cron) | `list_scheduled_tasks`, `schedule_task` | Dashboard de surveillance et déclenchement de tâches récurrentes. |
| 12 | Explorateur MCP | `refresh_mcp_servers`, `complete_mcp_oauth` | Inspection des outils et authentification OAuth des serveurs MCP. |
| 13 | StepRecovery (Résilience réseau)| `sync_session` | Buffer circulaire de 100 deltas garantissant zéro perte lors des bascules 4G/Wi-Fi. |

---

## 2. Architecture en 3 Couches

```
┌─────────────────────────────────────────────────────────────┐
│                    COUCHE 1 : PC HÔTE                       │
│                                                             │
│  Antigravity IDE ───► language_server Hub (Go)              │
│                            │ 127.0.0.1 (gRPC-Web / Proto)   │
│                            ▼                                │
│                     Daemon Bridge (Go)                      │
│                     - Découverte auto du port + CSRF        │
│                     - Traducteur gRPC-Web ↔ WebSocket       │
│                     - PTY Shell, Service ADB & StepRecovery │
│                     - PairingManager PIN 60s & UDP Beacon   │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket JSON /ws
                             │ (LAN UDP Beacon ou Tunnel WAN)
┌────────────────────────────┴────────────────────────────────┐
│              COUCHE 2 : RÉSEAU DE TRANSPORT                 │
│                                                             │
│  Option A : Réseau local Wi-Fi (UDP Beacon port 41234)      │
│  Option B : Cloudflare Tunnel / Pinggy SSH (Accès global)   │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│           COUCHE 3 : APPLICATION MOBILE FLUTTER             │
│                                                             │
│  Flutter (Dart 3.x) — Android & iOS                         │
│  - Chat stream "Quiet Console" & Markdown Bubble            │
│  - Approbations d'outils & QCM interactif                   │
│  - Revue de code unifiée & Diffs de tours                   │
│  - Terminal PTY distant & Dashboard de tâches cron          │
│  - Explorateur MCP & Mode Battle Colosseum                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Sécurité & Contrôles d'Accès

| Risque | Mesure de Protection Implémentée |
|:---|:---|
| **Interception réseau sur Internet** | Tunnel chiffré Cloudflare Quick Tunnel (TLS 1.3) ou Pinggy SSH. |
| **Attaque par Rebinding DNS** | Vérification stricte des origines dans `checkOrigin` (whitelist localhost, LAN privé, trycloudflare). |
| **Attaque par Force Brute** | Codes PIN à 6 chiffres éphémères (60s), lockout de 5 minutes après 5 échecs consécutifs. |
| **Traversée de Répertoire** | `resolvePath` confine tous les accès sous la racine du workspace ou le dossier `scratch/`. |
| **Actions Destructives** | `delete_cascade` et `git_discard` exigent une confirmation applicative explicite (`confirm: true`). |
