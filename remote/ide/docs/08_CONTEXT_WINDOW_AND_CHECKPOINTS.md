# 08. Fenêtre de Contexte & Gestion des Checkpoints

> **Algorithme de Compression de Mémoire & Résumé de Trajectoire**

---

## 1. Déclenchement du Checkpoint
Lorsque la taille totale des messages de la session franchit le seuil de compaction (ex: 32K tokens) :
1. Le Language Server suspend temporairement l'inférence.
2. Un appel asynchrone à un modèle léger extrait les objectifs, les décisions clés et l'état des fichiers.
3. Un bloc spécial `CHECKPOINT` est inséré :

```markdown
{{ CHECKPOINT 0 }}
# USER Objective:
Création d'un serveur d'authentification OAuth

# User Requests
1. Initialiser le projet Go
2. Configurer les routes JWT

# Conversation Logs
- C:\Users\amine\.gemini\antigravity-ide\brain\<id>\.system_generated\logs\transcript.jsonl
```

---

## 2. Économie de Contexte
Grâce à ce mécanisme, le volume de tokens réinjecté dans les tours suivants chute de **80%**, évitant les dépassements de fenêtre de contexte et réduisant la latence d'inférence.
