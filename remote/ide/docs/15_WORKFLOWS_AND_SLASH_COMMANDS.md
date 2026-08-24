# 15. Moteur de Workflows & Slash Commandes (`.agent/workflows/`)

> **Pipelines Autonomes Déclenchables par Commande**

---

## 1. Définition d'un Workflow

Fichier : `.agent/workflows/deploy.md`

```markdown
---
description: Déploiement Staging Automatisé
slashCommand: deploy
---

1. Exécuter l'analyse statique : `npm run lint`
2. Lancer les tests unitaires : `npm test`
3. Si tous les tests passent, déclencher le déploiement sur le cluster Coolify.
```

---

## 2. Déclenchement
Dans le chat IDE ou depuis l'application Remote Mobile, taper `/deploy` exécute automatiquement les 3 étapes de façon séquentielle avec gestion des échecs.
