# 🔬 Fiches Techniques Systèmes : Antigravity IDE

> **Spécifications Forensiques de Bas Niveau**

---

## 📑 Fiche #1 : Moteur de Streaming & Protocole ConnectRPC
- **Encapsulation HTTP** : 1 octet Flags + 4 octets Big-Endian Length + Payload Protobuf.
- **Deltas de Texte** : Portés par le Tag Protobuf `5` (`text_delta`).
- **Deltas de Pensée (Thinking)** : Portés par le Tag Protobuf `6` (`thought_delta`).
- **Événements d'Outils** : Tag Protobuf `7` (`tool_call_start`) et Tag Protobuf `8` (`tool_call_output`).

---

## 📑 Fiche #2 : Persistance SQLite & Checkpoints de Contexte
- **Emplacement des bases** : `~/.gemini/antigravity-ide/conversations/<cascadeId>.db`
- **Table `steps`** :
  - `idx` (INTEGER PRIMARY KEY) : Numéro de l'étape (`0, 1, 2, ...`).
  - `step_type` (INTEGER) : `1=USER_INPUT`, `2=PLANNER_RESPONSE`, `3=TOOL_CALL`, `4=CHECKPOINT`.
  - `status` (INTEGER) : `0=PENDING`, `1=DONE`, `2=ERROR`, `3=CANCELLED`.
  - `step_payload` (BLOB) : Charge utile binaire Protobuf.
- **Checkpoints** : Modèle compact (Gemini Flash) résumant automatiquement les étapes antérieures pour diviser la taille du prompt par 5.

---

## 📑 Fiche #3 : Sécurité des Outils & Approbations
- **Outils en Lecture Seule** (`view_file`, `list_dir`, `search_web`) : Exécution automatique sans interruption.
- **Outils d'Écriture & Exécution** (`run_command`, `write_to_file`, `replace_file_content`) : Suspendent l'exécution et émettent une trame `approval_required` jusqu'à validation utilisateur via `HandleCascadeUserInteraction`.

---

## 📑 Fiche #4 : Découverte Zéro-Port des Instances Actives
Algorithme en 3 étapes :
1. **WMI/CIM** : Détecte `language_server_windows_x64.exe` et extrait `--csrf_token`.
2. **Netstat** : Récupère les ports TCP d'écoute du PID (`State = 'Listen'`).
3. **Heartbeat Probe** : Envoie `POST /Heartbeat` avec `x-codeium-csrf-token` pour valider le port actif (`:55432`).

---

## 📑 Fiche #5 : Système de Règles, Workflows & MCP
- **Règles Markdown** : `.agent/rules/**/*.md` avec frontmatter YAML (`globs: ["**/*.go"]`, `description: ...`).
- **Workflows Markdown** : `.agent/workflows/**/*.md` avec instructions pas-à-pas et slash commandes.
- **MCP Config** : `~/.gemini/antigravity-ide/mcp_config.json` supportant `command`, `args`, `env`, et outils `eager` ou `background`.
