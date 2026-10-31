# Antigravity Remote Daemon UI 🖥️

> Contrôleur de bureau Electron dédié au démarrage, à la supervision et à l'appairage mobile instantané du pont distant Antigravity (`ag-agentd` / `daemon.exe`).

---

## 🌟 Vue d'ensemble

`antigravity-remote-daemon` est une application de bureau légère (Electron) conçue pour piloter le démon Go d'Antigravity Remote sans nécessiter l'usage du terminal. Elle sert de tableau de bord graphique 1-page pour :
- **Lancer et arrêter** le processus Go (`daemon.exe` ou `go run main.go`).
- **Gérer les tunnels publics** (Cloudflare Quick Tunnel, Pinggy) en un clic.
- **Afficher le QR code d'appairage** dynamique (compatible réseau local Wi-Fi ou WAN chiffré via tunnel).
- **Surveiller la télémétrie en direct** : état du Language Server hôte, statut du port, deltas de streaming, mémoire et logs en temps réel.
- **Assurer la persistance du jeton d'authentification** de manière sécurisée (`daemon.token`).

---

## 🏗️ Architecture

```
                    ┌────────────────────────────┐
                    │  Remote Daemon Electron UI │
                    │    (1040x780 Frameless)    │
                    └──────────────┬─────────────┘
                                   │ IPC (ContextBridge)
                    ┌──────────────▼─────────────┐
                    │      Electron Main         │
                    │   (Process Orchestrator)   │
                    └──────┬──────────────┬──────┘
                           │              │
        Spawns / Manages   │              │ Polls Diagnostics
                           ▼              ▼
                    ┌──────────────┐ ┌──────────────┐
                    │  daemon.exe  │ │ /health/diag │
                    │  (Go Bridge) │ │ HTTP Status  │
                    └──────┬───────┘ └──────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      Cloudflare / Pinggy         Local Network
        Public Tunnel              192.168.x.x
             │                           │
             └─────────────┬─────────────┘
                           │ Scans Pairing QR Code
                           ▼
                    📱 Flutter Mobile
```

---

## 🚀 Démarrage Rapide

### Prérequis
- **Node.js** `>= 20.0.0`
- **npm** `>= 10.0.0`
- **Go** `>= 1.22` (si le binaire compilé `daemon.exe` n'est pas présent dans `remote/daemon/`)

### Installation
```bash
cd remote/antigravity-remote-daemon
npm install
```

### Développement
Lancer l'interface avec rechargement automatique :
```bash
npm start
```
*Le script exécute `copy-assets.js`, compile les fichiers TypeScript (`tsconfig.json` & `tsconfig.renderer.json`), applique `strip-module-syntax.js` puis lance Electron.*

### Compilation pour Production
```bash
# Compiler les fichiers TypeScript et assets
npm run build

# Générer l'installateur Windows (.exe)
npm run dist

# Générer l'exécutable portable Windows autonome (.exe)
npm run dist:portable
```

---

## ⚙️ Configuration & Sécurité

### Résolution du Jeton d'Authentification
Le contrôleur résout le jeton selon la priorité stricte suivante :
1. Jeton saisi manuellement dans l'interface utilisateur.
2. Variable d'environnement `AG_DAEMON_AUTH_TOKEN`.
3. Jeton persisté sur disque dans `~/.gemini/antigravity/daemon.token` (permissions `0600`).
4. Si aucun jeton n'existe, génération cryptographique aléatoire de 16 octets hexadécimaux et écriture sécurisée dans `daemon.token`.

### Nettoyage des Processus Orphelins
À chaque démarrage ou arrêt manuel, `antigravity-remote-daemon` nettoie les instances orphelines éventuelles :
- Sous Windows : terminaison forcée de `daemon.exe` et `cloudflared.exe`.
- Sous Linux / macOS : commande `pkill -f "remote/daemon/daemon"`.

---

## 📡 API IPC (Main ↔ Renderer)

| Canal IPC | Type | Paramètres | Description |
|:---|:---|:---|:---|
| `remote:getLocalIp` | `invoke` | — | Récupère l'adresse IPv4 non-interne de la machine hôte. |
| `remote:generateQr` | `invoke` | `text: string` | Génère un QR code DataURL en base64 pour l'appairage mobile. |
| `remote:getDaemonStatus` | `invoke` | `port?: number, token?: string` | Interroge `/health/diagnostic` et `/health` pour obtenir l'état complet. |
| `remote:startDaemon` | `invoke` | `{ port, tunnel, token, allowFirstAdmin }` | Démarre le démon Go (`daemon.exe` ou `go run main.go`). |
| `remote:stopDaemon` | `invoke` | — | Arrête proprement le processus démon et tue les orphelins. |
| `remote:daemonLog` | `on` | `(log: string) => void` | Flux d'événements transmettant les sorties `stdout`/`stderr` du démon. |
| `remote:openExternal` | `invoke` | `url: string` | Ouvre une URL dans le navigateur par défaut (validation de schéma http/https/ws). |

---

## 📱 Appairage Mobile

1. Démarrez le daemon depuis l'interface en cliquant sur **Start Daemon**.
2. Choisissez le mode de connectivité :
   - **Local Wi-Fi** : rapide et zéro dépendance cloud (mobile et PC sur le même réseau).
   - **Cloudflare Quick Tunnel / Pinggy** : accès transparent depuis la 4G/5G sans redirection de ports box.
3. Ouvrez l'application **Antigravity Mobile** sur votre smartphone.
4. Appuyez sur **Scanner le QR Code** et visez l'écran du contrôleur.
5. L'appairage est instantané et la session de contrôle distant s'ouvre avec streaming bidirectionnel.
