# Antigravity v2.2.x — Guide complet : Custom Models + MITM 443

**Projet** : `antigravity-patch-proxy`
**Objectif** : ajouter et utiliser des modèles LLM custom (OpenAI/Anthropic/custom) dans l'application desktop **Antigravity** sous Windows 11 + WSL2.
**Stratégie** : **patch chirurgical** (`scripts/patch_2_2_1.js`) + MITM 443 — fonctionne avec **toutes** les versions v2.2.x publiées via auto-update.
**Date** : 2026-07-13

---

## Table des matières

1. [Architecture](#architecture)
2. [Prérequis](#prérequis)
3. [Installation initiale sur une nouvelle machine](#installation-initiale-sur-une-nouvelle-machine)
4. [Erreurs rencontrées et corrections](#erreurs-rencontrées-et-corrections)
5. [Fichiers du projet](#fichiers-du-projet)
6. [Procédure de démarrage quotidienne](#procédure-de-démarrage-quotidienne)
7. [Recompiler / repatcher après modification du code](#recompiler--repatcher-après-modification-du-code)
8. [Rollback](#rollback)
9. [Dépannage rapide](#dépannage-rapide)
10. [Limitations](#limitations)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Antigravity Desktop (v2.2.x)                          │
│  ┌──────────────┐   HTTPS    cloudcode-pa.googleapis.com:443                 │
│  │ UI renderer  │──────────▶  (hosts Windows → 127.0.0.1:443)               │
│  └──────────────┘                                                           │
│  ┌──────────────┐   HTTPS    127.0.0.1:${AG_PROXY_PORT:-51074}                                │
│  │ Language S.  │──────────▶  (binary patch redirige vers le proxy local)   │
│  └──────────────┘                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     │                                     │
                     ▼                                     ▼
          ┌─────────────────────┐              ┌─────────────────────┐
          │ MITM HTTPS :443     │              │  Proxy local :${AG_PROXY_PORT:-51074}  │
          │ cert *.googleapis   │──────────────│ dist/proxy.js patché│
          └─────────────────────┘   HTTP       └─────────────────────┘
                                                            │
                                                            ▼ HTTPS
                                                 ┌─────────────────────┐
                                                 │ Resolver public DNS │
                                                 │ 8.8.8.8 / 1.1.1.1   │
                                                 └─────────────────────┘
                                                            │
                                                            ▼
                                                 Google APIs réelles
```

**Pourquoi tout ça ?**
- Antigravity est pensé pour appeler **Gemini** (Google).
- Le patch `antigravity-add-model` intercepte les appels API et les redirige vers d'autres providers.
- Pour intercepter le trafic, le `hosts` Windows redirige les domaines Google vers `127.0.0.1`.
- Mais Antigravity communique en **HTTPS**, donc il faut un MITM TLS sur le port 443 avec un certificat trusté.

**Stratégie patch — clé v2.2.x :**
- Le projet utilise un **patch chirurgical** (`scripts/patch_2_2_1.js`) qui injecte **uniquement** les 3 modules manquants — `cryptoStore.js`, `customModelStore.js`, `schemaValidator.js` — dans l'archive `app.asar` extraite. **Aucun autre fichier** n'est touché (en particulier `dist/main.js` et `dist/preload.js` ne sont **jamais** réécrits).
- **L'auto-update est conservé.** Après chaque mise à jour d'Antigravity, il suffit de relancer `repatch.bat` pour réappliquer le patch. Aucune manipulation de désinstallation n'est nécessaire.
- Le `repack_safe.sh` complet (stratégie v2.0.1) est **interdit** : il écrasait `dist/main.js` et `dist/preload.js` et cassait le runtime.

---

## Prérequis

| Outil | Version / détail |
|---|---|
| Windows | 10/11 avec WSL2 activé |
| Node.js | Installé sur Windows **et** dans WSL (`C:\Program Files\nodejs\node.exe` et `~/.nvm/...`) |
| Antigravity | v2.2.x (toute version publiée via auto-update) installé dans `%LOCALAPPDATA%\Programs\antigravity\` |
| PowerShell | Pour exécuter le script admin |
| Droits admin | Nécessaires pour lier le port 443 et importer un certificat racine |

> **Note** : WSL est utilisé pour le développement (compiler, repacker). Le runtime final (MITM + Antigravity) tourne sur Windows.

---

## Installation initiale sur une nouvelle machine

### Étape 1 — Récupérer le projet

Cloner ou copier le dossier `antigravity-add-model-main` sur votre machine.

### Étape 2 — Vérifier Antigravity v2.2.x

```powershell
# Vérifier la version installée
Get-Content "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar" | Select-String '"version":'
# Doit afficher "version": "2.2.x"
```

Toutes les versions **2.2.x** sont supportées. Si une mise à jour sort, il suffit de relancer `repatch.bat` (voir §7).

### Étape 3 — Générer les certificats

Dans WSL, depuis le projet :

```bash
cd certs

# CA
openssl genrsa -out ca-key.pem 2048
openssl req -x509 -new -nodes -key ca-key.pem -sha256 -days 3650 -out ca-cert.pem \
  -subj "/CN=Antigravity MITM CA/O=Antigravity" \
  -extensions v3_ca -config ../certs/ca.conf

# Server cert *.googleapis.com
openssl genrsa -out server-key.pem 2048
openssl req -new -key server-key.pem -out server-csr.pem -subj "/CN=*.googleapis.com"
openssl x509 -req -in server-csr.pem -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out server-cert.pem -days 365 -sha256 \
  -extensions v3_server -extfile ../certs/server.conf
```

Les fichiers `ca.conf` et `server.conf` sont déjà dans `certs/`.

### Étape 4 — Patch chirurgical de app.asar

Dans WSL, depuis la racine du projet :

```bash
cd /chemin/vers/antigravity-add-model-main
npm install
npm run build
node scripts/patch_2_2_1.js
```

`patch_2_2_1.js` va :
- extraire l'asar actuel dans `app.asar.unpacked/`
- injecter **uniquement** `cryptoStore.js`, `customModelStore.js`, `schemaValidator.js` dans le bundle dist
- recréer `app.asar`
- créer un backup `app.asar.bak`

> ⚠️ **N'écrasez pas `dist/main.js` ni `dist/preload.js`.** Le patch ne touche jamais ces fichiers. Si vous utilisez un outil tiers qui remplace `dist/`, lancez d'abord `npm run build` puis réappliquez le patch chirurgical.

### Étape 5 — Configurer le hosts Windows

Vérifier que `C:\Windows\System32\drivers\etc\hosts` contient :

```
127.0.0.1 daily-cloudcode-pa.googleapis.com
::1 daily-cloudcode-pa.googleapis.com
127.0.0.1 cloudcode-pa.googleapis.com
::1 cloudcode-pa.googleapis.com
127.0.0.1 daily-cloudcode-pa.sandbox.googleapis.com
::1 daily-cloudcode-pa.sandbox.googleapis.com
127.0.0.1 autopush-cloudcode-pa.sandbox.googleapis.com
::1 autopush-cloudcode-pa.sandbox.googleapis.com
```

### Étape 6 — Créer le raccourci bureau

Le fichier `Start Antigravity MITM.bat` doit exister à la racine du projet (et être épinglé au bureau) :

```bat
@echo off
set SCRIPT=%~dp0start_mitm_443.ps1
powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File \"%SCRIPT%\"'"
```

### Étape 7 — Démarrer pour la première fois

1. Double-clic sur `Start Antigravity MITM.bat` (accepter l'UAC admin).
2. Attendre le message `[MITM-443] Listening on https://127.0.0.1:443`.
3. Lancer Antigravity.
4. Vérifier dans `%APPDATA%\Antigravity\logs\main.log` :

```
[Proxy] Server listening on http://127.0.0.1:${AG_PROXY_PORT:-51074}
[Proxy] Loaded custom models count: <N>
[Proxy] Custom model "<votre-model>" => ...
```

---

## Erreurs rencontrées et corrections

### Erreur 1 : `Failed to parse custom_models.json`

**Symptôme** :

```
SyntaxError: Unexpected token '', "{... is not valid JSON
[Proxy] Loaded custom models count: 0
```

**Cause** : le fichier `custom_models.json` a un BOM UTF-8 (`EF BB BF`) ajouté par Notepad Windows ou PowerShell `Out-File`.

**Correction** :

```bash
# Strip BOM
tail -c +4 custom_models.json > custom_models.json.tmp
mv custom_models.json.tmp custom_models.json
```

Et patch défensif dans `src/proxy.ts` :

```typescript
let content = fs.readFileSync(filePath, 'utf-8');
if (content.charCodeAt(0) === 0xFEFF) {
  content = content.slice(1);
}
```

---

### Erreur 2 : `ECONNREFUSED 127.0.0.1:443`

**Symptôme** :

```
[Proxy] Forwarding fetchAvailableModels failed: Error: connect ECONNREFUSED 127.0.0.1:443
```

**Cause** : le proxy forwardait vers `https://daily-cloudcode-pa.googleapis.com`, mais le `hosts` Windows redirige ce domaine vers `127.0.0.1`. Le proxy essayait de se connecter à lui-même.

**Correction** : utiliser un resolver DNS public qui ignore le `hosts` :

```typescript
const googleDnsResolver = new dns.Resolver();
googleDnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

async function resolveGoogleIp(hostname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    googleDnsResolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        reject(err || new Error(`No DNS records for ${hostname}`));
      } else {
        resolve(addresses[0]);
      }
    });
  });
}
```

Puis remplacer le hostname de l'URL par l'IP et ajouter `servername` pour le SNI TLS.

---

### Erreur 3 : `Invalid IP address: undefined`

**Symptôme** :

```
TypeError [ERR_INVALID_IP_ADDRESS]: Invalid IP address: undefined
```

**Cause** : utiliser l'option `lookup` de `https.request` avec un callback personnalisé posait des problèmes de compatibilité avec le moteur DNS interne de Node/Electron.

**Correction** : ne plus utiliser l'option `lookup`. Résoudre l'IP en amont de manière asynchrone, remplacer `parsedUrl.hostname` par l'IP, et passer `servername: targetHost` dans les options HTTPS.

---

### Erreur 4 : `certificate signed by unknown authority`

**Symptôme** :

```
tls: failed to verify certificate: x509: certificate signed by unknown authority
```

**Cause** : le renderer / language_server Go ne trustait pas la CA auto-signée.

**Correction** :
- Générer une CA avec les bonnes extensions (`Key Usage = Certificate Sign, CRL Sign`).
- Importer la CA dans `Cert:\LocalMachine\Root` **et** `Cert:\CurrentUser\Root`.
- Le script `start_mitm_443.ps1` le fait automatiquement.

---

### Erreur 5 : `Parse Error: Content-Length can't be present with Transfer-Encoding`

**Symptôme** :

```
[MITM-443] Forward error: Parse Error: Content-Length can't be present with Transfer-Encoding
```

**Cause** : le proxy modifiait les réponses Google et ajoutait `Content-Length` sans supprimer l'ancien header `Transfer-Encoding: chunked`.

**Correction** dans `src/proxy.ts` :

```typescript
delete modifiedHeaders['content-encoding'];
delete modifiedHeaders['transfer-encoding'];
modifiedHeaders['content-length'] = String(modifiedBuffer.length);
```

---

### Erreur 6 : Renderer fait des appels directs à `cloudcode-pa.googleapis.com`

**Symptôme** :

```
main.js:11728 Failed to fetch NUX configs: ... Get "https://cloudcode-pa.googleapis.com/...": dial tcp 127.0.0.1:443
```

**Cause** : le bundle renderer d'Antigravity contient des URLs Google en dur. Le `hosts` les envoie vers `127.0.0.1:443`, mais rien n'écoute sur 443.

**Correction** : lancer le MITM HTTPS sur le port 443 avec un certificat valide pour `*.googleapis.com`. Le MITM termine le TLS et forwarde en HTTP vers le proxy local.

---

### Erreur 7 : URLs réécrites en `http://` cassent le renderer

**Symptôme** : le renderer reçoit des URLs `http://cloudcode-pa.googleapis.com` qui échouent (mixed content / port 80 vide).

**Cause** : le proxy réécrivait systématiquement `https://...googleapis.com` en `http://${req.headers.host}`. Pour les requêtes via MITM, `req.headers.host` est le domaine Google.

**Correction** : conserver `https://` quand l'hôte est un domaine Googleapis :

```typescript
const proxyProto = proxyHost.endsWith('.googleapis.com') ? 'https:' : 'http:';
text = text.replace(/https:(\/\/)cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
```

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `src/proxy.ts` | Cœur du proxy. Contient le DNS bypass, l'interception `fetchAvailableModels`, le forwarding Google, la gestion des modèles custom. |
| `dist/proxy.js` | Version compilée. C'est ce fichier qui est injecté dans `app.asar` via le patch chirurgical. |
| `src/cryptoStore.ts` | Module ajouté par le patch — gère l'encryptage `safeStorage` des clés API. |
| `src/customModelStore.ts` | Module ajouté par le patch — charge/valide `custom_models.json`. |
| `src/schemaValidator.ts` | Module ajouté par le patch — valide la structure des modèles. |
| `scripts/patch_2_2_1.js` | **Patcheur chirurgical** — injecte les 3 modules ci-dessus dans `app.asar`. |
| `scripts/mitm/mitm_443.js` | Forwarder HTTPS 443 → HTTP ${AG_PROXY_PORT:-51074}. |
| `scripts/mitm/start_mitm_443.ps1` | Script PowerShell admin : importe la CA et lance `mitm_443.js`. |
| `scripts/deploy/deploy.ps1` | Déploiement complet (Windows). |
| `scripts/repack/repack.ps1` | Recompile + repack complet (utilisé en secours). |
| `scripts/repack/repack_safe.sh` | Variante WSL safe (utilisée en secours). |
| `certs/ca-cert.pem` | Certificat racine auto-signé. Doit être trusté dans Windows. |
| `certs/server-cert.pem` | Certificat serveur pour `*.googleapis.com`. |
| `certs/server-key.pem` | Clé privée du serveur MITM. |
| `certs/ca.conf` | Config OpenSSL pour la CA. |
| `certs/server.conf` | Config OpenSSL pour le cert serveur. |
| `ANTIGRAVITY_SETUP.md` | Ce guide. |

---

## Procédure de démarrage quotidienne

1. **Double-clic** sur le bureau : `Start Antigravity MITM.bat`
2. **Accepter l'UAC** (administrateur).
3. Attendre dans la fenêtre PowerShell :
   ```
   [MITM-443] Listening on https://127.0.0.1:443
   ```
4. **Lancer Antigravity** normalement.
5. Optionnel : vérifier les logs :
   ```powershell
   Get-Content "$env:APPDATA\Antigravity\logs\main.log" -Tail 20
   ```

---

## Recompiler / repatcher après modification du code

### Après modification du code TypeScript

Dans WSL :

```bash
cd /chemin/vers/antigravity-add-model-main
npm run build
node scripts/patch_2_2_1.js
```

Puis relancer Antigravity (le MITM peut rester ouvert).

### Après chaque mise à jour d'Antigravity (auto-update v2.2.x → v2.2.y)

Tant que la version reste **2.2.x**, il suffit de relancer le patch chirurgical :

```powershell
cd <dossier-du-projet>
.\repatch.bat
```

`repatch.bat` :
1. Tue Antigravity
2. Compile (`npm run build`)
3. Lance `scripts/deploy/deploy.ps1` qui extrait l'asar, copie le nouveau `dist/`, et repack

Si la mise à jour passe en **v2.3.x ou plus**, il faudra attendre une nouvelle version de `patch_2_2_1.js` adaptée, ou adapter le patcher à la nouvelle version.

---

## Rollback

Revenir à l'asar d'origine (avant le patch chirurgical) :

```powershell
Stop-Process -Name Antigravity, language_server -Force
copy "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.bak" `
     "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar"
```

---

## Dépannage rapide

| Problème | Cause probable | Solution |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:443` | MITM non démarré | Relancer `Start Antigravity MITM.bat` |
| `certificate signed by unknown authority` | CA non trustée | Relancer `start_mitm_443.ps1` |
| `Parse Error: Content-Length / Transfer-Encoding` | Vieux `dist/proxy.js` | `npm run build && node scripts/patch_2_2_1.js` |
| `Loaded custom models count: 0` | `custom_models.json` invalide / BOM | Strip BOM, vérifier JSON |
| Modèles custom absents après mise à jour Antigravity | Patch pas réappliqué | Lancer `repatch.bat` |
| MITM ne démarre pas sur 443 | Pas admin / port déjà utilisé | Vérifier UAC / tuer l'ancien MITM |
| `connectex: No connection could be made` sur ${AG_PROXY_PORT:-51074} | Proxy local n'a pas démarré | Inspecter `main.log` (chercher `[Proxy]` lines); redémarrer Antigravity |

---

## Limitations

- Nécessite un démarrage manuel du MITM à chaque session Windows.
- Le certificat CA expire **10 ans** après génération (`-days 3650`).
- L'auto-update d'Antigravity est **conservé** : tant que la version reste 2.2.x, un simple `repatch.bat` suffit. Pour les versions 2.3.x+ il faudra une mise à jour du patcher.
- Si Google change radicalement son API ou ses IPs anycast, le setup pourrait nécessiter un ajustement.
