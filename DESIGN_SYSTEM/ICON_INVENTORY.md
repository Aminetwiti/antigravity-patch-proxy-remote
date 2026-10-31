# ICON INVENTORY & ASSETS — ANTIGRAVITY 2.0

Inventaire forensic exhaustif des icônes et images extraites directement de l'archive `app.asar`.

---

## 1. Fichiers Images Embarqués dans l'ASAR

| Fichier | Résolution | Poids | Format | Canal Alpha | Usage | Source |
|---|---|---|---|---|---|---|
| `icon.png` | `512 x 512 px` | 48 633 octets | PNG (RGBA 8-bit) | Oui (Vrai) | Icône officielle de l'application | `app.asar: /icon.png` |
| `trayTemplate.png` | `22 x 22 px` | 355 octets | PNG (RGBA 8-bit) | Oui (Vrai) | Icône monochrome pour la barre des tâches / System Tray (macOS/Win) | `app.asar: /trayTemplate.png` |
| `trayTemplate@2x.png`| `44 x 44 px` | 651 octets | PNG (RGBA 8-bit) | Oui (Vrai) | Version Haute Résolution Retina de l'icône de barre des tâches | `app.asar: /trayTemplate@2x.png` |

---

## 2. Système d'Icônes UI (Google Symbols / Material Symbols)

L'application n'embarque pas de police iconographique TTF lourde dans le JS bundle ; elle référence le jeu de glyphes vectoriels standardisé **Google Material Symbols (Outlined)** :

| Nom Glyphe | Rôle Fonctionnel | Composant Associé | Taille d'Affichage | Source de Référence |
|---|---|---|---|---|
| `search` | Recherche globale / fichiers | Barre de recherche | 20 px | `remote/mobile/` |
| `settings` | Préférences de l'IDE / Modèles | Menu latéral | 20 px | `remote/mobile/` |
| `chat_bubble_outline` | Sessions de chat agentique | Liste des sessions | 20 px | `remote/mobile/` |
| `history` | Historique des trajectoires | Panneau d'historique | 20 px | `remote/mobile/` |
| `construction` | Outils & Serveurs MCP | Navigateur MCP | 20 px | `remote/mobile/` |
| `folder_open` | Espaces de travail (Workspaces) | Arborescence | 20 px | `remote/mobile/` |
| `progress_activity` | Tâche d'agent en cours d'exécution | ExecutionProgressCard | 18 px (rotation continue) | `remote/mobile/design.md: L258` |
| `check_circle` | Étape complétée avec succès | ExecutionProgressCard | 18 px (`#81C995`) | `remote/mobile/design.md: L260` |
| `error` | Échec de commande ou d'étape | Carte d'erreur | 18 px (`#F28B82`) | `remote/mobile/design.md: L261` |
| `terminal` | Sortie d'exécution bash/shell | ToolExecutionCard | 16 px | `remote/mobile/design.md: L304` |
| `close` | Fermeture de modale / toast | Bouton close (`.agy-close`) | 20 px | `styles.css: L2745` |
