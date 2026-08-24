# 06. Persistance SQLite & Structure des Bases `.db`

> **Spécification des Tables & Stockage Local**

---

## 1. Schéma SQLite Officiel (`~/.gemini/antigravity-ide/conversations/<id>.db`)

```sql
CREATE TABLE steps (
    idx INTEGER PRIMARY KEY,
    step_type INTEGER NOT NULL,
    status INTEGER NOT NULL,
    has_subtrajectory NUMERIC,
    metadata BLOB,
    error_details BLOB,
    permissions BLOB,
    task_details BLOB,
    render_info BLOB,
    step_payload BLOB,
    step_format INTEGER DEFAULT 0
);

CREATE TABLE trajectory_meta (
    trajectory_id TEXT PRIMARY KEY,
    workspace_root TEXT,
    created_timestamp INTEGER,
    last_modified_timestamp INTEGER,
    title TEXT,
    active_model_uid TEXT
);
```

---

## 2. Décodage du Champ `step_payload`
Le champ `step_payload` contient la sérialisation Protobuf exacte du message :
- Pour `step_type = 1` (USER_INPUT) : Contient le texte du prompt et les métadonnées de requête.
- Pour `step_type = 2` (PLANNER_RESPONSE) : Contient la réponse Markdown complète générée.
- Pour `step_type = 3` (TOOL_CALL) : Contient le nom de l'outil, les arguments JSON et la sortie retournée.
