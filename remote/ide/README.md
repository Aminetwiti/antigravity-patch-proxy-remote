# 🛰️ Antigravity IDE Integration for Antigravity Remote

> **Dossier Central d'Architecture & de Rétro-Ingénierie pour Antigravity IDE**  
> Ce dossier rassemble l'ensemble des connaissances forensiques, des schémas réels, des protocoles réseau et des guides d'implémentation pour connecter **Antigravity IDE (VS Code v1.107.0)** au système **Antigravity Remote (Daemon Go + Mobile Flutter)**.

---

## 📑 Index de la Documentation

| Fichier | Description & Contenu |
|:---|:---|
| [`PROTOCOLS_AND_SCHEMAS.md`](./PROTOCOLS_AND_SCHEMAS.md) | Tous les protocoles (gRPC-Web, ConnectRPC, WebSocket, Named Pipes) et tous les schémas Protobuf & JSON décodés. |
| [`TECHNICAL_DATASHEETS.md`](./TECHNICAL_DATASHEETS.md) | 5 Fiches techniques de bas niveau : Wire format de streaming, bases SQLite `.db`, sécurité des outils, découverte zéro-port, et MCP. |
| [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md) | Guide pratique pas-à-pas pour implémenter le support IDE dans le Daemon Go (`remote/daemon`) et l'application Mobile (`remote/mobile`). |

---

## 🏗️ Architecture Multi-Shells

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ANTIGRAVITY REMOTE MOBILE                          │
│                          (Application Flutter)                              │
│         ┌─────────────────────────────────────────────────────────┐         │
│         │ [Tous les Projets] | [Antigravity 2.0] | [Antigravity IDE]│       │
│         └─────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket Multiplexé (Port :8090)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DAEMON GO BRIDGE (:8090)                          │
│                                                                             │
│  ┌───────────────────────────────┐     ┌─────────────────────────────────┐  │
│  │ Module Antigravity 2.0        │     │ Module Antigravity IDE          │  │
│  │ (Language Server Hub :55256)  │     │ (Language Server IDE Dynamique) │  │
│  └───────────────┬───────────────┘     └────────────────┬────────────────┘  │
└──────────────────┼──────────────────────────────────────┼───────────────────┘
                   │ ConnectRPC (gRPC-Web)                │ ConnectRPC (gRPC-Web)
                   ▼                                      ▼
┌───────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Antigravity 2.0 (Classic Shell)   │  │ Antigravity IDE (VS Code v1.107.0)   │
│ - language_server.exe             │  │ - language_server_windows_x64.exe    │
│ - Mode : --subclient_type hub     │  │ - Mode : --subclient_type ide        │
│ - Données : ~/.gemini/antigravity │  │ - Données : ~/.gemini/antigravity-ide│
└───────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## ⚡ Faits Clés Découverts lors du Reverse Engineering

1. **Point d'injection du Proxy** : L'extension d'Antigravity IDE lit `jetski.cloudCodeUrl` et passe `--cloud_code_endpoint http://localhost:51074` au Language Server.
2. **Topologie Processus** : Contrairement à Antigravity 2.0 qui utilise un Hub central, Antigravity IDE lance une instance de `language_server_windows_x64.exe` par fenêtre de projet.
3. **Contrôle Graphique en Direct** : La commande native `antigravity-ide.cmd chat -r "<prompt>"` utilise les Named Pipes internes de VS Code pour afficher et streamer le prompt en direct sur l'écran.
4. **Persistance Parallèle** : Les sessions de l'IDE sont écrites dans `~/.gemini/antigravity-ide/brain/` et `~/.gemini/antigravity-ide/conversations/*.db` sans jamais entrer en collision avec celles d'Antigravity 2.0.
