# 04. Moteur de Trajectoires & Cycle de Vie des Sessions

> **Modèle Interne des Sessions, Tours et Étapes**

---

## 1. Structure Hiérarchique

```text
Session (Cascade / Trajectory) [UUID: 60527a47-26c6-...]
  ├── Tour 1 (Turn 0)
  │     ├── Step 0: USER_INPUT (Prompt utilisateur initial)
  │     ├── Step 1: CONVERSATION_HISTORY (Contexte assemblé)
  │     ├── Step 2: PLANNER_RESPONSE (Réponse de l'agent)
  │     └── Step 3: CHECKPOINT (Résumé de contexte si nécessaire)
  └── Tour 2 (Turn 1)
        ├── Step 4: USER_INPUT (Deuxième prompt)
        ├── Step 5: TOOL_CALL (Appel run_command / write_to_file)
        └── Step 6: PLANNER_RESPONSE (Synthèse post-outil)
```

---

## 2. États d'une Étape (`StepStatus`)
- `0` (`PENDING`) : Étape en attente d'exécution.
- `1` (`DONE`) : Étape terminée avec succès.
- `2` (`ERROR`) : Échec d'exécution de l'outil ou du modèle.
- `3` (`CANCELLED`) : Étape interrompue par l'utilisateur.
