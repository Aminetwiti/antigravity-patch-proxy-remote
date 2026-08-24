# 📡 Protocoles & Schémas Décodés : Antigravity IDE

> **Référence Technique des Formats Réseau & Schémas de Données**

---

## 1. Protocole ConnectRPC / gRPC-Web (Language Server)

### 1.1 Wire Format & Cadrage Binaire
Toute communication avec `language_server_windows_x64.exe` utilise le cadrage standard gRPC-Web :

```text
+------------------+------------------------------+---------------------------+
| 1 octet (Flags)  | 4 octets Big-Endian (Length) | L octets (Payload Proto)  |
+------------------+------------------------------+---------------------------+
```
- **Flags = `0x00`** : Trame de données normale (Data frame).
- **Flags = `0x80`** : Trame de fin d'appel (Trailer frame contenant `grpc-status: 0`).

### 1.2 Headers HTTP Requis
```http
POST /exa.language_server_pb.LanguageServerService/<MethodName> HTTP/1.1
Host: 127.0.0.1:<port>
Content-Type: application/grpc-web+proto
Accept: application/grpc-web+proto,application/grpc-web-text
x-codeium-csrf-token: <csrf_token>
Connect-Protocol-Version: 1
X-Grpc-Web: 1
```

---

## 2. Schémas Protobuf Décodés du Language Server

### 2.1 `StartCascadeRequest` (Création de Session)
```protobuf
message StartCascadeRequest {
  uint32 source = 4;                  // 1 = CORTEX_TRAJECTORY_SOURCE_IDE
  uint32 trajectory_type = 5;          // 1 = CORTEX_TRAJECTORY_TYPE_DEFAULT
  string workspace_uri = 8;            // Ex: "file:///c:/projects/mon-projet"
  uint64 requested_model_enum = 14;    // Enum du modèle (ex: 312)
  string requested_model_uid = 15;     // UID du modèle custom (ex: "gemini-2.5-flash")
  ProjectEnvironmentConfig project_env = 17; // Exclusif avec workspace_uri
}
```

### 2.2 `SendUserCascadeMessageRequest` (Envoi de Prompt & Streaming)
```protobuf
message SendUserCascadeMessageRequest {
  string cascade_id = 1;               // UUID de la session
  string text = 2;                     // Texte du prompt
  Metadata metadata = 3;               // Metadata (API Key, SessionID)
  CascadeConfig cascade_config = 4;    // Configuration du modèle et mode planner
  repeated MediaAttachment media = 6;  // Images base64 / documents joints
}
```

### 2.3 `HandleCascadeUserInteractionRequest` (Approbation d'Outils & Questions)
```protobuf
message HandleCascadeUserInteractionRequest {
  string cascade_id = 1;
  InteractionPayload interaction = 2;  // Contient trajectory_id, step_index, décision
}
```

### 2.4 `SetBrowserOpenConversationRequest` (Focus Graphique)
```protobuf
message SetBrowserOpenConversationRequest {
  string cascade_id = 1;               // Ouvre la session dans le panneau Cascade
}
```

---

## 3. Schéma du Fichier Journal `transcript.jsonl`

Chaque ligne du fichier `~/.gemini/antigravity-ide/brain/<cascadeId>/.system_generated/logs/transcript.jsonl` est un objet JSON structuré :

```json
{"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "created_at": "2026-08-24T15:40:22Z", "content": "<USER_REQUEST>...</USER_REQUEST><ADDITIONAL_METADATA>...</ADDITIONAL_METADATA>"}
{"step_index": 1, "source": "SYSTEM", "type": "CONVERSATION_HISTORY", "status": "DONE", "created_at": "2026-08-24T15:40:24Z"}
{"step_index": 2, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-08-24T15:40:24Z", "content": "Texte généré par l'IA..."}
{"step_index": 3, "source": "MODEL", "type": "TOOL_CALL", "status": "DONE", "created_at": "2026-08-24T15:40:25Z", "tool_calls": [{"name": "write_to_file", "arguments": {"TargetFile": "...", "CodeContent": "..."}}]}
{"step_index": 4, "source": "SYSTEM", "type": "CHECKPOINT", "status": "DONE", "created_at": "2026-08-24T15:40:26Z", "content": "{{ CHECKPOINT 0 }} Résumé du contexte..."}
```

---

## 4. Schéma de Découverte des Workspaces (`storage.json`)

Emplacement : `%APPDATA%\Antigravity IDE\User\globalStorage\storage.json`

```json
{
  "backupWorkspaces": {
    "folders": [
      { "folderUri": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main" }
    ]
  },
  "profileAssociations": {
    "workspaces": {
      "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main": "__default__profile__"
    }
  },
  "windowsState": {
    "lastActiveWindow": {
      "folder": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main"
    }
  }
}
```
