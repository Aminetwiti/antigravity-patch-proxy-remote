# Antigravity Remote Control OS 🚀

> Contrôle total et temps réel de vos agents Antigravity depuis votre smartphone — en dialoguant **directement avec le moteur Go** (`language_server.exe`) via gRPC-Web et WebSocket.

---

## 🌟 Fonctionnalités Clés & Badges

| Badge | Fonctionnalité | Description |
|:---|:---|:---|
| ![Multimodal](https://img.shields.io/badge/Feature-Multimodal_Images-blue?style=flat-square) | **Prompts Multimodaux** | Téléversement direct de photos, captures d'écran et schémas depuis le smartphone vers `scratch/`. |
| ![StepRecovery](https://img.shields.io/badge/Resilience-StepRecovery_Buffer-success?style=flat-square) | **StepRecovery** | Buffer circulaire FIFO (100 deltas) garantissant zéro perte de streaming lors des bascules Wi-Fi/4G. |
| ![UnifiedDiff](https://img.shields.io/badge/UI-Unified_Diff_Viewer-purple?style=flat-square) | **Revue de Code Mobile** | Diff unifié avec coloration syntaxique (`+` vert, `-` rouge), annotations de lignes et soumission groupée. |
| ![Worktrees](https://img.shields.io/badge/Git-Worktrees_&_Branches-orange?style=flat-square) | **Git Worktrees** | Création de cascades sur des worktrees isolés sans impacter la branche active du PC. |
| ![AskQuestion](https://img.shields.io/badge/UX-AskQuestion_ChoiceCard-yellow?style=flat-square) | **QCM Interactif** | Cartes tactiles de choix unique / multiple pour répondre en 1 tap aux questions de l'agent. |
| ![Macros](https://img.shields.io/badge/Macros-Slash_Commands-cyan?style=flat-square) | **Macros & Slash Commands** | Insertion rapide de `/btw`, `/grill-me`, `/goal`, `/schedule`, `/review`, `/plan`. |
| ![Terminal](https://img.shields.io/badge/Terminal-PTY_Shell-darkred?style=flat-square) | **Terminal PTY Distant** | Console shell interactive exécutée sur le PC hôtier avec streaming de sortie en temps réel. |
| ![ADB](https://img.shields.io/badge/Bridge-Android_ADB-green?style=flat-square) | **Pont ADB Distant** | Gestion de fichiers, push/pull et inspection des appareils Android connectés. |

---

## 🎯 Pourquoi ce projet existe

Les agents Antigravity exécutent des tâches longues mais demandent régulièrement des validations humaines (`submit_approval`, `run_command`, `ask_question`), vous obligeant à rester devant l'écran de votre PC. 

**La Solution :** Une application mobile (Flutter) couplée à un Daemon Go léger sur votre PC, vous permettant d'approuver des actions, d'injecter des prompts et de surveiller l'agent depuis n'importe où, avec une latence quasi-nulle via un tunnel chiffré (Cloudflare / Pinggy) ou en direct sur votre réseau local (Zero-Config UDP Beacon).

Contrairement aux solutions de scraping visuel (CDP / DOM) fragiles, **Antigravity Remote** se branche directement sur le service natif `LanguageServerService` via gRPC-Web Protobuf. C'est instantané, stable et insensible aux changements d'interface graphique.

---

## 🏗️ Architecture Globale

```mermaid
graph TD
    subgraph Mobile Flutter
        A[📱 Antigravity Remote App]
        A1[AskQuestionChoiceCard]
        A2[UnifiedDiffViewer]
        A3[RemoteTerminalSheet]
        A4[Image Picker & Macros]
    end

    subgraph Tunnel Sécurisé / LAN
        B[🌐 Cloudflare Tunnel / Pinggy / LAN UDP Beacon]
    end

    subgraph PC Local (Daemon Bridge)
        C[⚡ Daemon Go :8090]
        C1[StepRecovery Buffer]
        C2[Git Worktree Discovery]
        C3[PTY Terminal & ADB Service]
        C4[PairingManager PIN 60s]
    end

    subgraph Antigravity Engine
        D[🧠 language_server.exe Hub :55256]
        E[📁 Workspace Local & Brain Directory]
    end

    A -->|WebSocket JSON /ws| B
    B -->|WebSocket JSON /ws| C
    C -->|gRPC-Web Protobuf| D
    C -->|Lecture / Écriture Fichiers| E
```

---

## 🛠️ Technologies Utilisées (Stack)

| Couche | Technologie | Justification |
|:---|:---|:---|
| **Daemon (Relais PC)** | **Go 1.22** | Performance pure, démarrage instantané, binaire autonome de 10 Mo sans dépendances externes. |
| **Tunnel Public** | **Cloudflare** / Pinggy | Expose le port local sur Internet en 1 seconde avec URL sécurisée sans ouverture de port routeur. |
| **Communication PC ↔ IDE** | **gRPC-Web + Protobuf** | Protocole officiel `LanguageServerService` rétro-ingéniéré sans bibliothèque lourde. |
| **Communication Mobile ↔ PC** | **WebSockets (JSON)** | Flux bidirectionnel asynchrone pour le streaming LLM, approbations, PTY et uploads. |
| **Application Mobile** | **Flutter (Dart)** | Expérience native iOS & Android fluide (120 Hz), design "Quiet Console", persistance locale. |

---

## 📖 Démarrage Rapide

Le Daemon prend en charge deux modes d'exécution majeurs :

### Mode 1 — Bridge Desktop IDE (Sur PC de développement)
Pour superviser votre session Antigravity locale depuis votre smartphone :
```bash
cd remote/daemon
go run main.go --mode bridge --port 8090 --tunnel cloudflare --auth-token mysecret
# Ou lancer directement le binaire compilé
./daemon.exe --mode bridge --port 8090 --tunnel cloudflare
```
Le Daemon découvre automatiquement le port actif du `language_server.exe` d'Antigravity, démarre le Watchdog CSRF, ouvre le tunnel public et génère un **QR Code d'appairage** et un **code PIN à 6 chiffres** dans le terminal.

### Mode 2 — Standalone Cloud Server Runtime (`ag-agentd`) (Sur Serveur Cloud / VPS)
Pour exécuter des agents autonomes 24/7 sans dépendre d'un IDE de bureau :
```bash
cd remote/daemon
go run main.go --mode server --port 8090 --db-path ~/.antigravity/runtime.db --workspaces-dir ~/workspaces --provider anthropic --auth-token mysecret
```

#### Déploiement Conteneurisé (Docker & Docker Compose)
```bash
# Déploiement en 1 commande avec persistance des volumes et sandboxing
docker compose -f remote/docker-compose.yml up -d
```
Le serveur expose immédiatement la **Console Web** sur `http://localhost:8090/console`, le WebSocket v2 sur `/v2/ws`, et l'API REST sur `/v2/*`.

### Côté Smartphone (Application Flutter)
```bash
cd remote/mobile
flutter run -d <device-id>
```
1. Ouvrez l'application **Antigravity Remote**.
2. Scannez le QR Code ou saisissez le code PIN affiché sur votre écran ou terminal.
3. L'application est immédiatement synchronisée en direct (Protocole v1 ou v2 selon le mode).

---

## ⚙️ Options & Variables de Configuration du Daemon

### Drapeaux CLI (`main.go`)

| Drapeau | Défaut | Description |
|:---|:---|:---|
| `--mode` | `auto` | Mode d'exécution : `server` (cloud autonome), `bridge` (relais IDE), ou `auto` (auto-détection). |
| `--port` | `8090` | Port d'écoute du serveur WebSocket, REST et HTTP. |
| `--host` | `0.0.0.0` | Adresse IP d'écoute de l'interface réseau. |
| `--tunnel` | `""` | Fournisseur de tunnel public (`cloudflare`, `pinggy`, `pangolin`, `ngrok`, `local`). |
| `--auth-token` | `""` | Jeton d'authentification fixe (génère un jeton CSPRNG si omis, ou `none` pour désactiver). |
| `--no-auth` | `false` | Désactive complètement l'authentification (accès libre). |
| `--allow-public-bind` | `false` | Autorise l'écoute sur les interfaces publiques non locales en mode production. |
| `--allow-first-admin` | `false` | Promeut automatiquement le premier appareil connecté comme administrateur RBAC. |
| `--approval-timeout` | `5` | Délai d'auto-rejet des approbations en minutes (`0` = désactivé). |
| `--no-approval` | `false` | Mode autonome : auto-approuve tous les appels d'outils sans attendre l'humain. |
| `--enable-remote-terminal` | `true` | Autorise la création de sessions interactives shell PTY distantes. |
| `--db-path` | `~/.antigravity/runtime.db` | Chemin de la base de données SQLite (mode serveur autonome). |
| `--workspaces-dir` | `~/.antigravity/workspaces` | Répertoire racine des projets et dépôts Git gérés par l'agent. |
| `--provider` | `auto` | Fournisseur LLM en mode autonome : `auto`, `anthropic`, `openai`, `ollama`, `proxy`. |
| `--model` | `""` | Surcharge du modèle cible (ex: `claude-3-5-sonnet-20241022`, `gpt-4o`). |
| `--sandbox` | `native` | Moteur d'isolation d'exécution : `native` (sur l'hôte) ou `docker` (conteneur isolé). |
| `--sandbox-mode` | `strict` | Stratégie d'isolation : `strict` (échec dur si indisponible), `preferred`, `native`. |
| `--docker-image` | `alpine:latest` | Image conteneur pour l'exécution d'outils quand `--sandbox=docker`. |
| `--docker-memory` | `512m` | Plafond mémoire alloué au conteneur sandbox. |
| `--docker-cpu` | `""` | Plafond CPU alloué au conteneur sandbox (ex: `1.0`, `2.0`). |
| `--webhook-url` | `""` | URLs de webhooks externes de notification (Slack, Discord, alertes POST). |

### Variables d'Environnement

| Variable | Rôle | Exemple |
|:---|:---|:---|
| `AG_AUTH_TOKEN` | Jeton d'authentification Bearer par défaut. | `secret_token_123` |
| `AG_PORT` | Port d'écoute réseau. | `8090` |
| `AG_HOST` | Interface d'écoute. | `0.0.0.0` |
| `AG_DB_PATH` | Emplacement du fichier SQLite WAL. | `/data/runtime.db` |
| `AG_WORKSPACES_DIR` | Répertoire des dépôts et workspaces. | `/workspaces` |
| `AG_REMOTE_LOG_FILE` | Chemin du fichier de journalisation rotatif JSON. | `C:/logs/remote-daemon.log` |
| `AG_REMOTE_LOG_LEVEL` | Niveau de verbosité des logs (`DEBUG`, `INFO`, `WARN`, `ERROR`). | `INFO` |

---

## 📁 Arborescence Détaillée du Projet

```
remote/
├── README.md               # Vue d'ensemble et guide d'utilisation
├── PROTOCOL.md             # Spécification exhaustive Protocole v1 (ConnectRPC) et v2 (ag-agentd)
├── TECH.md                 # Détails techniques d'infrastructure, SQLite WAL & Docker Sandbox
├── prd.md                  # Spécifications produit et exigences
├── Dockerfile              # Image Docker multi-stage pour le binaire autonome ag-agentd
├── docker-compose.yml      # Orchestration Docker Compose avec volumes persistants
│
├── daemon/                 # Daemon Bridge & Server Runtime (Go)
│   ├── main.go             # Point d'entrée CLI (20 drapeaux, modes bridge et server)
│   └── pkg/
│       ├── adb/            # Pont Android Debug Bridge (fichiers & devices)
│       ├── agent/          # Moteur agent autonome, boucle de décision & prompts
│       ├── auth/           # Gestion des tokens, rôles RBAC & anti-brute force
│       ├── connectrpc/     # Parseur et encodeur Protobuf gRPC-Web & Jetbox
│       ├── discovery/      # Découverte automatique des processus, PIN pairing & UDP Beacon
│       ├── eventstore/     # Persistance SQLite EventStore append-only avec WAL
│       ├── gateway/        # Serveur WebSocket JSON v1, Scheduler, PTY & StepRecovery
│       ├── mcp/            # Gestionnaire d'hôtes et outils Model Context Protocol
│       ├── sandbox/        # Moteur d'isolation (hôte natif ou conteneur Docker éphémère)
│       ├── server/         # Server Runtime v2, API REST (/v2/*), Web Console & Reconciler
│       ├── session/        # Gestionnaire de sessions persistantes et checkpoints
│       ├── tools/          # Registre d'outils (bash, file, search, Git) et approbations
│       ├── tunnel/         # Gestionnaire de tunnels Cloudflare / Pinggy & QR Code
│       └── workspace/      # Découverte multi-worktrees Git, isolation de branches & diffs
│
├── mobile/                 # Application Mobile (Flutter)
│   ├── README.md           # Guide d'installation, configuration et tests Flutter
│   ├── FLUTTER_SPEC.md     # Spécification d'architecture des composants Flutter
│   ├── config/             # Profils d'environnements (env_dev, env_emulator, env_prod)
│   ├── lib/
│   │   ├── core/           # Protocole DaemonApi (v1 & v2), WebSocket, Framing, Notifications
│   │   ├── features/       # 13 modules (chat_stream, workspace, battle_arena, mcp, etc.)
│   │   ├── theme/          # Palette "Quiet Console" Antigravity 2.0
│   │   └── widgets/        # AskQuestionChoiceCard, UnifiedDiffViewer, RemoteTerminalSheet
│   └── test/               # Suite complète de tests unitaires et widgets (215 tests)
│
├── proto/                  # Source canonique Protobuf (remote_service.proto, exa, google)
├── cli/                    # Client CLI de test et validation ConnectRPC (TypeScript)
└── antigravity-remote-daemon/ # Interface Electron compagnon de contrôle du daemon
```

---

## 🔐 Sécurité & Bonnes Pratiques

- **Token Authentification & PIN Éphémère** : Appairage PIN 6 chiffres à durée de validité 60s, token de session 256 bits, comparaison en temps constant (`crypto/subtle.ConstantTimeCompare`).
- **Contrôle d'Accès Basé sur les Rôles (RBAC)** : Permissions hiérarchisées (`admin`, `user`, `readonly`) appliquées à toutes les routes sensibles.
- **Isolation Sandboxing** : Exécution des commandes terminal sous conteneur Docker éphémère avec capacités Linux supprimées (`ALL`), système de fichiers racine en lecture seule et isolation réseau.
- **Anti-DNS Rebinding** : Blocage strict de toutes les origines non autorisées dans `checkOrigin`.
- **Confinement Path Traversal** : Résolution sécurisée (`resolvePath`) empêchant tout accès en dehors du workspace ou du dossier `scratch/`.
- **Garde Destructive** : Les actions irréversibles (`delete_cascade`, `git_discard`, suppression de session) exigent impérativement une confirmation explicite (`confirm: true`).

