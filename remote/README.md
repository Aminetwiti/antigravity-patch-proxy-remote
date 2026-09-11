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

### 1. Côté PC (Démarrage du Daemon)
```bash
cd remote/daemon
go run main.go --port 8090 --tunnel cloudflare --auth-token mysecret
# Ou lancer directement le binaire compilé
./daemon.exe --port 8090 --tunnel cloudflare
```
Le Daemon découvre automatiquement le port actif du `language_server.exe` d'Antigravity, démarre le Watchdog CSRF, ouvre le tunnel public et génère un **QR Code d'appairage** et un **code PIN à 6 chiffres** dans le terminal.

### 2. Côté Smartphone (Application Flutter)
```bash
cd remote/mobile
flutter run -d <device-id>
```
1. Ouvrez l'application **Antigravity Remote**.
2. Scannez le QR Code ou saisissez le code PIN affiché sur votre écran de PC.
3. L'application est immédiatement synchronisée : vos conversations actives, alertes de commandes et formulaires de choix apparaissent en direct.

---

## ⚙️ Options & Variables de Configuration du Daemon

### Drapeaux CLI (`main.go`)
| Drapeau | Défaut | Description |
|:---|:---|:---|
| `--port` | `8090` | Port d'écoute du serveur WebSocket et HTTP. |
| `--host` | `0.0.0.0` | Adresse IP d'écoute de l'interface réseau. |
| `--tunnel` | `""` | Fournisseur de tunnel (`cloudflare`, `pinggy`, `ngrok`). |
| `--auth-token` | `""` | Jeton d'authentification fixe optionnel pour le client mobile. |
| `--approval-timeout` | `5` | Délai d'auto-rejet des approbations en minutes (`0` = désactivé). |

### Variables d'Environnement
| Variable | Rôle | Exemple |
|:---|:---|:---|
| `AG_REMOTE_LOG_FILE` | Chemin du fichier de journalisation rotatif JSON. | `C:/logs/remote-daemon.log` |
| `AG_REMOTE_LOG_LEVEL` | Niveau de verbosité des logs (`DEBUG`, `INFO`, `WARN`, `ERROR`). | `INFO` |

---

## 📁 Arborescence Détaillée du Projet

```
remote/
├── README.md               # Vue d'ensemble et guide d'utilisation
├── PROTOCOL.md             # Spécification exhaustive ConnectRPC, HTTP, UDP & WebSocket
├── TECH.md                 # Détails techniques d'infrastructure
├── prd.md                  # Spécifications produit et exigences
│
├── daemon/                 # Daemon Bridge (Go)
│   ├── main.go             # Point d'entrée CLI
│   └── pkg/
│       ├── adb/            # Pont Android Debug Bridge (fichiers & devices)
│       ├── connectrpc/     # Parseur et encodeur Protobuf gRPC-Web & Jetbox
│       ├── discovery/      # Découverte automatique des processus, PIN pairing & UDP Beacon
│       ├── gateway/        # Serveur WebSocket JSON, Scheduler, PTY & StepRecovery
│       └── tunnel/         # Gestionnaire de tunnels SSH / Cloudflare & QR Code
│
├── mobile/                 # Application Mobile (Flutter)
│   ├── README.md           # Guide d'installation, configuration et tests Flutter
│   ├── FLUTTER_SPEC.md     # Spécification d'architecture des composants Flutter
│   ├── config/             # Profils d'environnements (env_dev, env_emulator, env_prod)
│   ├── lib/
│   │   ├── core/           # Protocole DaemonApi, WebSocket, Framing, Notifications
│   │   ├── features/       # 13 modules (chat_stream, workspace, battle_arena, mcp, etc.)
│   │   ├── theme/          # Palette "Quiet Console" Antigravity 2.0
│   │   └── widgets/        # AskQuestionChoiceCard, UnifiedDiffViewer, RemoteTerminalSheet
│   └── test/               # Suite complète de tests unitaires et widgets (215 tests)
│
└── tools/                  # Références et schémas canoniques gRPC / Protobuf
```

---

## 🔐 Sécurité & Bonnes Pratiques

- **Token Authentification & PIN Éphémère** : Appairage PIN 6 chiffres à durée de validité 60s, token de session 256 bits, comparaison en temps constant (`crypto/subtle.ConstantTimeCompare`).
- **Anti-DNS Rebinding** : Blocage strict de toutes les origines non autorisées dans `checkOrigin`.
- **Confinement Path Traversal** : Résolution sécurisée (`resolvePath`) empêchant tout accès en dehors du workspace ou du dossier `scratch/`.
- **Garde Destructive** : Les actions irréversibles (`delete_cascade`, `git_discard`) exigent impérativement une confirmation applicative explicite (`confirm: true`).
