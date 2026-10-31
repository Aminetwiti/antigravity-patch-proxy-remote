# @antigravity/remote-cli 🛠️

> Outil en ligne de commande (CLI) en TypeScript pour tester et valider le protocole ConnectRPC / gRPC-Web face au moteur `language_server.exe` d'Antigravity.

---

## 🌟 Fonctionnalités

- **Détection Automatique du Hub** : Scanner CIM/WMI extrayant le PID, le port d'écoute (`base` / `base+1`) et le jeton CSRF de l'instance centrale `language_server`.
- **Validation gRPC-Web Binaire** : Framing de trames gRPC-Web pures sans dépendances RPC tierces lourdes.
- **Vérification Protobuf** : Test des endpoints `Heartbeat`, `GetAvailableModels` et `GetAllCascadeTrajectories`.

---

## 🚀 Utilisation

### Installation
```bash
cd remote/cli
npm install
```

### Scan & Découverte du Processus
```bash
npm run scan
```
Scanne les processus `language_server*` en cours d'exécution sur la machine et affiche les coordonnées du Hub actif.

### Test de Connexion & Heartbeat
```bash
npm run test:connect
```

### Compilation TypeScript
```bash
npm run build
```
Compile les sources `src/` vers `dist/`.
