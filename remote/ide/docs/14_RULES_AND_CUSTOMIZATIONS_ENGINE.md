# 14. Moteur de Règles & Personnalisations (`.agent/rules/`)

> **Injection Déterministe des Règles Métier dans le Prompt Système**

---

## 1. Structure d'un Fichier Règle

```markdown
---
description: Règle d'architecture backend
globs:
  - "pkg/**/*.go"
  - "src/**/*.ts"
alwaysApply: true
---

# Directives d'Implémentation
1. Ne jamais introduire de dépendances externes sans validation préalable.
2. Utiliser exclusivement la bibliothèque standard pour les flux HTTP et crypto.
3. Toujours documenter les choix architecturaux avec des liens cliquables.
```

---

## 2. Ordre de Priorité d'Injection
1. **Règles Globales Utilisateur** : `~/.gemini/antigravity/global_rules/*.md`
2. **Règles Projet** : `<workspace>/.agent/rules/*.md`
3. **Instructions de Session** : Directives passées dans le prompt courant.
