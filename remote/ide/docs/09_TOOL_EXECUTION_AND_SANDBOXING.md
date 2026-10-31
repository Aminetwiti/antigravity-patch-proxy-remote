# 09. Exécution des Outils & Sécurité (Sandboxing)

> **Contrôle des Accès Disque, Exécution Shell et Politiques d'Approbation**

---

## 1. Matrice des Permissions

| Outil | Type | Risque | Action Requise |
|:---|:---|:---:|:---|
| `view_file` | Lecture | Faible | Auto-autorisé dans le workspace |
| `list_dir` | Lecture | Faible | Auto-autorisé dans le workspace |
| `search_web` | Réseau | Faible | Auto-autorisé |
| `write_to_file` | Écriture | Moyen | Requiert approbation ou whitelist de dossier |
| `replace_file_content` | Écriture | Moyen | Requiert approbation |
| `run_command` | Exécution | Élevé | **Validation manuelle stricte obligatoire** |

---

## 2. Détection des Tentatives d'Évasion de Sandbox
Le Language Server rejette toute commande tentant d'accéder à des répertoires système sensibles (ex: `C:\Windows\System32`) ou d'exécuter des modifications hors de la racine déclarée dans `--workspace_id`.
