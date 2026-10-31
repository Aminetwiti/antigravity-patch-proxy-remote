# ⚖️ Comparatif Technique Approfondi : Antigravity 2.0 vs Antigravity IDE

> **Analyse Comparative Forensique & Architecturale**  
> Ce document met en parallèle les deux environnements de développement officiels de Google Antigravity : la version **Classic Shell (Antigravity 2.0)** et la version **VS Code Fork (Antigravity IDE v1.107.0)**.

---

## 1. Tableau Comparatif Synthétique

| Critère d'Évaluation | Antigravity 2.0 (Classic Shell) | Antigravity IDE (VS Code Fork) |
|:---|:---|:---|
| **Base Logicielle** | Shell Electron propriétaire Google | Fork complet de VS Code (v1.107.0) |
| **Emplacement d'Installation** | `%LOCALAPPDATA%\Programs\antigravity\` | `%LOCALAPPDATA%\Programs\Antigravity IDE\` |
| **Binaire Language Server** | `language_server.exe` (~120 Mo) | `language_server_windows_x64.exe` (~135 Mo) |
| **Topologie des Processus** | **Hub Central Unique** (`--subclient_type hub`) partagé par toutes les fenêtres | **1 Instance par Fenêtre** (`--subclient_type ide`) isolée par workspace |
| **Port ConnectRPC d'Écoute** | Fixe ou Semi-fixe (`:55256` par défaut) | **Dynamique** (ex: `:55431`, `:55432`, `:55463`) |
| **Mécanisme du Patch Proxy** | **Patch Binaire Go** (Modification physique des tables de chaînes du binaire) | **Configuration JSON** (`jetski.cloudCodeUrl: "http://localhost:51074"`) |
| **Résistance aux Mises à Jour** | Nécessite `auto-heal.ps1` pour ré-appliquer le patch binaire après update | **100% Persistant** (Les paramètres de configuration ne sont pas écrasés) |
| **Arborescence des Données** | `~/.gemini/antigravity/` | `~/.gemini/antigravity-ide/` |
| **Registre des Workspaces** | `~/.gemini/config/projects/*.json` | `%APPDATA%\Antigravity IDE\User\globalStorage\storage.json` |
| **Bases de Conversations** | `.db` SQLite + `.pb` Protobuf | `.db` SQLite + `.pb` Protobuf + `.pbtxt` Annotations |
| **Contrôle en Ligne de Commande** | Appels ConnectRPC distants | **Sous-commande CLI native** (`antigravity-ide.cmd chat -r`) + ConnectRPC |
| **Support des Extensions VS Code** | Limité / Interne | **Universel** (Marketplace VS Code, Open-VSX, MCP) |
| **Personnalisation IA** | `.agent/rules/`, `.agent/workflows/` | `.agent/rules/`, `.agent/workflows/` + **Custom Editors graphiques** |

---

## 2. Analyse Détaillée des Différences Architecturales

### A. Topologie des Processus & Language Server

```
ANTIGRAVITY 2.0 (MODÈLE HUB CENTRAL)
┌─────────────────────────────────────────────────────────────┐
│                       LANGUAGE SERVER                       │
│                   (Mode: --subclient_type hub)              │
│                       Port Fixe :55256                      │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [Fenêtre Projet A]                    [Fenêtre Projet B]
```
- **Avantage Antigravity 2.0** : Un seul binaire Go en mémoire (faible empreinte RAM globale).
- **Inconvén Antigravity 2.0** : Si le binaire plante, toutes les fenêtres et sessions perdent leur connexion.

---

```
ANTIGRAVITY IDE (MODÈLE ISOLÉ PAR PROJET)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│       LANGUAGE SERVER A      │        │       LANGUAGE SERVER B      │
│ (Mode: --subclient_type ide) │        │ (Mode: --subclient_type ide) │
│       Port Dynamique :55432  │        │       Port Dynamique :56278  │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               ▼                                       ▼
      [Fenêtre Projet A]                      [Fenêtre Projet B]
```
- **Avantage Antigravity IDE** : Isolation totale des plantages, des index vectoriels de code et des caches de fichiers.
- **Inconvén Antigravity IDE** : Nécessite une découverte dynamique de ports pour le Daemon Remote.

---

### B. Mécanisme de Patch & Injection des Modèles LLM

```
ANTIGRAVITY 2.0 : PATCH BINAIRE PHYSIQUE
┌─────────────────────────────────────────────────────────────────────────────┐
│ Binaire language_server.exe                                                 │
│ [String Table] "daily-cloudcode-pa.googleapis.com" ──► "127.0.0.1:51074"    │
└─────────────────────────────────────────────────────────────────────────────┘
  ⚠️ Sensible aux mises à jour automatiques officielles (nécessite auto-heal).
```

```
ANTIGRAVITY IDE : INJECTION PAR PARAMÈTRE DE CONFIGURATION
┌─────────────────────────────────────────────────────────────────────────────┐
│ settings.json : "jetski.cloudCodeUrl": "http://localhost:51074"             │
│        │                                                                    │
│        ▼                                                                    │
│ extension.js lance language_server avec --cloud_code_endpoint :51074        │
└─────────────────────────────────────────────────────────────────────────────┘
  ✅ 100% stable et immunisé contre les mises à jour de l'IDE.
```

---

### C. Gestion des Workspaces & Espaces de Travail

| Shell | Format de Découverte | Comment Remote accède aux projets |
|:---|:---|:---|
| **Antigravity 2.0** | Fichiers JSON individuels dans `~/.gemini/config/projects/` | Lecture directe des fichiers `*.json` contenant `workspaceRoot` et `workspaceId`. |
| **Antigravity IDE** | Registre central VS Code dans `%APPDATA%\Antigravity IDE\...\storage.json` | Lecture des clés `backupWorkspaces.folders` et `profileAssociations.workspaces`. |

---

### D. Contrôle Interactif & Affichage en Temps Réel

| Shell | Commande / Méthode | Comportement Graphique à l'Écran |
|:---|:---|:---|
| **Antigravity 2.0** | ConnectRPC `SendUserCascadeMessage` + `SetBrowserOpenConversation` | Met à jour la base SQLite et notifie le panneau Cascade Electron via le bus interne. |
| **Antigravity IDE** | CLI natif : `antigravity-ide.cmd chat -r "<prompt>"` | **Injecte le prompt directement via les Named Pipes VS Code (`\\.\pipe\server_*`) et déclenche l'animation de streaming en direct dans le Webview React.** |

---

## 3. Matrice de Recommandation d'Usage

| Cas d'Usage | Quel Shell Privilégier ? | Rationale Technique |
|:---|:---:|:---|
| **Développement Multi-Langages & Extensions** | **Antigravity IDE** | Accès à tout l'écosystème d'extensions VS Code, thèmes, linters et MCP avancés. |
| **Session IA Dédiée & Faible Empreinte RAM** | **Antigravity 2.0** | Shell épuré, un seul processus Language Server partagé. |
| **Stabilité du Patch Proxy sans maintenance** | **Antigravity IDE** | Utilise l'argument officiel `--cloud_code_endpoint` sans altérer les binaires. |
| **Utilisation via Antigravity Remote (Mobile)** | **Les Deux (Hybride)** | Le Daemon Go unifie les deux shells sous une même interface mobile transparente. |
