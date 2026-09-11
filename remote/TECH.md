# Stack Technique — Antigravity Remote Control OS

> Décisions technologiques, justifications et contraintes. Chaque choix est validé par le terrain (tests réels sur machine), pas par la théorie.

---

## 1. Vue d'ensemble

| Composant | Choix | Justification |
|:---|:---|:---|
| **Daemon Bridge (PC)** | Go 1.22 — binaire unique | Même langage que le `language_server` (Go), stdlib `net/http`, aucun runtime requis, binaire ~10 MB |
| **Client mobile** | Flutter (Dart) / Android & iOS | Base de code multi-plateforme, rendu réactif 120 Hz, composants UI "Quiet Console", persistance locale |
| **Transport PC ↔ Mobile** | WebSocket (JSON) | Typage strict, streaming temps réel, bidirectionnel, support natif |
| **Accès réseau distant** | Cloudflare Tunnel / Pinggy SSH | Zero Trust, URL publique sécurisée en 1 seconde sans port ouvert sur le routeur |
| **Découverte LAN locale** | UDP Broadcast (Zero-Config) | Annonces périodiques sur le port UDP `41234` sans transmission de secrets |
| **Sérialisation RPC interne** | ConnectRPC / gRPC-Web natif | Communication directe avec le `language_server` sans intermédiaire |
| **Source de Vérité Protobuf** | `remote/proto/` | Référence canonique des schémas Protobuf officiels |
| **Persistance Événements (Cloud)** | SQLite WAL (`modernc.org/sqlite`) | CGO-free, append-only EventStore, checkpoints WAL, zéro dépendance dynamique |
| **Sandboxing Outils (Cloud)** | Docker Conteneurisé (`alpine:latest`) | Éphémère, capacités `ALL` supprimées, filesystem RO, réseau coupé |
| **Console d'Administration Web** | Single-Page Application embarquée | HTML/JS vanilla servi sur `/console` sans dépendance CDN externe |

---

## 2. Source de Vérité Protobuf & Référence Officielle

L'ensemble des définitions de services et schémas Protobuf est consigné dans :
1. **Schémas gRPC & Protobuf canoniques** : [`remote/proto/remote_service.proto`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/proto/remote_service.proto) ainsi que les définitions annexes sous [`remote/proto/exa/`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/proto/exa) et [`remote/proto/google/`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/proto/google).
2. **Schémas de sessions et planners** :
   - `StartCascadeRequest`, `CascadeConfig`, `CascadePlannerConfig`.
   - `TextOrScopeItem`, `Metadata`, `ModelOrAlias`.
   - Trajectoires, étapes et résumés.
3. **Flux Temps Réel Hybrides** :
   - **`JetboxSubscribeToSummaries`** : flux push JSON ConnectRPC alimentant la sidebar de sessions sans polling.
   - **`StreamReactiveUpdates`** : flux réactif de notification d'état (`IDLE`, `RUNNING`, `CANCELING`) et d'interactions (`requestedInteraction`).
   - **WebSocket v2 Multiplexé** (`/v2/ws`) : flux authoritaire avec curseur de rejeu `lastSequence`.

---

## 3. Couche 1 — PC : Daemon Bridge (Go)

### 3.1 Pourquoi Go
- Le moteur cible (`language_server`) est **écrit en Go** → mêmes primitives de goroutines et de sockets.
- **Binaire unique autonome** sans dépendance système externe (~10 MB compilé).
- Performance maximale et empreinte mémoire négligeable (< 25 MB RAM).

### 3.2 Protocole RPC : gRPC-Web natif & Jetbox
- Le serveur attend du **`application/grpc-web+proto`** pour les appels unaires et le streaming de prompts.
- Flux Jetbox et réactif en **`application/connect+json`**.
- Header d'auth obligatoire : **`x-codeium-csrf-token`** (héritage Codeium).
- Framing standard : `1 octet flags + 4 octets longueur Big-Endian + charge utile`.

### 3.3 Découverte automatique du moteur
1. Scanner les processus `language_server*` via WMI / CIM.
2. **Cibler l'instance hub** (`--subclient_type hub`) — les instances IDE retournent 404 sur les routes de session.
3. Résoudre les ports TCP via `netstat -ano`.
4. **Probe Heartbeat** : validation par `POST /exa.language_server_pb.LanguageServerService/Heartbeat` → HTTP 200.

---

## 4. Couche 2 — Transport Réseau & Résilience

### 4.1 Sécurité des Communications
- **Token d'authentification** vérifié en temps constant (`crypto/subtle.ConstantTimeCompare`).
- **Appairage par code PIN 6 chiffres** (validité 60s) via `POST /pair` avec lockout après 5 échecs.
- **Anti-DNS Rebinding** strict dans `checkOrigin` (autorisant uniquement `127.0.0.1`, LAN privé et tunnels certifiés).
- **Confinement Path Traversal** dans `resolvePath` et `saveUploadedImage`.

### 4.2 StepRecovery & Buffer Circulaire
- Buffer circulaire de **100 deltas** en mémoire vive par cascade.
- Synchronisation delta immédiate via `sync_session(lastStepIndex)` lors des reconnexions Wi-Fi / 4G.

---

## 5. Couche 3 — Mobile : Application Flutter

### 5.1 Architecture Applicative
- **Dart / Flutter** pour une expérience multiplateforme unifiée (Android / iOS).
- Rendu réactif 120 Hz, composants tactiles dédiés (`AskQuestionChoiceCard`, `UnifiedDiffViewer`, `RemoteTerminalSheet`, `ChatInputBar`).
- File d'attente locale (Outbox) garantissant l'envoi dès le retour de la connexion réseau.
- Gestion d'environnements multiples via `--dart-define-from-file` (`config/env_dev.json`, `env_emulator.json`, `env_prod.json`).

---

## 6. Références & Liens Documentaires

- Documentation Protocole : [PROTOCOL.md](file:///C:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/PROTOCOL.md)
- Guide d'utilisation : [README.md](file:///C:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/README.md)
- Répertoire d'outils et de schémas : [remote/tools/](file:///C:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/remote/tools/README.md)
