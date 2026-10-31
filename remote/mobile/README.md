# Antigravity Remote Mobile Companion (Flutter) 📱

> Application mobile d'orchestration et de supervision à distance pour **Google Antigravity IDE**. Contrôlez vos cascades d'agents, validez les actions bloquantes, révisez les diffs et pilotez vos terminaux depuis votre smartphone (Android & iOS).

---

## 🌟 Fonctionnalités

- **Streaming Temps Réel "Quiet Console"** : Suivi des réflexions et réponses textuelles des agents avec rendu Markdown complet et blocs de code colorisés.
- **Validation d'Actions Tactile (`SubmitToolApproval`)** : Approbation ou refus en 1 tap des commandes shell (`run_command`) et modifications de fichiers avec portée ponctuelle (`once`) ou permanente (`session`).
- **QCM & Choix Multiples Interactifs (`AskQuestionChoiceCard`)** : Réponse directe aux bifurcations décisionnelles de l'agent.
- **Terminal PTY Distant (`RemoteTerminalSheet`)** : Émulateur de terminal shell complet interactif connecté directement au PC hôte.
- **Revue de Code & Diffs Unifiés (`UnifiedDiffViewer`)** : Affichage colorisé des deltas de code, sélection de lignes et ajout de commentaires de revue.
- **Mode Duel Multi-Modèles (`BattleArenaScreen`)** : Supervision des sessions Colosseum A vs B, comparaison de branches et vote d'arbitrage.
- **Explorateur de Workspace & VCS** : Navigation dans l'arborescence, recherche sémantique (RAG), changement de branches et worktrees Git.
- **Gestionnaire MCP & Sidecars** : Inspection des serveurs Model Context Protocol, déclenchement d'outils et journaux de processus sidecar.
- **Tâches Planifiées (Cron Dashboard)** : Surveillance et déclenchement manuel des tâches agents récurrentes.
- **Appairage Zero-Config** : Découverte automatique LAN par Beacon UDP (`41234`), scan de QR Code ou saisie d'un code PIN à 6 chiffres.

---

## 🛠️ Prérequis

- **Flutter SDK** : `3.19.x` ou supérieur (Dart 3.x).
- **Plateformes cibles** : Android (SDK 24+) / iOS (iOS 14+).
- **Daemon Antigravity Remote** : Tournant sur le PC hôte (`remote/daemon`).

---

## 🚀 Démarrage & Exécution

### 1. Installation des Dépendances
```bash
cd remote/mobile
flutter pub get
```

### 2. Profils d'Environnement

Trois configurations d'environnement sont fournies dans le dossier `config/` :
- `config/env_dev.json` : Réseau local Wi-Fi direct (`192.168.1.50:8090`).
- `config/env_emulator.json` : Émulateur Android local (`10.0.2.2:8090`).
- `config/env_prod.json` : Accès distant sécurisé via Cloudflare Tunnel (`antigravity-remote.domain.com:443`).

### 3. Lancement de l'Application

```bash
# Lancement sur appareil connecté (détection auto du daemon via LAN/QR)
flutter run

# Lancement avec profil d'environnement spécifique
flutter run --dart-define-from-file=config/env_dev.json

# Lancement sur émulateur Android
flutter run --dart-define-from-file=config/env_emulator.json -d emulator-5554
```

---

## 🧪 Tests & Analyse Statique

La suite de tests comprend **215 tests unitaires et de widgets** garantissant la conformité du protocole et la fluidité des composants graphiques :

```bash
# Analyse statique du code (0 erreurs attendu)
flutter analyze

# Exécution de tous les tests unitaires et de widgets
flutter test --exclude-tags=live

# Exécution d'un test spécifique
flutter test test/chat_stream_test.dart
```

---

## 📁 Architecture Modulaire (`lib/`)

```
lib/
├── config/                  # Constantes d'environnement & configuration
├── core/                    # Infrastructure réseau & protocoles de bas niveau
│   ├── discovery/           # Client UDP auto-discovery & scanner LAN
│   ├── network/             # Client WebSocket résilient & Outbox queue
│   ├── notifications/       # Gestionnaire d'alertes push locales
│   └── protocol/            # DaemonApi typed client, protocol models & framing
│
├── features/                # Modules applicatifs autonomes
│   ├── artifacts/           # Visionneuse d'artefacts (Markdown, diffs, carrousels, LaTeX)
│   ├── battle_arena/        # Supervision du mode Colosseum (duels multi-modèles)
│   ├── chat_stream/         # Chat temps réel, injection de prompts & approbations
│   ├── code_review/         # Modal de commentaire et revue de code en ligne
│   ├── diagnostics/         # Profiling, flight recorder & santé du daemon
│   ├── discovery/           # Scanner QR, saisie PIN & gestion d'appairage
│   ├── mcp/                 # Explorateur de serveurs et outils MCP
│   ├── scheduled_tasks/     # Dashboard des tâches cron et exécutions planifiées
│   ├── sessions/            # Drawer de sessions, historique de trajectoires & switch
│   ├── settings/            # Préférences de profil, timeouts, thèmes & révocation
│   ├── sidecars/            # Contrôle et logs des processus sidecar
│   ├── subagents/           # Arborescence et suivi des sous-agents
│   └── workspace/           # Explorateur de fichiers, recherche RAG & Git worktrees
│
├── theme/                   # Tokens graphiques "Quiet Console" Antigravity 2.0
│   ├── app_colors.dart      # Tokens de couleur officiels (#101010, #21252B, #528BFF)
│   └── app_typography.dart  # Typographies système et styles monospace
│
└── widgets/                 # Composants UI réutilisables
    ├── ask_question_choice_card.dart # QCM tactile pour les bifurcations d'agent
    ├── chat_input_bar.dart           # Barre de saisie avec sélecteur d'images et macros
    ├── remote_terminal_sheet.dart    # Émulateur de terminal PTY interactif
    ├── tool_approval_card.dart       # Carte d'approbation d'outils (allow/deny)
    └── unified_diff_viewer.dart      # Visualiseur de diffs syntaxiques avec coloration
```

---

## 🎨 Tokens de Design ("The Quiet Console")

L'application reproduit exactement les tokens visuels extraits des feuilles de style calculées d'Antigravity IDE 2.0 (`htmlcss.log`) :
- **Fond principal (Canvas)** : `#101010` (`surfaceBase: #18181B`)
- **Panneaux & Barres latérales** : `#21252B` (`surfaceRaised: #1C1C1F`)
- **Champs de saisie** : `#27272A`
- **Bordures subtiles** : `#27272A` / **Bordures fortes** : `#3F3F46`
- **Accents de focus / Liens** : `#528BFF` / `#3B82F6`
- **Succès / Validation** : `#22C55E`
- **Alerte / Attente** : `#EAB308`
- **Danger / Erreur** : `#EF4444`
