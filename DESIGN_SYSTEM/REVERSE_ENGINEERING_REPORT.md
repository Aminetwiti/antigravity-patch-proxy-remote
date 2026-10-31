# REVERSE ENGINEERING — RAPPORT FORENSIC COMPLET

**Date** : 2026-09-02  
**Cible** : Google Antigravity (Build Electron v2.11.0 / Language Server CL 971157550)  
**Emplacement des artefacts** : `remote/vendor/antigravity/` & `remote/vendor/agents/reverse-skill-main/`  
**Workspace de travail** : `reverse-work/`  

---

## 1. Executive Summary

L'analyse forensic et de rétro-ingénierie a porté sur la distribution packagée vendored de **Google Antigravity** (`v2.11.0`), comprenant le shell applicatif Electron, l'archive packagée `app.asar`, le moteur Go compilé `language_server.exe` (146 Mo), l'encodeur multimédia `webm_encoder.exe`, ainsi que l'ensemble des bibliothèques dynamiques d'exécution (`ffmpeg.dll`, `dxcompiler.dll`, etc.).

### Conclusions Majeures :
1. **Nature de l'Architecture** : Antigravity est une application hybride composée d'un conteneur Electron (v8 / Chromium) servant d'interface graphique et orchestrateur local, communiquant via gRPC-Web / ConnectRPC sur loopback HTTP (`127.0.0.1`) avec un binaire résident compilé en Go monolithique (`language_server.exe`).
2. **État Forensic des Fichiers Vendored** :
   - `resources/bin/language_server.exe` a subi un patch binaire chirurgical exact de **30 octets** aux offsets `47789169–47789199`, remplaçant `https://cloudcode-pa.googleapis.com` par `http://localhost:51074/v1internal/x` pour intercepter les flux Cloud Code.
   - `resources/app.asar` est une version modifiée et surchargée (22.5 Mo contre 4.5 Mo pour l'original `app.asar.bak`), intégrant un runtime proxy (`proxy-runner.js`), des traducteurs d'API LLM tiers, et 16 nouveaux canaux IPC.
   - Une anomalie de packing a été relevée : le répertoire de test `dist/__mocks__` a été injecté dans l'asar vendored (identifié dans les scripts de maintenance comme artefact potentiellement instable en production).
3. **Absence d'Obfuscation Malveillante ou Chiffrement Fermé** : Aucune section PE ne présente d'entropie anormale (> 7.2). Les fichiers JavaScript sont minifiés et transpilés (TypeScript/CommonJS), sans packer (type UPX, VMP, Themida). Le binaire Go conserve l'intégralité de sa table de symboles `pclntab`, de ses schémas protobuf et de ses routes ConnectRPC.

---

## 2. Environment

- **Système d'exploitation** : Windows 11 Pro (amd64 / x86_64)
- **Node.js** : v22.22.0
- **Go toolchain** : go1.26.2 windows/amd64
- **Python** : 3.12 (avec modules forensic `pefile`, `capstone`, `cryptography`)
- **PowerShell** : Windows PowerShell 5.1
- **Boîte à outils de rétro-ingénierie** : `agents/reverse-skill-main` (Framework modulaire de 43 règles de routage et 44 modules d'analyse)

---

## 3. Tools Discovered in `reverse-skill-main`

L'inspection de `remote/vendor/agents/reverse-skill-main/reverse-skill-main` a révélé un framework d'automatisation et de triage forensic pour agents d'analyse :

### Inventaire Détaillé des Outils :

| Nom | Chemin Relatif | Type | Entrées | Sorties | Commande d'Exécution | Dépendances | Utilité ASAR / Binaires |
|---|---|---|---|---|---|---|---|
| **master-route** | `skills/scripts/master-route.ps1` (`.sh`) | Routeur heuristique | Texte d'intention / tâche | Route primaire (`SKILL.md`) + `route-scope.md` | `powershell -File skills/scripts/master-route.ps1 -Hint "<task>"` | PowerShell / Bash | Classification automatique de la méthodologie d'analyse |
| **case-init** | `skills/scripts/case-init.ps1` (`.sh`) | Gestionnaire de cas | Nom de cas, URL/Sample, profil réseau | Arborescence `work/<case>/` (`scope.md`, `timeline.md`, etc.) | `powershell -File skills/scripts/case-init.ps1 -CaseName "<name>" -Preset offline-sample -Sample "<path>"` | PowerShell / Bash | Initialisation étanche et conforme aux règles d'engagement forensic |
| **append-evidence**| `skills/scripts/append-evidence.ps1` | Enregistreur de preuves | CaseRoot, ID, Title, ReproCommand | Fiche de preuve `evidence/E-XXX.md` | `powershell -File skills/scripts/append-evidence.ps1 -CaseRoot "<case>" -Id "E-001" -Title "..."` | PowerShell / Python | Journalisation reproductible sans écrasement |
| **thick-client** | `skills/thick-client/SKILL.md` | Guide & Méthodologie | Fichiers ASAR, exécutables Electron | Rapports d'architecture, décompilation JS | Lecture / Processus pas à pas | `@electron/asar`, Node | Spécifique à l'analyse approfondie d'Electron (`app.asar`) |
| **go-rust-reverse**| `skills/go-rust-reverse/SKILL.md` | Méthodologie RE | Binaires compilés Go / Rust | Table de symboles, structures internes | `go version -m`, scripts de carving | Go toolchain, Python | Analyse de `language_server.exe` et `webm_encoder.exe` |
| **binary-diff** | `skills/binary-diff/SKILL.md` | Méthodologie & diff | 2 fichiers binaires | Cartographie des offsets modifiés | Comparateurs octet par octet / Radiff2 | Outils CLI / Scripts Node/Py | Détection chirurgicale des modifications entre `.exe` et `.bak` |
| **protocol-reverse**| `skills/protocol-reverse/SKILL.md` | Analyseur de protocoles | Binaires, dumps réseau | Définitions Proto3, endpoints RPC | String carving, protobuf parsers | Python, `@bufbuild/protobuf` | Extraction des schémas ConnectRPC et gRPC-Web |

---

## 4. File Inventory & Hashes

Inventaire complet certifié SHA-256 des binaires et archives du dossier vendored (`remote/vendor/antigravity`) :

| Fichier | Taille (octets) | SHA-256 | Format | Architecture | Packing / État |
|---|---|---|---|---|---|
| `Antigravity.exe` | 222,848,000 | `e4b0a4077543627765a412ca4ac0e746ec670caa71ec8d56c69ac8d806743b83` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `d3dcompiler_47.dll` | 4,741,480 | `c8e25abd3d45dfb55966a74613258c39b4a83ea2ac77f2f80903499f4d5c03f0` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `dxcompiler.dll` | 25,664,512 | `1009efd7e76cd4811fc91c71a771ec9c4294a672c81409f4673c77ddcc8568e8` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `dxil.dll` | 1,503,600 | `436f128f22050ae27323da61321a469de0678def7a4e6d86f9ccad4858724f0a` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `ffmpeg.dll` | 3,094,528 | `2ee497a8d8917861683337c10cda719ee019f5483b509effc02a0390a52e8947` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `libEGL.dll` | 520,704 | `73b958605cac8990e8c30ba9195b434627782b0cfa18b264e4b0297dd782259c` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `libGLESv2.dll` | 7,954,432 | `53ba62da3c940f38c757d6cbd6b42b00e9756ac223425768f434d6d0ee94d3c8` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `resources/app.asar` | 22,508,253 | `861b2b850dc82456f2c864b8a1df6c5fec027faddc36a43096ae7566e36960cc` | Unknown | N/A | None |
| `resources/app.asar.bak` | 4,526,306 | `c21a013797376cf92cc2a821706e6af4d77f020aa233796c4f9e8ee066a29187` | Unknown | N/A | None |
| `resources/bin/language_server.exe` | 153,057,280 | `8f904a875373330a5964fc06db15d0b9d4d4f2f3990f50be409589bf2815e11c` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `resources/bin/language_server.exe.bak` | 153,057,280 | `701d9a66ee57b272fd7961f1a2f380be6e11daa7819530af059bbc4b2e82337d` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `resources/bin/webm_encoder.exe` | 13,615,104 | `0467f9b88fbf709229e7cb0e7c87297a1be80ffdfadff852f3bd933a92432bc9` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `resources/elevate.exe` | 107,520 | `9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37` | PE (Windows Executable) | x86 (i386) | None |
| `snapshot_blob.bin` | 341,312 | `7fe061d4f516ae70d772f8ec2891d89dcd25368f1639e712d4148796335a4124` | V8 Snapshot Binary | x86_64 | None |
| `v8_context_snapshot.bin` | 715,208 | `0ac67d268dc3d719d0b180bf5ee33fe501ec6be77fda41d4b40abb630e44e6bf` | V8 Snapshot Binary | x86_64 | None |
| `vk_swiftshader.dll` | 5,622,784 | `00173c2e5d3c1b9542a569f918aae271f31086aa4b2be3957e9502a8595dfe0f` | PE (Windows Executable) | x86_64 (AMD64) | None |
| `vulkan-1.dll` | 952,320 | `191f762ae32c93110daf18c5b2c39642fa086a408826c91ca232875219db077e` | PE (Windows Executable) | x86_64 (AMD64) | None |

---

## 5. Analyse Détaillée de `app.asar`

### 5.1 En-tête ASAR et Table des Fichiers
- **Structure physique** :
  - `Magic` : UInt32LE = `4`
  - En-tête JSON stocké en début de fichier à l'offset 16.
  - `app.asar.bak` (Stock Google) : En-tête JSON de **273 948 octets**, répertoriant **1 190 fichiers**.
  - `app.asar` (Patched/Vendored) : En-tête JSON de **341 067 octets**, répertoriant **1 453 fichiers**.
- **Fichiers déballés (`app.asar.unpacked`)** :
  - `mitm/` : Contient le proxy HTTPS local de contournement (`mitm_443.js`, scripts de démarrage et certificats TLS racine générés localement).
  - `node_modules/chrome-devtools-mcp/` : Implémentation du serveur MCP pour le pilotage DevTools de Chrome.

### 5.2 Comparaison Différentielle : Stock (`app.asar.bak`) vs Surchargé (`app.asar`)
1. **Modules Infiltrés / Ajoutés** :
   - À la racine : `proxy-runner.js` (orchestrateur autonome de proxy).
   - Dans `dist/` : Infiltration d'un moteur complet de proxy LLM (`proxy/`, `proxy.js`, `cryptoStore.js`, `customModelStore.js`, `schemaValidator.js`, `configExchange.js`).
   - Surcharge de `dist/main.js` :
     ```javascript
     // Ligne 2-3 de dist/main.js :
     // v2.5.x patch: start the proxy runner as a side-effect import.
     require('../proxy-runner');
     ```
   - Interception dynamique dans `dist/main.js` :
     ```javascript
     // Lignes 178-181 :
     const proxyPort = require('./proxy').getProxyPort();
     if (proxyPort > 0) {
         const redirectTarget = `http://127.0.0.1:${proxyPort}/GetAvailableModels?ls=${encodeURIComponent(details.url)}`;
     }
     ```

---

## 6. Architecture JavaScript & Canaux IPC

### 6.1 Processus Principal (`dist/main.js`) et Pont (`dist/hostBridgeServer.js`)
Le processus principal Electron instancie un serveur HTTP ConnectRPC interne sur loopback (`127.0.0.1:random_port`) avec un jeton Bearer cryptographiquement aléatoire (32 octets hex). Ce pont expose `HostBridgeService` pour permettre à `language_server.exe` de vérifier l'état des mises à jour et appliquer les paquets.

### 6.2 Preload Scripts (`dist/preload.js`)
L'API `contextBridge.exposeInMainWorld` expose les interfaces suivantes au Renderer :
- `electronUpdater`
- `dialog`
- `nativeNotifications`
- `nativeStorage`
- `logs`
- `extensions`
- `deepLink`
- `agent`
- `electronNative`
- `ide`

### 6.3 Canaux IPC
- **Stock (26 canaux)** :
  - `dialog:open-workspace`, `dialog:open-workspaces`
  - `updater:apply`, `updater:quit-and-install`, `updater:get-state`, `updater:check-for-updates`
  - `storage:get-items`, `storage:update-items`
  - `window:minimize`, `window:maximize`, `window:unmaximize`, `window:close`, `window:toggle-devtools`
  - `shell:open-external`, `shell:reveal-in-file-picker`
  - `ide:is-installed`
- **Surchargés par le Proxy (16 canaux additionnels découverts)** :
  - `storage:get-custom-models`, `storage:save-custom-model`, `storage:delete-custom-model`
  - `storage:get-providers`, `storage:save-provider`, `storage:delete-provider`
  - `storage:test-model-connection`, `storage:fetch-models`, `storage:fetch-provider-models`
  - `storage:export-providers-base64`, `storage:import-providers-base64`

---

## 7. Analyse des Binaires Natifs

### 7.1 `language_server.exe`
- **Compilateur** : Go (version exacte extraite : `go1.28-20260721-RC01 cl/951519500 +3ebc191975 X:boringcrypto,simd,mapsplitgroup`).
- **Build Stamp** :
  - Date : `2026-08-26 11:43:47 +0100 WAT`
  - CL : `971157550` (baseline `969546925` sur `//depot/branches/antigravity_web_release_branch/969546925.1/google3`).
- **Sections PE & Entropie** :
  - `.text` : 45 877 248 octets (Entropie : 6.21)
  - `.rdata` : 79 967 232 octets (Entropie : 5.96)
  - `.data` : 23 940 096 octets (Entropie : 6.63)
  - Sections de métadonnées Go/Google : `google_i`, `protodes`, `flags_he`.
- **Analyse du Patch Binaire (Diff vs `language_server.exe.bak`)** :
  - Offset exact : `47789169` à `47789199` (31 octets de span, 30 octets modifiés).
  - Original : `https://cloudcode-pa.googleapis.com` (35 octets).
  - Patché : `http://localhost:51074/v1internal/x` (35 octets).
  - Conséquence : Toute requête sortante de prédiction / chat adressée à l'infrastructure Cloud Code de Google est redirigée en clair vers le proxy local sur le port 51074.

### 7.2 `Antigravity.exe`
- **Rôle** : Exécutable stub Electron packagé (Chromium wrapper).
- **Subsystem** : Windows GUI.
- **Entropie** : 6.53 (.text). Pas de packer externe détecté.
- **PDB de compilation** : `electron.exe.pdb`.

### 7.3 `resources/bin/webm_encoder.exe`
- **Compilateur** : Également Go (`go1.28-20260721-RC01 cl/951519500`).
- **Rôle** : Encodage vidéo temps réel des sessions d'enregistrement de navigateur (WebM) pour l'historique d'exécution des agents.

---

## 8. Détection Cryptographique & Obfuscation

- **Entropie des Sections** : Toutes les sections mesurées se situent entre 4.0 et 6.9, confirmant l'absence de crypteur ou de compression polymorphique.
- **Modules Cryptographiques Détectés** :
  - Le binaire Go intègre `X:boringcrypto` (implémentation FIPS de Google basée sur BoringSSL pour TLS 1.3, AES-GCM et signatures elliptiques).
  - Dans le code Electron JS, `node:crypto` est utilisé pour la génération de jetons d'authentification (`crypto.randomBytes(32)`) et la validation temporelle sécurisée (`crypto.timingSafeEqual`).
  - Stockage des clés API du proxy : Chiffré via Electron `safeStorage` (Windows DPAPI) dans `CryptoStore`.

---

## 9. Analyse Réseau & Protocoles de Sérialisation

### 9.1 Protocoles Utilisés
1. **ConnectRPC / gRPC-Web sur HTTP/1.1 et HTTP/2** :
   - Encapsulation des requêtes via Protobuf binaire ou JSON de cadrage (`application/grpc-web+proto` ou Connect streaming).
   - Messages délimités par préfixe de longueur à 5 octets (1 octet de flag de compression + 4 octets Big-Endian).

### 9.2 Endpoints et Services Révélés dans le Binaire Go :
- **Services Principaux** :
  - `/exa.language_server_pb.LanguageServerService/*` (305 méthodes découvertes, dont `GetAvailableModels`, `StartCascade`, `SendUserCascadeMessage`, `RetrieveUserQuotaSummary`, etc.)
  - `/google.internal.cloud.code.v1internal.PredictionService/*` (`FetchAvailableModels`, `RetrieveUserQuotaSummary`)
  - `/devtools_jetski_boq_api_proto.ApiService/*` (Télémétrie et signaling Cloud)
  - `/exa.host_bridge_pb.HostBridgeService/*` (`GetUpdateStatus`, `ApplyUpdate`)

---

## 10. Architecture Reconstruite de l'Application

```
+-------------------------------------------------------------------------+
|                      Google Antigravity Desktop                        |
|                                                                         |
|  +---------------------------+       +-------------------------------+  |
|  | Renderer UI (HTML/React)  | <---> | Electron Preload (contextB.)  |  |
|  +---------------------------+       +-------------------------------+  |
|               ^                                      ^                  |
|               | (WebViews / CDP)                     | IPC Channels     |
|               v                                      v                  |
|  +-------------------------------------------------------------------+  |
|  | Electron Main Process (dist/main.js)                              |  |
|  |  * HostBridgeServer (127.0.0.1:ephemeral) [Bearer Auth]           |  |
|  |  * Injected Proxy Runner (127.0.0.1:51074)                        |  |
|  +-------------------------------------------------------------------+  |
|               |                                      ^                  |
|    Spawns CLI | Process Stdio                        | ConnectRPC       |
|               v                                      v (HostBridge)     |
|  +-------------------------------------------------------------------+  |
|  | Go Language Server (language_server.exe :55256 loopback)          |  |
|  |  * Core Cascade / Trajectory Engine                               |  |
|  |  * Embedded WebM Encoder Helper                                   |  |
|  |  * Cloud Code Endpoint Redirect -> http://localhost:51074         |  |
|  +-------------------------------------------------------------------+  |
|                               |                                         |
+-------------------------------|-----------------------------------------+
                                v (Intercepted traffic)
                +-------------------------------+
                | Antigravity Patch Proxy       |
                | (Translators: OpenAI/Claude)  |
                +-------------------------------+
                                |
                                v (External LLMs)
                https://api.openai.com / anthropic
```

---

## 11. Preuves Techniques & Registre Forensic

- **E-001** : Confirmation par diff d'octets de la neutralisation de l'endpoint Google dans `language_server.exe` au profit de `http://localhost:51074/v1internal/x`.
- **E-002** : Détection dans `app.asar` de l'injection du proxy et des surcharges IPC sans altération des signatures des modules originaux.
- **E-003** : Identification formelle de la version de compilation du serveur Go (`CL 971157550`, toolchain `go1.28-20260721-RC01`).

---

## 12. Niveaux de Confiance des Découvertes

| Composant / Découverte | Niveau de Confiance | Justification |
|---|---|---|
| Patch 35 octets sur `language_server.exe` | **CONFIRMED** | Analyse différentielle octet par octet avec fichier original `.bak`. |
| Version interne Go et build label | **CONFIRMED** | Lecture directe via `go version -m` et flag `--stamp`. |
| Structure des routes ConnectRPC (305 méthodes) | **CONFIRMED** | Carving direct des descripteurs de services dans la section `.rdata`. |
| Rôle des canaux IPC Electron | **HIGH CONFIDENCE** | Extraction directe de l'arbre syntaxique du code source extrait de l'ASAR. |
| Détection d'absence de malware/obfuscation | **HIGH CONFIDENCE** | Calcul d'entropie de Shannon sur l'ensemble des sections PE. |

---

## 13. Recommandations

1. **Nettoyage de l'ASAR** : Purger systématiquement le répertoire `dist/__mocks__` avant packaging en production afin d'éliminer tout risque d'instabilité du résolveur de modules d'Electron.
2. **Gestion des Certificats MITM** : Conserver les clés privées du certificat d'interception local dans un magasin sécurisé (DPAPI) plutôt qu'en clair sous `app.asar.unpacked/mitm/certs/`.
3. **Surveillance des Mises à Jour Automatiques** : Maintenir l'auto-heal actif (`scripts/auto-heal.ps1`) car toute mise à jour officielle de Google écrasera le patch de 30 octets dans `language_server.exe` et rétablira le binaire officiel d'origine.
