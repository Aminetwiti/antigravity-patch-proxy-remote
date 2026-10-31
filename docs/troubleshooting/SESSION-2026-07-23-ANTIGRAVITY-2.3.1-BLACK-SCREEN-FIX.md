# Antigravity v2.3.1 — Black Screen Fix (Session 2026-07-23)

## ✅ Statut final

**Antigravity fonctionne maintenant correctement** — démarrage complet, UI visible, 6 modèles custom chargés, console propre.

---

## 📋 Contexte initial

- **Version** : Antigravity v2.3.1 (patch v2.3.x appliqué)
- **Symptôme** : Lancement OK pendant 3s (animation de chargement), puis **écran noir**
- **Proxy** : OK sur 127.0.0.1:50999
- **Language Server** : OK sur port 55365
- **6 modèles custom** : kr/claude-sonnet-4.5, MiniMax-M2.7, mystic/grok-4.5, posiden/hy3, kimi-k2.7, minimax-m3

---

## 🐛 Bugs identifiés et corrigés (par ordre chronologique)

### Bug #1 — Duplicate IPC handler

**Symptôme (logs)**
```
[2026-07-21 14:46:01.606] [error] [v2.3.x patch] registerIpcHandlers FAILED:
  Cannot read properties of undefined (reading 'ipcMain')
```

**Cause racine**
La regex dans `scripts/patch_2_3.js` (fonction `dedupeDuplicateIpcHandlers`) avait **trois défauts** :

| # | Défaut | Conséquence |
|---|--------|-------------|
| 1 | Quotes littérales `'` autour du channel | tsc minifié émet parfois `"…"` → 0 match |
| 2 | `String.replace(matches[i], ...)` sans flag `g` | Ne remplace que la 1ère occurrence, jamais la 2e |
| 3 | Boucle `for (let i = 0; i < matches.length - 1; i++)` qui itère sans re-match | Même si replace fonctionnait, `matches[0]` n'existe plus après le 1er replace → no-op silencieux |

**Fix**
Réécriture complète dans `scripts/patch_2_3.js` :
1. Regex avec `["']` pour matcher single ET double quotes
2. Brace-tracking char-par-char pour gérer les corps de handler imbriqués
3. Collecte exhaustive en 1ère passe via `exec()` en boucle `while`
4. Reconstruction par slicing au lieu de `String.replace()` — impossible de louper une occurrence

**Validation**
`scripts/test-patch-dedupe.js` couvre 9 cas (simples, doubles, mixtes, triples, imbriqués, no-op) → **9/9 verts**

---

### Bug #2 — Préfixe `electron_1.` non strippé

**Symptôme**
Après application du Bug #1 fix, l'app crashe avec `electron_1./* stripped */` = syntaxe JS invalide.

**Cause**
La regex matchait `ipcMain.handle(...)` mais pas le préfixe `electron_1.` (généré par la transpilation TypeScript).

**Fix**
Ajout du préfixe optionnel `(?:electron_\d+\.)?` dans le pattern de strip.

---

### Bug #3 — `Buffer is not defined` dans le renderer

**Symptôme (DevTools console)**
```
Error loading custom-model-store: ReferenceError: Buffer is not defined
  at Object.<anonymous> (plugin://custom-model-store/index.js:5:18)
```

**Cause racine**
`src/customModelStore.ts` ligne 119 utilisait :
```typescript
Buffer.from(apiKey).toString('base64')
```
Le renderer n'a pas accès aux APIs Node.js (NodeIntegration: false + contextIsolation: true).

**Fix**
Remplacement par `btoa()` natif browser :
```typescript
// Avant
Buffer.from(apiKey).toString('base64')

// Après
btoa(apiKey)
```

**Fichier modifié** : `src/customModelStore.ts`

---

### Bug #4 — Sandbox preload cassait les `require` relatifs

**Symptôme (DevTools console)**
```
Error: module not found: ./proxy/idGenerator
```

**Cause racine**
`webPreferences` de la `BrowserWindow` n'avait PAS `sandbox` défini → défaut Electron = `true` quand `nodeIntegration: false`. Le preload sandboxed ne peut pas `require()` des modules relatifs.

Sans preload fonctionnel → `contextBridge` jamais exposé → IPC bridge cassé → **écran noir**.

**Fix**
Ajout explicite de `sandbox: false` dans `webPreferences` :
```typescript
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,  // ← AJOUT
}
```

**Sécurité maintenue** par `contextIsolation: true` + `nodeIntegration: false`.

**Fichier modifié** : `src/utils.ts` (fonction `createWindow`)

---

### Bug #5 — Asar pas correctement repackée

**Symptôme**
Les fixes étaient appliqués au source TypeScript mais **pas déployés** dans `app.asar`. L'asar contenait toujours l'ancien code avec `Buffer.from()`.

**Cause**
Le script `asar pack` n'écrasait pas correctement les fichiers modifiés dans certains cas.

**Fix**
Procédure complète :
1. Kill tous les Antigravity.exe (et leurs enfants)
2. Extraire l'asar : `asar extract app.asar extracted/`
3. Copier les fichiers `dist/*.js` corrigés par-dessus
4. Repacker : `asar pack extracted/ app.asar`
5. Vérifier le contenu : `grep -c "btoa" app.asar`
6. Nettoyer le cache Electron : `%APPDATA%\Antigravity\Cache`, `%APPDATA%\Antigravity\Code Cache`, `%APPDATA%\Antigravity\GPUCache`
7. Relancer Antigravity

---

## 🛠️ Outils de diagnostic créés

### `scripts/diag/launch-with-cdp.bat`
Lance Antigravity avec `--remote-debugging-port=9229` (DevTools Protocol activé).

### `scripts/diag/cdp-renderer-dump.cjs`
Se connecte au DevTools Protocol (port 9229), capture pendant 12 sec :
- Console messages (log/warn/error)
- Exceptions JS
- Requêtes réseau échouées
- Screenshot PNG (`diag/black-screen.png`)
- État DOM du renderer

### `scripts/diag/inspect-preload.cjs`
Inspecte le contenu de l'asar pour valider que les patches sont bien déployés (grep `btoa`, `sandbox: false`, etc.)

### `scripts/diag/list-asar.cjs`
Liste tous les fichiers dans l'asar packagé.

---

## 📊 Timeline de la résolution

| Heure | Action | Résultat |
|-------|--------|----------|
| 12:20 | Lancement initial | Proxy OK, LS OK, mais écran noir après 3s |
| 12:45 | Découverte duplicate IPC handler | Erreur dans main.log |
| 13:00 | Fix `dedupeDuplicateIpcHandlers()` (Bug #1) | Erreur duplicate disparue |
| 13:15 | Découverte préfixe `electron_1.` | Crash JS syntax error |
| 13:30 | Fix regex préfixe (Bug #2) | Erreur syntax disparue |
| 14:00 | Connexion DevTools Protocol | Console accessible |
| 14:15 | Découverte `Buffer is not defined` | Crash plugin custom-model-store |
| 14:30 | Fix `Buffer.from()` → `btoa()` (Bug #3) | Plugin charge OK |
| 14:45 | Découverte `sandbox` cassait le preload | `Error: module not found` |
| 15:00 | Fix `sandbox: false` (Bug #4) | Preload fonctionne |
| 15:15 | Vérification asar (Bug #5) | Asar contient les fixes |
| 15:30 | **Antigravity fonctionne** | ✅ UI visible, 6 modèles chargés |

---

## 🎯 État final

- ✅ **Antigravity démarre** sans crash
- ✅ **UI complètement chargée** (plus d'écran noir)
- ✅ **6 modèles custom visibles** :
  - MiniMax-M2.7
  - minimax-m3
  - kr/claude-sonnet-4.5
  - kimi-k2.7
  - mystic/grok-4.5
  - posiden/hy3
- ✅ **Proxy actif** sur 127.0.0.1:50999
- ✅ **Language Server** sur port 55365
- ✅ **Console propre** (aucune erreur)

---

## 📝 Leçons à retenir

1. **`String.replace` sans flag `g`** ne remplace que la première occurrence — piège classique lors de dedupe
2. **`Buffer` n'existe pas dans le renderer Electron** (avec sandbox/contextIsolation), même si TS compile sans erreur — toujours utiliser `btoa`/`atob` côté renderer
3. **DevTools Protocol sur port 9229** est le moyen le plus fiable pour diagnostiquer un écran noir (accès à console + screenshot + state DOM)
4. **`asar pack` peut silencieusement ne pas écraser** certains fichiers — toujours vérifier le contenu de l'asar déployé avec `grep` ou extraction
5. **`sandbox: false` est nécessaire** quand le preload doit `require()` des modules locaux — la sécurité reste assurée par `contextIsolation: true` + `nodeIntegration: false`
6. **Toujours nettoyer le cache Electron** après modification de l'asar (`%APPDATA%\Antigravity\Cache`, `Code Cache`, `GPUCache`)

---

## 📂 Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `scripts/patch_2_3.js` | Réécriture `dedupeDuplicateIpcHandlers()` + support préfixe `electron_N.` |
| `scripts/test-patch-dedupe.js` | Tests unitaires (9 cas, 9/9 verts) |
| `src/customModelStore.ts` | `Buffer.from(...).toString('base64')` → `btoa(...)` |
| `src/utils.ts` | Ajout `sandbox: false` dans `webPreferences` |
| `scripts/diag/launch-with-cdp.bat` | Nouveau — lance Antigravity avec DevTools |
| `scripts/diag/cdp-renderer-dump.cjs` | Nouveau — diagnostic renderer via CDP |
| `scripts/diag/inspect-preload.cjs` | Nouveau — vérification contenu asar |
| `scripts/diag/list-asar.cjs` | Nouveau — listing fichiers asar |

---

**Session terminée le 2026-07-23 — Antigravity v2.3.1 opérationnel**