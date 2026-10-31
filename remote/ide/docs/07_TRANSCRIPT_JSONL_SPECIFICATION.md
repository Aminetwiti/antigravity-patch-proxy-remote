# 07. Spécification des Transcripts JSON Lines (`transcript.jsonl`)

> **Format Append-Only des Fichiers Journaux de Sessions**

---

## 1. Emplacement
`~/.gemini/antigravity-ide/brain/<cascadeId>/.system_generated/logs/transcript.jsonl`

---

## 2. Exemple de Séquence Complète

```json
{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-08-24T15:40:22Z","content":"<USER_REQUEST>\nBonjour !\n</USER_REQUEST>"}
{"step_index":1,"source":"SYSTEM","type":"CONVERSATION_HISTORY","status":"DONE","created_at":"2026-08-24T15:40:24Z"}
{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-08-24T15:40:24Z","content":"Bonjour ! Comment puis-je vous aider aujourd'hui ?"}
```

---

## 3. Règle d'Append & Watchdog
- Le fichier `transcript.jsonl` est écrit de façon strictement séquentielle (append-only).
- Le Daemon Remote utilise un File Watchdog avec calcul de delta d'octets (`os.Stat` + seek) pour diffuser les nouveaux événements vers les téléphones connectés en **0 ms**.
