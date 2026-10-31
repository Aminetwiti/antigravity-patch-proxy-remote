# Install & 443 refused: Diagnostic + Surgical fix

> Formerly part of the consolidated `FIX_ERROR.md` troubleshooting document.

# FIX_ERROR — Antigravity 2.2.1 : `127.0.0.1:443 connection refused`

> **Date du fix** : 2026-07-11
> **Versions concernées** : Antigravity 2.2.1, repo `antigravity-add-model-main` v2.1.0+
> **Patch de référence** : `scripts/patch_2_2_1.js`
> **Statut** : ✅ corrigé via patch chirurgical + MITM manuel sur 443

---

## ⚠️ TL;DR

L'erreur `127.0.0.1:443 connection refused` a **deux causes distinctes** qui
se manifestent ensemble si on n'en corrige qu'une :

1. **Cause #1 (corrigée par `scripts/patch_2_2_1.js`)** : trois modules
   `dist/cryptoStore.js`, `dist/customModelStore.js`, `dist/schemaValidator.js`
   sont absents de l'asar v2.2.1 déployé → le proxy ne démarre pas.
2. **Cause #2 (corrigée par `scripts/mitm/mitm_443.js`)** : le language server
   d'Antigravity fait des appels HTTPS directs à `daily-cloudcode-pa.googleapis.com`,
   qui est redirigé par le `hosts` file vers `127.0.0.1:443`. Le MITM doit y
   écouter pour terminer le TLS et forwarder vers le proxy HTTP sur ${AG_PROXY_PORT:-51074}.

**Les deux fixes sont nécessaires.** Sans le MITM sur 443, le proxy sur ${AG_PROXY_PORT:-51074}
tourne mais le LS continue à échouer avec `127.0.0.1:443 refused`.

---

## 1. Symptôme

Au lancement d'Antigravity 2.2.1 (après update depuis 2.1.0), le language server affiche
en boucle :

```
Post "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist":
dial tcp 127.0.0.1:443: connectex: No connection could be made because the
target machine actively refused it.
```

L'IDE s'ouvre mais :
- Aucun modèle custom n'est utilisable (erreur systématique sur `loadCodeAssist`).
- Le port `${AG_PROXY_PORT:-51074}` peut écouter ou non selon la cause racine (cf. TL;DR).
- Le port `443` n'écoute que sur `127.0.0.2` (PID `svchost.exe` — service Windows
  légitime, sans rapport) **tant que le MITM n'est pas démarré**.

---

## 2. Environnement affecté

| Composant | Valeur observée |
|---|---|
| `Antigravity.exe` (ProductVersion) | **2.2.1.0** |
| `app.asar` (wrapper) | 20 827 867 B, daté 2026-07-10 20:16 |
| `dist/main.js` (dans l'asar) | **14 554 B** — patché (TLS bypass + `require('../proxy-runner')` intégrés) |
| `dist/proxy.js` | ✓ présent |
| `dist/proxy/translators/*` | ✓ présent |
| `proxy-runner.js` (à la racine de l'asar) | ✓ présent |
| `dist/cryptoStore.js` | ❌ **absent** ← cause racine |
| `dist/customModelStore.js` | ❌ absent |
| `dist/schemaValidator.js` | ❌ absent |
| `hosts` file | `127.0.0.1 daily-cloudcode-pa.googleapis.com` (légitime) |
| Port ${AG_PROXY_PORT:-51074} | **DOIT écouter** (proxy HTTP, démarré par `proxy-runner.js`) |
| Port 443 sur 127.0.0.1 | **DOIT écouter** (MITM TLS, démarré par `scripts/mitm/mitm_443.js`) |

---

## 3. Diagnostic (timeline de la résolution)

1. **L'erreur initiale** (`127.0.0.1:443 refused`) est un **symptôme** : la chaîne
   d'appel aboutit à un port sans listener. Ce n'est pas la cause.

2. **Lecture du `main.log`** dans `%APPDATA%\Antigravity\logs\main.log` :

   ```
   [2026-07-11 12:52:46.567] [error] [PATCH] startProxy failed: Cannot find module '../cryptoStore'
   ```

   → le proxy ne peut pas se lancer car il lui manque `dist/cryptoStore.js`.

3. **Lecture de `src/proxy/modelLoader.ts`** (le caller de `cryptoStore`) :

   ```ts
   import * as cryptoStore from '../cryptoStore';
   ```

   → chemin relatif `../cryptoStore` résolu depuis `dist/proxy/` =
   `dist/cryptoStore.js`. **Absent de l'asar** → `MODULE_NOT_FOUND`.

4. **Lecture de `src/languageServer.ts`** pour comprendre le fallback :

   ```ts
   const apiServerUrl = proxyPort
     ? `http://localhost:${proxyPort}`
     : 'https://generativelanguage.googleapis.com';
   ```

   → quand `startProxy()` échoue, le LS reçoit les URLs Google **officielles**
   en fallback.

5. **Vérification du `hosts` file** :

   ```
   127.0.0.1 daily-cloudcode-pa.googleapis.com
   ```

   → la résolution DNS redirige vers `127.0.0.1`. Le LS tente alors le port
   `443` (HTTPS par défaut) → **connection refused** si le MITM n'est pas
   démarré.

### Chaîne de causalité complète

```
cryptoStore.js absent de l'asar
  → startProxy() throw MODULE_NOT_FOUND
    → languageServer.ts fallback sur les URLs Google réelles
      → DNS redirige daily-cloudcode-pa.googleapis.com vers 127.0.0.1
        → connection TCP vers 127.0.0.1:443 (HTTPS par défaut)
          → ECONNREFUSED si MITM off, OU forward réussi si MITM on
            → si forward réussi : 200 OK (proxy répond pour le LS)
            → si MITM off : erreur "Post ... v1internal:loadCodeAssist: dial tcp 127.0.0.1:443"
```

> **Note importante** : la chaîne ci-dessus ne décrit que la **Cause #1**
> (proxy ne démarre pas). Si le proxy démarre correctement MAIS que le MITM
> n'écoute pas sur 443, l'erreur `127.0.0.1:443 refused` se manifeste quand
> même, parce que certains appels HTTPS du language server bypass le proxy.
> cf. [mitm-443.md](mitm-443.md) for Cause #2.

---

## 4. Causes racines (deux causes, pas une)

### Cause #1 — Trois modules omis du pack v2.2.x

**Google a omis trois modules du bundle officiel d'Antigravity 2.2.x** :

| Module | Où il est requis | Conséquence de son absence |
|---|---|---|
| `dist/cryptoStore.js` | `dist/proxy/modelLoader.js` (`require('../cryptoStore')`) | `startProxy` crash → proxy off |
| `dist/customModelStore.js` | `dist/ipcHandlers.js` | Custom models list vides côté UI |
| `dist/schemaValidator.js` | `dist/proxy/translators/*` | Erreurs de validation runtime |

Ces trois modules sont présents dans le repo source (`src/`), compilés dans
`dist/` par `npm run build`, mais **omis** lors du repack de l'asar dans
certaines itérations.

### Cause #2 — MITM sur 443 jamais démarré automatiquement

**Le language server d'Antigravity fait certains appels HTTPS directs** à
`daily-cloudcode-pa.googleapis.com` qui **bypassent** le proxy sur ${AG_PROXY_PORT:-51074}.
Le `hosts` file redirige ces appels vers `127.0.0.1:443` (HTTPS par défaut),
mais le proxy sur ${AG_PROXY_PORT:-51074} est en HTTP plain — il ne peut pas intercepter du
HTTPS. **Le MITM `scripts/mitm/mitm_443.js` doit tourner en parallèle** pour
terminer le TLS et forwarder vers le proxy.

> **Erreur d'analyse initiale** : lors du diagnostic du 2026-07-11, j'avais
> affirmé à tort « le MITM sur 443 n'est pas requis pour le flow actuel »
> parce que `languageServer.ts` passe `http://localhost:${AG_PROXY_PORT:-51074}` au LS via
> `--api_server_url`. En réalité, le LS garde des appels HTTPS codés en dur
> pour `daily-cloudcode-pa.googleapis.com` (vu dans le `language_server.log`
> : `failed to get load code assist response: Post "https://cloudcode-pa.googleapis.com/...`)
> qui ne respectent pas ce flag.

### Pourquoi la Cause #1 est apparue (contexte historique)

La Cause #1 est liée à un **changement de structure d'asar entre 2.1.0 et 2.2.1**
(cf. session kimchi `019f4c39` du 2026-07-10, message de 14:02:01) :

| | Antigravity 2.0.x / 2.1.0 | Antigravity 2.2.x (officiel) |
|---|---|---|
| `dist/proxy.js` | ✅ présent | ❌ **supprimé par Google** |
| `dist/proxy/translators/*` | ✅ présent | ❌ **supprimé** |
| `proxy-runner.js` (racine) | ✅ | ✅ conservé comme hook |
| TLS bypass + `require('../proxy-runner')` dans `dist/main.js` | ✅ | ✅ conservé |
| `cryptoStore.js` / `customModelStore.js` / `schemaValidator.js` | ✅ (compilés) | ⚠️ **omis** (probablement par erreur de pack) |

L'asar v2.2.1 que Google livre inclut `dist/proxy.js` et les translators
(injectés par notre patch précédent), mais pas les 3 modules dépendants.

---

## 5. Le fix (chirurgical)

### Pourquoi « chirurgical » et pas « overlay complet »

Un overlay de `dist/` complet (toute la sortie `npm run build`) **casse
l'application** parce qu'il remplace `dist/main.js` :

| Fichier | Wrapper v2.2.1 patché | Repo `dist/` | Conséquence |
|---|---|---|---|
| `dist/main.js` | **14 554 B** (TLS bypass + `require('../proxy-runner')` intégrés) | **17 157 B** (clean) | ❌ patch integration perdue → app crash au boot |
| `dist/proxy.js` | ✓ | mon repo | écrasé inutilement |
| `dist/__mocks__/*` | ❌ | ✓ (mocks vitest) | ❌ Electron résout ces mocks comme modules → crash |
| `dist/cryptoStore.js` etc. | ❌ | ✓ | ✅ ajouté (correct) |

**Le fix correct** ajoute **uniquement les 3 fichiers manquants** et laisse
intact le `dist/main.js` du wrapper.

### Commandes de fix

```bash
REPO=/mnt/c/Users/developer/Downloads/antigravity-add-model-main/antigravity-add-model-main
RES=/mnt/c/Users/developer/AppData/Local/Programs/Antigravity/resources
TS=$(date +%Y%m%dT%H%M%S)

# 0. Stopper Antigravity + language_server
powershell.exe -Command "Stop-Process -Name Antigravity,language_server -Force -ErrorAction SilentlyContinue"

# 1. S'assurer que dist/ est à jour (sinon les 3 modules manquent)
cd "$REPO" && npm run build

# 2. Snapshot du asar actuel
cp "$RES/app.asar" "$RES/app.asar.pre-fix-$TS.bak"

# 3. Patcher (chirurgical, idempotent)
NODE_PATH="$REPO/node_modules" node "$REPO/scripts/patch_2_2_1.js" \
    "$RES/app.asar" "/tmp/ag-build-$TS" "/tmp/app.asar.fixed-$TS"

# 4. Vérifier le delta de taille (~40 KB attendu, >100 KB = suspect)
SIZE_BEFORE=$(stat -c %s "$RES/app.asar")
SIZE_AFTER=$(stat -c %s "/tmp/app.asar.fixed-$TS")
DELTA=$((SIZE_AFTER - SIZE_BEFORE))
echo "delta: $DELTA B"
[ $DELTA -gt 100000 ] && { echo "ABORT: delta too large"; exit 1; }

# 5. Déployer
cp "/tmp/app.asar.fixed-$TS" "$RES/app.asar"

# 6. Relancer
"$RES/../Antigravity.exe" &
```

### Fichiers effectivement ajoutés

| Fichier | Taille | Rôle |
|---|---|---|
| `dist/cryptoStore.js` | 5 679 B | Encryption API keys (safeStorage) |
| `dist/cryptoStore.d.ts` | 1 167 B | Types |
| `dist/cryptoStore.js.map` | 3 201 B | Source map |
| `dist/cryptoStore.d.ts.map` | 677 B | Source map |
| `dist/customModelStore.js` | 6 262 B | Persistance des modèles custom |
| `dist/customModelStore.d.ts` | 2 448 B | Types |
| `dist/customModelStore.js.map` | 3 407 B | Source map |
| `dist/customModelStore.d.ts.map` | 1 548 B | Source map |
| `dist/schemaValidator.js` | 7 769 B | Validation des réponses API |
| `dist/schemaValidator.d.ts` | 1 731 B | Types |
| `dist/schemaValidator.js.map` | 6 870 B | Source map |
| `dist/schemaValidator.d.ts.map` | 771 B | Source map |
| **TOTAL** | **~41 530 B** | |

---

## 6. Vérification post-fix

### 6.1 Ports

```bash
powershell.exe -Command "
Get-NetTCPConnection -LocalPort ${AG_PROXY_PORT:-51074} -State Listen -ErrorAction SilentlyContinue |
  Format-Table LocalAddress,LocalPort,OwningProcess,State -AutoSize
"
```

Attendu :

```
LocalAddress  LocalPort  OwningProcess  State
------------  ---------  -------------  -----
127.0.0.1     ${AG_PROXY_PORT:-51074}      <PID>          Listen
```

### 6.2 Log

```bash
grep -i "startProxy\|cryptoStore\|customModelStore" "$APPDATA/Antigravity/logs/main.log" | tail -5
```

Attendu :

```
[…] [info]  [LS] before startProxy
[…] [info]  [LS] after startProxy, port: ${AG_PROXY_PORT:-51074}
[…] [info]  [Proxy] Loaded custom models count: 5
[…] [info]  [Proxy] Custom model "minimax-m3" => slug: custom-minimax-m3 …
[…] [info]  [Proxy] Custom model "kimi-k2.7" => slug: custom-kimi-k2-7 …
```

**Aucune ligne** :

```
[…] [error] [PATCH] startProxy failed: Cannot find module '../cryptoStore'
```

### 6.3 Endpoints

```bash
powershell.exe -Command "
Get-Content '$env:APPDATA\Antigravity\logs\main.log' |
  Select-String -Pattern 'Response for /v1internal:' |
  Select-Object -Last 5
"
```

Attendu : tous `status: 200`.

---

## 7. Patcher durable

`scripts/patch_2_2_1.js` est conçu pour être réutilisé à chaque update
d'Antigravity. Caractéristiques :

- **Idempotent** : re-running sur un asar déjà patché ne change rien
  (delta = 0 B).
- **Safety check** : refuse de packager si le delta de taille dépasse
  100 KB (signe qu'un overlay complet non intentionnel s'est produit).
- **Doc embarquée** : le header explique la différence de version 2.0/2.1 vs
  2.2.x et la lesson learned.
- **3 étapes** : extract → inject 3 modules → repack.

Usage après un update d'Antigravity :

```bash
# Mettre à jour le binaire via le mécanisme standard de Google
# Puis relancer le patch :
NODE_PATH="$REPO/node_modules" node "$REPO/scripts/patch_2_2_1.js" \
    "$RES/app.asar" "/tmp/ag-build" "/tmp/app.asar.patched"
```

---
