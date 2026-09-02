# 🔬 Fiches Techniques Systèmes : Antigravity IDE & Moteur Jetski/Cortex

> **Dossier d'Ingénierie Forensique & Spécifications de Bas Niveau**  
> Ce document regroupe **5 fiches techniques détaillées** décrivant les structures binaires, les algorithmes de décodage, les schémas de base de données, la sécurité des outils et les protocoles d'exécution d'**Antigravity IDE**.

---

# 📑 FICHE TECHNIQUE #1 : Moteur de Streaming & Protocole Réseau gRPC-Web

### 1.1 Encapsulation Binaire de la Trame ConnectRPC
Chaque fragment transmis sur le flux HTTP/1.1 ou HTTP/2 utilise le format de trame standardisé :

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     FLAGS     |                  LENGTH (L)                   |
|   (1 octet)   |              (4 octets Big-Endian)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                        PAYLOAD PROTOBUF                       +
|                           (L octets)                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Flags (Octet 0)** :
  - `0x00` (`Data Frame`) : Contient un message Protobuf sérialisé (`StreamCascadeResponse`).
  - `0x80` (`Trailer Frame`) : Contient les métadonnées de fin d'appel (Statut gRPC `grpc-status: 0`, message d'erreur, tokens totaux consommés).
- **Length (Octets 1-4)** : Entier non signé 32 bits en ordre gros-boutiste (Big Endian) indiquant la taille exacte du payload.

---

### 1.2 Table de Décodage des Événements de Streaming (`StreamCascadeResponse`)

| Numéro de Champ Protobuf | Wire Type | Type Go / Dart | Signification & Rôle |
|:---|:---|:---|:---|
| **Field 1** | WireType 2 (Length-delimited) | `string` | `cascade_id` (UUID unique de la session). |
| **Field 2** | WireType 2 (Length-delimited) | `Message` | `interaction_event` (Événement d'interaction utilisateur / demande d'approbation d'outil). |
| **Field 3** | WireType 0 (Varint) | `uint32` | `step_index` (Index chronologique de l'étape courante). |
| **Field 5** | WireType 2 (Length-delimited) | `string` | `text_delta` (Fragment de texte en cours de génération). |
| **Field 6** | WireType 2 (Length-delimited) | `string` | `thought_delta` (Pensée / raisonnement interne de l'agent). |
| **Field 7** | WireType 2 (Length-delimited) | `Message` | `tool_call_start` (Début d'exécution d'un outil : nom de l'outil, callId, arguments partiels). |
| **Field 8** | WireType 2 (Length-delimited) | `Message` | `tool_call_output` (Sortie stdout/stderr retournée par l'outil exécuté). |
| **Field 9** | WireType 0 (Varint) | `enum` | `status` (`1=RUNNING`, `2=DONE`, `3=ERROR`, `4=WAITING_USER_INPUT`). |

---

# 📑 FICHE TECHNIQUE #2 : Persistance, SQLite & Checkpoints de Contexte

### 2.1 Schéma Exhaustif de la Base SQLite (`conversations/<id>.db`)

```sql
-- Table principale des étapes de dialogue
CREATE TABLE steps (
    idx INTEGER PRIMARY KEY,           -- Numéro d'étape (0, 1, 2, ...)
    step_type INTEGER NOT NULL,        -- 1: USER_INPUT, 2: PLANNER_RESPONSE, 3: TOOL_CALL, 4: CHECKPOINT
    status INTEGER NOT NULL,           -- 0: PENDING, 1: DONE, 2: ERROR, 3: CANCELLED
    has_subtrajectory NUMERIC,         -- 0 (False) ou 1 (True pour sous-agents imbriqués)
    metadata BLOB,                     -- Protobuf sérialisé des métadonnées du modèle
    error_details BLOB,                -- Protobuf d'erreur si status = 2
    permissions BLOB,                  -- Autorisations de sécurité accordées
    task_details BLOB,                 -- Données de suivi de tâche
    render_info BLOB,                  -- Informations de rendu UI
    step_payload BLOB,                 -- Contenu complet du tour (Prompt / Réponse / Diff)
    step_format INTEGER DEFAULT 0      -- 0: Markdown standard, 1: Rich Blocks
);

-- Table des métadonnées globales de la session
CREATE TABLE trajectory_meta (
    trajectory_id TEXT PRIMARY KEY,    -- UUID de la session
    workspace_root TEXT,               -- URI du projet (file:///c:/...)
    created_timestamp INTEGER,         -- Timestamp UNIX (millisecondes)
    last_modified_timestamp INTEGER,   -- Timestamp UNIX de dernière écriture
    title TEXT,                        -- Titre automatique résumé par l'IA
    active_model_uid TEXT              -- Modèle utilisé (ex: gemini-2.5-flash)
);
```

---

### 2.2 Mécanisme de Tronquage & Résumé Automatique (`CHECKPOINT`)

Quand le contexte d'une conversation dépasse la fenêtre maximale (ex: 32 000 tokens) :
1. Le Language Server exécute un modèle compact (Gemini Flash) en tâche de fond pour résumer les tours `0` à `N-1`.
2. Il écrit une étape de type `CHECKPOINT` dans `transcript.jsonl` :
   ```json
   {
     "step_index": 3,
     "source": "SYSTEM",
     "type": "CHECKPOINT",
     "status": "DONE",
     "content": "{{ CHECKPOINT 0 }}\n# USER Objective: ...\n# User Requests ...\n# Conversation Logs: ..."
   }
   ```
3. Les prochains appels LLM n'envoient que le bloc `CHECKPOINT` et les tours récents, réduisant la consommation de contexte de **80%**.

---

# 📑 FICHE TECHNIQUE #3 : Sécurité des Outils, Approbations & Permissions

### 3.1 Matrice des Outils & Niveaux de Privilèges

| Nom de l'Outil | Catégorie | Action Réalisée | Niveau d'Approbation par Défaut |
|:---|:---|:---|:---|
| `view_file` | Lecture | Lit le contenu d'un fichier du workspace | **Automatique** (Sans confirmation) |
| `list_dir` | Lecture | Liste les dossiers et métadonnées de fichiers | **Automatique** (Sans confirmation) |
| `search_web` | Réseau | Effectue une recherche Google / Documentation | **Automatique** (Sans confirmation) |
| `write_to_file` | Écriture | Crée ou écrase un fichier complet | **Approbation Requise** (Sauf mode confiance) |
| `replace_file_content` | Écriture | Modifie un bloc de lignes contigu dans un fichier | **Approbation Requise** |
| `run_command` | Exécution | Lance une commande PowerShell / Bash | **Approbation Stricte Requise** |
| `ask_question` | Interaction | Pose une question à choix multiples à l'utilisateur | **Attente de réponse utilisateur** |

---

### 3.2 Protocole de Validation d'Outil (`HandleCascadeUserInteraction`)

```
   Language Server                     Daemon Go                     Flutter Mobile
          │                                │                                │
          │─── stream: approval_required ─►│─── ws: approval_required ─────►│
          │    (callId, tool, command)     │    (Affichage Carte UI)        │
          │                                │                                │
          │                                │◄─── ws: submit_approval ───────│
          │                                │     (decision: APPROVE/REJECT) │
          │◄── HandleCascadeUserInteraction│                                │
          │    (oneof: APPROVE)            │                                │
          │                                │                                │
          │─── Exécute l'outil             │                                │
          │─── stream: tool_output ───────►│─── ws: tool_output ───────────►│
```

Payload binaire d'approbation d'outil :
- **Field 1** : `cascade_id` (string)
- **Field 2** (Message Interaction) :
  - `Field 1` : `trajectory_id` (UUID)
  - `Field 2` : `step_index` (uint32)
  - `Field 5` : Oneof `approved` (bool: `true`/`false`)

---

# 📑 FICHE TECHNIQUE #4 : Algorithme de Découverte des Instances Actives

### 4.1 Organigramme de Détection Dynamique (Zéro Port Fixe)

```
[DÉMARRAGE DU DAEMON GO]
         │
         ▼
[1. Scan Processus WMI / Win32]
Cherche "language_server_windows_x64.exe"
Extrait : PID, --csrf_token, --extension_server_port, --app_data_dir
         │
         ▼
[2. Extraction des Ports d'Écoute Netstat]
Get-NetTCPConnection WHERE OwningProcess = PID AND State = 'Listen'
Retourne la liste des ports candidats (ex: [55431, 55432, 55463])
         │
         ▼
[3. Probe Heartbeat gRPC-Web sur chaque port]
Envoie POST /exa.language_server_pb.LanguageServerService/Heartbeat
Header: x-codeium-csrf-token: <csrf_token>
         │
         ├─── Si HTTP 200 OK ──────► PORT ACTIF IDENTIFIÉ (:55432)
         └─── Si Connexion Refusée ─► Tester le port suivant
```

---

# 📑 FICHE TECHNIQUE #5 : Système de Règles, Workflows & MCP

### 5.1 Structure d'un Fichier Règle (`.agent/rules/*.md`)

```markdown
---
description: Règle de validation des entrées API
globs:
  - "src/api/**/*.ts"
  - "pkg/gateway/**/*.go"
alwaysApply: false
---

# Directives d'Ingénierie Sécurisée
1. Toujours valider la longueur des buffers entrants avant allocation mémoire.
2. Ne jamais exposer de secrets ou de tokens CSRF dans les réponses d'erreur publiques.
3. Utiliser systématiquement `crypto/subtle.ConstantTimeCompare` pour les validations de tokens.
```

### 5.2 Architecture MCP (`mcp_config.json`)
```json
{
  "mcpServers": {
    "coolify_production": {
      "command": "node",
      "args": ["C:/Users/amine/.gemini/antigravity/mcp/coolify/index.js"],
      "env": {
        "COOLIFY_API_URL": "http://62.169.27.8:8000",
        "NODE_ENV": "production"
      },
      "tools": {
        "list_servers": { "eager": true },
        "get_application_logs": { "eager": false },
        "deploy_application": { "background": "always" }
      }
    }
  }
}
```
- **`eager: true`** : L'outil est chargé immédiatement dans le contexte de prompt au démarrage de l'agent.
- **`background: "always"`** : L'exécution s'effectue en arrière-plan sans bloquer le streaming de l'agent.

---

## 🎯 Synthèse d'Exploitation pour le Développeur

Ces 5 fiches techniques fournissent tous les **octets, structures, codes d'erreur et schémas nécessaires** pour coder directement les adaptateurs Remote sans aucune zone d'ombre.
