# Plans d'Implémentation — Par Sous-Projet

> Plans d'exécution et état d'avancement par composant. Chaque sous-projet est validé de bout en bout avant transition.

---

## 🗺️ Matrice d'Avancement Global

```
Plan A (CLI de Validation)     ✅ TERMINÉ & VALIDÉ
           │
           ▼
Plan B (Daemon Bridge Go)       ✅ TERMINÉ & VALIDÉ (243 tests)
           │
           ▼
Plan C (Mobile Flutter)         ✅ TERMINÉ & VALIDÉ (215 tests)
           │
           ▼
Plan D (Infrastructure & WAN)   ✅ OPÉRATIONNEL (Cloudflare / Pinggy / UDP Beacon)
```

---

## Plan A — CLI de Validation (Terminé ✅)

**Objectif :** Prouver que le contrôle RPC du `language_server` est possible en local.  
**Statut :** ✅ Validé (Phase 1).

### Étapes Validées
| # | Étape | Statut | Résultat |
|:--|:---|:---:|:---|
| A1 | Découverte du processus (PID + port + CSRF) | ✅ | Extraction WMI/CIM opérationnelle |
| A2 | Client gRPC-Web manuel (framing, headers) | ✅ | Framing binaire standard validé |
| A3 | Encodage protobuf manuel (StartCascade, SendMessage) | ✅ | Décodage/Encodage varint sans bibliothèque |
| A4 | Création de session + envoi de prompt | ✅ | Création de cascade et réception stream |
| A5 | Liste des sessions (`GetAllCascadeTrajectories`) | ✅ | Lecture des trajectoires du Hub |
| A6 | Gestion des modèles (`GetAvailableModels`) | ✅ | Catalogue de modèles reçu |
| A7 | Workspace tree + lecture de fichiers | ✅ | Navigation arborescente locale |

---

## Plan B — Daemon Bridge Go (Terminé ✅)

**Objectif :** Pont WebSocket haute performance entre le client mobile et le `language_server`.  
**Statut :** ✅ Validé — 243 tests unitaires et de propriétés (`go test ./...`).

### Étapes Validées
| # | Étape | Statut | Résultat |
|:--|:---|:---:|:---|
| B1 | Découverte automatique (`pkg/discovery`) | ✅ | Probe Heartbeat & ciblage Hub (`--subclient_type hub`) |
| B2 | Client gRPC-Web Go (`pkg/connectrpc`) | ✅ | Wire protocol binaire et framing gRPC-Web |
| B3 | Gateway WebSocket JSON (`pkg/gateway`) | ✅ | Routeur de 70+ actions WebSocket |
| B4 | Streaming `SendUserCascadeMessage` | ✅ | Streaming multi-frames temps réel |
| B5 | Validation d'outils (`SubmitToolApproval`) | ✅ | Approbation/Rejet `submit_approval` avec portée `once`/`session` |
| B6 | StepRecovery Buffer (Résilience réseau) | ✅ | Buffer circulaire FIFO de 100 deltas par cascade |
| B7 | Watchdog CSRF | ✅ | Surveillance 10s et ré-authentification automatique |
| B8 | Sécurité & Anti-Rebinding | ✅ | Validation d'origine stricte, tokens en temps constant |
| B9 | Appairage par PIN 6 chiffres (`POST /pair`) | ✅ | Rotation 60s, lockout anti-brute force, token 256 bits |
| B10 | Flux Temps Réel Dédiés | ✅ | Jetbox Summaries (Connect JSON) & StreamReactiveUpdates |
| B11 | Terminal PTY & Service ADB | ✅ | PTY interactif et pont Android Debug Bridge complet |

---

## Plan C — Application Mobile Flutter (Terminé ✅)

**Objectif :** Télécommande mobile complète (iOS & Android) avec design "Quiet Console".  
**Statut :** ✅ Validé — 215 tests unitaires et widgets (`flutter test --exclude-tags=live`).

### Étapes Validées
| # | Étape | Statut | Résultat |
|:--|:---|:---:|:---|
| C1 | Client Protocolaire Typé (`DaemonApi`) | ✅ | Gestion WebSocket, Outbox queue et reconnexion |
| C2 | Design System "Quiet Console" | ✅ | Tokens de couleurs extraits d'Antigravity 2.0 (`htmlcss.log`) |
| C3 | Chat Stream & Markdown Bubble | ✅ | Rendu Markdown, blocs de code syntaxiques, LaTeX et LaTeX Math |
| C4 | Validation d'Actions Tactile | ✅ | Cartes interactives `ToolApprovalCard` avec portée et auto-deny |
| C5 | QCM Interactif (`AskQuestionChoiceCard`) | ✅ | Choix unique / multiple en 1 tap |
| C6 | Revue de Code (`UnifiedDiffViewer`) | ✅ | Visualiseur de diffs colorisés et commentaires en ligne |
| C7 | Terminal PTY Distant (`RemoteTerminalSheet`) | ✅ | Shell interactif connecté en direct |
| C8 | Mode Colosseum (`BattleArenaScreen`) | ✅ | Supervision de duels de modèles A vs B et vote |
| C9 | Tâches Planifiées (`ScheduledTasksScreen`) | ✅ | Dashboard des cron jobs et déclenchements manuels |
| C10 | Découverte Zero-Config & Appairage | ✅ | Client UDP Beacon (`41234`), QR Scanner et saisie PIN |

---

## Plan D — Infrastructure, Tunneling & Résilience (Opérationnel ✅)

| # | Étape | Statut | Description |
|:--|:---|:---:|:---|
| D1 | Packaging Daemon | ✅ | Binaire autonome Go (~10 MB compilé) |
| D2 | Tunnels WAN Automatisés | ✅ | Cloudflare Quick Tunnel (`trycloudflare.com`) & Pinggy SSH |
| D3 | Découverte LAN Zero-Config | ✅ | Annonce UDP périodique (`DiscoveryPort: 41234`) |
| D4 | Auto-Heal & Supervision | ✅ | Scripts PowerShell `auto-heal.ps1` et `supervise-daemon.ps1` |
| D5 | Profils Multi-Environnements | ✅ | Fichiers Dart Defines `env_dev.json`, `env_emulator.json`, `env_prod.json` |
