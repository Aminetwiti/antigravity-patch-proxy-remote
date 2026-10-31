# Antigravity Remote Mobile App — Spécification & Architecture Flutter

> **Statut : Implémenté & Validé (215 tests unitaires et de widgets)**  
> **Chemin du composant :** `remote/mobile`  
> **Framework :** Flutter (Dart 3.x)

---

## 1. Architecture Modulaire (`lib/`)

```
remote/mobile/
├── lib/
│   ├── main.dart                      # Point d'entrée & routage global de l'application
│   ├── config/                        # Constantes et gestionnaires d'environnements
│   │   ├── env_config.dart            # Multi-environnements (dev, emulator, prod)
│   │   └── constants.dart             # Chemins d'API, timeouts, clés de stockage
│   ├── theme/                         # Système de Design Antigravity 2.0
│   │   ├── app_colors.dart            # Palette "Quiet Console" Zinc Dark tokens
│   │   ├── app_typography.dart        # Typographies système et styles monospace
│   │   └── app_theme.dart             # Définition ThemeData MaterialApp
│   ├── core/                          # Réseau de bas niveau & Protocoles
│   │   ├── discovery/                 # Découverte réseau LAN UDP (port 41234)
│   │   ├── network/                   # Client WebSocket résilient & file d'attente Outbox
│   │   ├── notifications/             # Service d'alertes locales de l'OS
│   │   └── protocol/                  # DaemonApi typed client, protocol models & framing
│   ├── features/                      # 13 Modules Fonctionnels
│   │   ├── artifacts/                 # Modal & cartes d'artefacts (Markdown, diffs, carrousels, LaTeX)
│   │   ├── battle_arena/              # Mode Colosseum (duels multi-modèles, diffs et vote)
│   │   ├── chat_stream/               # Streaming LLM, barre de prompt & macros
│   │   ├── code_review/               # Modal de revue de code en ligne et annotations
│   │   ├── diagnostics/               # Diagnostic de latence, profiling & flight recorder
│   │   ├── discovery/                 # Appairage par QR scanner ou code PIN 6 chiffres
│   │   ├── mcp/                       # Explorateur des serveurs MCP et gestion OAuth
│   │   ├── scheduled_tasks/           # Dashboard des cron jobs & déclenchement manuel
│   │   ├── sessions/                  # Tiroir de sessions, historique & retour d'étapes (revert)
│   │   ├── settings/                  # Profil, timeouts, auto-accept & révocation d'appareils
│   │   ├── sidecars/                  # Visualiseur de logs et contrôle de sidecars
│   │   ├── subagents/                 # Arborescence et suivi des sous-agents
│   │   └── workspace/                 # Explorateur de fichiers, recherche sémantique & Git worktrees
│   └── widgets/                       # Composants UI interactifs
│       ├── ask_question_choice_card.dart # QCM tactile pour choix d'agent
│       ├── chat_input_bar.dart           # Barre de saisie avec téléversement multimédia
│       ├── conflict_dialog.dart          # Résolution visuelle des conflits Git
│       ├── remote_terminal_sheet.dart    # Émulateur de terminal PTY interactif
│       ├── tool_approval_card.dart       # Carte d'approbation d'outils (allow/deny)
│       └── unified_diff_viewer.dart      # Visualiseur de diffs syntaxiques colorisés
└── test/                              # 215 tests unitaires et de widgets
```

---

## 2. Palette Graphique Antigravity 2.0 ("The Quiet Console")

Définition des tokens de couleur officiels répliqués depuis `htmlcss.log` :

```dart
import 'package:flutter/material.dart';

abstract class AppColors {
  // Surfaces (Zinc Dark Console)
  static const Color surfaceBase = Color(0xFF18181B);   // #18181b
  static const Color surfaceRaised = Color(0xFF1C1C1F); // #1c1c1f
  static const Color surfaceInput = Color(0xFF27272A);  // #27272a

  // Bordures
  static const Color borderSubtle = Color(0xFF27272A);  // #27272a
  static const Color borderStrong = Color(0xFF3F3F46);  // #3f3f46

  // Typographie / Encres
  static const Color inkPrimary = Color(0xFFF4F4F5);   // #f4f4f5
  static const Color inkSecondary = Color(0xFFA1A1AA); // #a1a1aa
  static const Color inkMuted = Color(0xFF71717A);     // #71717a

  // Actions & Accents
  static const Color accentBlue = Color(0xFF3B82F6);     // #3b82f6
  static const Color accentBlueDeep = Color(0xFF2563EB); // #2563eb
  static const Color positive = Color(0xFF22C55E);       // #22c55e (Approuvé / Connecté)
  static const Color warning = Color(0xFFEAB308);        // #eab308 (Attente validation)
  static const Color danger = Color(0xFFEF4444);         // #ef4444 (Refusé / Erreur)

  // Fournisseurs de Modèles
  static const Color providerOpenAI = Color(0xFF10A37F);
  static const Color providerAnthropic = Color(0xFFD97757);
  static const Color providerGoogle = Color(0xFF4285F4);
  static const Color providerOllama = Color(0xFFF0F0F0);
  static const Color providerOpenRouter = Color(0xFFFF7A45);
  static const Color providerCustom = Color(0xFFA855F7);
}
```

---

## 3. Matrice des Fonctionnalités Implémentées

| Module | Fonctionnalité Clé | Endpoint RPC / Action WebSocket |
|:---|:---|:---|
| **Discovery** | Appairage par PIN 6 chiffres & QR | `POST /pair`, UDP Beacon `41234` |
| **Sessions** | Création / Switch / Historique / Revert | `create_cascade`, `list_sessions`, `revert_to_step` |
| **Chat Stream** | Streaming temps réel & Multimodal | `send_prompt` (`stream_delta`, `stream_end`) |
| **Tool Approval** | Validation interactive des outils | `submit_approval` (`decision: allow\|deny`) |
| **Ask Question** | QCM tactile unique / multiple | `submit_question_response` |
| **Terminal PTY** | Console interactive shell | `terminal_create`, `terminal_write`, `terminal_kill` |
| **Workspace** | Explorateur & Git Worktrees | `list_files`, `read_file`, `checkout_git_worktree` |
| **Code Review** | Diffs unifiés & Annotations | `get_turn_diff`, `UnifiedDiffViewer` |
| **Battle Arena** | Mode Colosseum multi-modèles | `start_battle_mode`, `end_battle_mode` |
| **Cron Dashboard**| Surveillance des tâches périodiques | `list_scheduled_tasks`, `trigger_scheduled_task` |
| **MCP Explorer** | Serveurs MCP & flux OAuth | `refresh_mcp_servers`, `complete_mcp_oauth` |
| **Diagnostics** | Profiling & dump flight recorder | `dump_flight_recorder`, `GET /health/diagnostic` |

---

## 4. Profils d'Environnement Dart Defines

L'application prend en charge 3 configurations cibles via `--dart-define-from-file` :

1. **`config/env_dev.json`** (Réseau Local Wi-Fi) :
   ```json
   {
     "ENVIRONMENT": "development",
     "DAEMON_HOST": "192.168.1.50",
     "DAEMON_PORT": 8090,
     "USE_SSL": false,
     "ENABLE_LOGGING": true
   }
   ```

2. **`config/env_emulator.json`** (Émulateur Android) :
   ```json
   {
     "ENVIRONMENT": "emulator",
     "DAEMON_HOST": "10.0.2.2",
     "DAEMON_PORT": 8090,
     "USE_SSL": false,
     "ENABLE_LOGGING": true
   }
   ```

3. **`config/env_prod.json`** (Tunnel WAN Sécurisé) :
   ```json
   {
     "ENVIRONMENT": "production",
     "DAEMON_HOST": "antigravity-remote.domain.com",
     "DAEMON_PORT": 443,
     "USE_SSL": true,
     "ENABLE_LOGGING": false
   }
   ```
