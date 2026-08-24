# 🛰️ Manuel Complet de Rétro-Ingénierie & Guide de Contrôle : Antigravity IDE

> **Référence d'Ingénierie Système & Rétro-Ingénierie Avancée**  
> Analyse approfondie de la distribution autonome `tools\Antigravity IDE\`, de son architecture interne, de son protocole de communication ConnectRPC, de ses points d'injection et de ses mécanismes de contrôle interactif et distant.

---

## 1. Vue d'Ensemble & Cartographie du Binaire `tools\Antigravity IDE\`

Le répertoire `tools\Antigravity IDE\` héberge une distribution portable complète d'**Antigravity IDE** basée sur **VS Code v1.107.0** et propulsée par l'écosystème d'IA de Google (Jetski / Cortex).

```
tools/Antigravity IDE/
├── Antigravity IDE.exe                    # Binaire hôte Electron / Chromium v22 (~210 Mo)
├── bin/
│   ├── antigravity-ide                   # Lanceur Shell Linux/macOS
│   └── antigravity-ide.cmd               # Lanceur CLI Windows pour automation et chat interactif
│
├── resources/app/
│   ├── package.json                      # Dépendances Node (@connectrpc, @bufbuild, @exa/agent-ui-toolkit)
│   ├── out/
│   │   ├── main.js                       # Point d'entrée Electron (patché avec auto-start du proxy :51074)
│   │   └── cli.js                        # Dispatcher CLI des sous-commandes (chat, diff, merge, tunnel)
│   │
│   └── extensions/
│       └── antigravity/                  # Extension interne centrale alimentant l'IA
│           ├── package.json              # Déclaration des commandes, menus, customEditors et schémas
│           ├── dist/extension.js         # Cœur d'orchestration JS (2.04 Mo)
│           ├── bin/
│           │   └── language_server_windows_x64.exe  # Binaire Go natif Language Server (~135 Mo)
│           ├── customEditor/             # Éditeurs graphiques pour Rules et Workflows
│           │   ├── ruleEditor.js         # Éditeur visuel pour .agent/rules/**/*.md
│           │   └── workflowEditor.js     # Éditeur visuel pour .agent/workflows/**/*.md
│           └── schemas/
│               └── mcp_config.schema.json# Schéma JSON officiel de configuration des serveurs MCP
│
└── agents/reverse-skill-main/            # Bibliothèque d'audit, de sécurité et de compétences forensiques
```

---

## 2. Tableau Comparatif : Antigravity 2.0 vs Antigravity IDE

| Caractéristique | Antigravity 2.0 (Classic Shell) | Antigravity IDE (VS Code Fork) |
|:---|:---|:---|
| **Base logicielle** | Application Electron propriétaire | Fork VS Code v1.107.0 |
| **Emplacement officiel** | `%LOCALAPPDATA%\Programs\antigravity\` | `%LOCALAPPDATA%\Programs\Antigravity IDE\` |
| **Distribution locale** | N/A | `tools\Antigravity IDE\` |
| **Binaire Language Server** | `language_server.exe` | `language_server_windows_x64.exe` |
| **Topologie Processus** | 1 instance centrale Hub (`--subclient_type hub`) | 1 instance par fenêtre (`--subclient_type ide`) |
| **Mécanisme du Patch** | Patch binaire de la table de chaînes Go | Paramètre `jetski.cloudCodeUrl` dans `settings.json` |
| **Persistance des Sessions** | `~/.gemini/antigravity/` (`.db` + JSONL) | `~/.gemini/antigravity-ide/` (`.db`, `.pb` + JSONL) |
| **Registre des Workspaces** | `~/.gemini/config/projects/*.json` | `%APPDATA%\Antigravity IDE\...\storage.json` |

---

## 3. Architecture des Processus & Flux d'Exécution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. ÉTAGE ELECTRON HÔTE (Antigravity IDE.exe / out/main.js)                  │
│    - Démarre automatiquement le Patch Proxy local (:51074)                  │
│    - Initialise le runtime VS Code Workbench et les fenêtres Electron       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. ÉTAGE EXTENSION HOST (resources/app/extensions/antigravity/dist/ext.js)   │
│    - Lit la configuration : "jetski.cloudCodeUrl" = "http://localhost:51074"│
│    - Calcule le hash SHA-256 du projet pour --workspace_id                  │
│    - Génère les tokens CSRF et lance le Language Server en sous-processus   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ÉTAGE MOTEUR IA (language_server_windows_x64.exe)                        │
│    - Écoute en local sur un port TCP dynamique (ex: :55432) via ConnectRPC  │
│    - Reçoit les prompts, gère la mémoire, les checkpoints et les outils     │
│    - Route toutes les requêtes LLM sortantes vers http://localhost:51074     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. ÉTAGE PATCH PROXY LOCAL (:51074)                                         │
│    - Injecte 28+ modèles custom (Claude 3.7 Sonnet, GPT-4o, DeepSeek, etc.) │
│    - Traduit les schémas Google Cloud Code vers les APIs fournisseurs       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Rétro-Ingénierie du Language Server & des Arguments CLI

Lors du lancement par l'extension VS Code, `language_server_windows_x64.exe` est instancié avec les arguments suivants :

```bash
language_server_windows_x64.exe \
  --subclient_type ide \
  --app_data_dir antigravity-ide \
  --cloud_code_endpoint http://localhost:51074 \
  --csrf_token <uuid-v4> \
  --extension_server_port <port-tcp> \
  --extension_server_csrf_token <uuid-v4> \
  --workspace_id <sha256-hash-du-dossier> \
  --parent_pipe_path \\.\pipe\server_<id>
```

### Signification des Arguments Critiques :
1. `--subclient_type ide` : Isole l'instance pour la fenêtre courante de l'IDE.
2. `--app_data_dir antigravity-ide` : Force la racine de stockage sous `~/.gemini/antigravity-ide/`.
3. `--cloud_code_endpoint http://localhost:51074` : **Le point d'ancrage du proxy** — redirige tout le trafic LLM vers notre proxy local.
4. `--csrf_token <token>` : Jeton d'authentification obligatoire passé dans l'en-tête HTTP `x-codeium-csrf-token`.
5. `--workspace_id <hash>` : Isole la base vectorielle d'embeddings et les contextes de fichiers par projet.

---

## 5. Catalogue des Méthodes ConnectRPC (Service Principal)

Le service `exa.language_server_pb.LanguageServerService` expose plus de 200 méthodes RPC. Les plus importantes pour le contrôle et l'intégration sont :

| Méthode RPC | Protocole | Rôle |
|:---|:---|:---|
| `Heartbeat` | Unary | Vérification de connectivité et de validité du jeton CSRF. |
| `GetUserStatus` | Unary | Récupère l'état du compte, du plan (Pro/Ultra) et des crédits restants. |
| `GetAvailableModels` | Unary | Liste les modèles IA mis à disposition par le proxy. |
| `StartCascade` | Unary | Crée une nouvelle session de dialogue (`cascadeId`). |
| `SendUserCascadeMessage` | **Streaming** | Transmet un prompt utilisateur et renvoie les tokens/outils en streaming. |
| `SetBrowserOpenConversation`| Unary | Force l'IDE à ouvrir et afficher une conversation spécifique à l'écran. |
| `HandleCascadeUserInteraction`| Unary | Répond aux approbations d'outils (`ToolApproval`) ou questions à choix (`AskQuestion`). |
| `CancelCascadeInvocation` | Unary | Interrompt l'inférence en cours. |
| `GetTurnDiff` | Unary | Récupère le diff Git/fichiers généré par un tour spécifique. |

---

## 6. Guide Pratique de Contrôle & Utilisation

### Méthode A : Contrôle Interactif en Ligne de Commande (Affichage Direct dans l'IDE)

Le script `tools\Antigravity IDE\bin\antigravity-ide.cmd` fournit la sous-commande `chat` permettant de piloter la fenêtre active en direct :

```powershell
# 1. Envoyer un prompt interactif dans la fenêtre active
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r "Explique le fonctionnement du garbage collector en Go."

# 2. Envoyer un prompt avec injection d'un fichier de contexte
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r -a "src/proxy.ts" "Analyse ce fichier et propose des optimisations."

# 3. Basculer en mode Édition directe de code (edit mode)
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r -m edit "Ajoute des tests unitaires pour la fonction ParseFrameEvents."

# 4. Agrandir automatiquement le panneau Cascade
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r --maximize "Démarre un audit complet du projet."
```

---

### Méthode B : Contrôle Programmatique & Backend (Via ConnectRPC)

Pour créer des sessions ou automatiser des tâches sans interface graphique (via scripts Go, Node.js ou Python) :

```go
package main

import (
	"fmt"
	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

func main() {
	// 1. Initialiser le client ConnectRPC sur le port du Language Server IDE
	client := connectrpc.NewClient(55432, "aca2a2fd-f0e6-4053-931e-a28accf6f5f2")
	
	// 2. Créer une nouvelle session
	resp, _ := client.CreateCascade("file:///c:/mon-projet", "", "gemini-2.5-flash", 0)
	cascadeID := "60527a47-26c6-4872-9414-d16c00994dc1"

	// 3. Envoyer un prompt et streamer la réponse
	client.SendMessageStream(cascadeID, "Bonjour !", func(frame []byte) error {
		events := connectrpc.ParseFrameEvents(frame, cascadeID)
		for _, ev := range events {
			if ev.Delta != "" {
				fmt.Print(ev.Delta)
			}
		}
		return nil
	})

	// 4. Forcer l'IDE à ouvrir la session dans son panneau graphique
	client.SetBrowserOpenConversation(cascadeID)
}
```

---

## 7. Système de Règles, Workflows & MCP

### A. Format des Règles (`.agent/rules/*.md`)
Placées sous `.agent/rules/` ou `.gemini/antigravity/global_rules/`, ces règles sont injectées automatiquement dans le contexte système :
```markdown
---
description: Règle de style de code
globs: ["**/*.go"]
---
- Toujours gérer les erreurs explicitement (pas de panics dans les handlers HTTP).
- Documenter toutes les fonctions exportées.
```

### B. Format des Workflows (`.agent/workflows/*.md`)
Permet de définir des pipelines multi-étapes exécutables directement depuis le chat via des slash commandes personnalisées :
```markdown
---
description: Pipeline de Release
---
1. Exécuter les tests unitaires : `go test ./...`
2. Construire les binaires : `npm run build`
3. Générer le changelog automatique.
```

### C. Configuration des Serveurs MCP (`mcp_config.json`)
Supporté nativement sous `~/.gemini/antigravity-ide/mcp_config.json` ou à la racine du workspace :
```json
{
  "mcpServers": {
    "coolify": {
      "command": "node",
      "args": ["C:/Users/amine/.gemini/antigravity/mcp/coolify/index.js"],
      "env": {
        "COOLIFY_API_URL": "http://62.169.27.8:8000"
      },
      "tools": {
        "list_servers": { "eager": true },
        "deploy_application": { "background": "always" }
      }
    }
  }
}
```

---

## 8. Persistance & Stockage sur Disque

Toutes les données générées par Antigravity IDE sont organisées de façon déterministe :

| Type de Donnée | Emplacement sur Disque | Format |
|:---|:---|:---|
| **Transcripts & Logs** | `~/.gemini/antigravity-ide/brain/<cascadeId>/.system_generated/logs/transcript.jsonl` | Append-only JSON Lines |
| **Bases de Conversations** | `~/.gemini/antigravity-ide/conversations/<cascadeId>.db` | SQLite 3 |
| **Trajectoires Protobuf** | `~/.gemini/antigravity-ide/conversations/<cascadeId>.pb` | Protobuf binaire |
| **Annotations de Session** | `~/.gemini/antigravity-ide/annotations/<cascadeId>.pbtxt` | Protobuf Text Format |
| **Workspaces & Profils** | `%APPDATA%\Antigravity IDE\User\globalStorage\storage.json` | JSON standard VS Code |
| **Artefacts & Plans** | `~/.gemini/antigravity-ide/brain/<cascadeId>/*.md` | Markdown GFM |

---

## 9. Synthèse Finale

Grâce à cette rétro-ingénierie forensique :
1. **L'environnement est 100% maîtrisé** : Vous disposez d'un contrôle visuel direct (`chat -r`) et d'un contrôle programmatique complet via ConnectRPC (`:55432`).
2. **Le Proxy Local est universel** : Il intercepte et injecte tous les modèles custom pour Antigravity 2.0 comme pour Antigravity IDE.
3. **Le Remote est prêt** : L'écosystème Daemon Go + Flutter Mobile peut intégrer la découverte et le monitoring de ces sessions de façon purement additive.
