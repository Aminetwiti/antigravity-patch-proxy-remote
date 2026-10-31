# Résumé de session — correction de l’écran noir Antigravity 2.3.1

**Date :** 2026-07-23
**Projet :** `antigravity-add-model-main`
**Installation testée :** `%LOCALAPPDATA%\\Programs\\Antigravity`

## ✅ État final (2026-07-23 13:17)

| Vérification | Résultat |
|--------------|----------|
| Antigravity.exe | ✅ Lancé (6 process, 13:11) |
| language_server.exe | ✅ Lancé (PID 33456) |
| Proxy port 50999 | ✅ Listening + 2 Established |
| CDP port 9229 | ✅ Disponible |
| Fenêtre principale | ✅ Titre : "Greeting And Initial Contact" |
| UI renderer | ✅ Contenu complet (1400×824, 7 enfants) |
| Preload | ✅ Chargé sans erreur |
| Exceptions runtime | ✅ Aucune |

```text
text preview : Antigravity  File  View  Window
               New Conversation · Conversation History
               Scheduled Tasks · Pinned Conversations
               Initialize Project Development
               antigravity-add-model-main (13d)
               Greeting And Initial Contact
               Troubleshooting
```

**Antigravity 2.3.1 patchée fonctionne sans problème.**

## Symptôme initial

Après application du patch 2.3.x à Antigravity 2.3.1, Electron ouvrait une fenêtre noire/grise. La page HTTPS du Language Server finissait de charger, mais le renderer React ne montait pas :

```html
<div id="root"></div>
```

## Diagnostic et causes racines

L’inspection CDP avec `scripts/diag/cdp-renderer-dump.cjs` a révélé successivement plusieurs incompatibilités entre les fichiers de compatibilité 2.2.x injectés et le frontend Antigravity 2.3.1.

### 1. Échec du preload sandboxé

Erreur initiale :

```text
Unable to load preload script: ...\app.asar\dist\preload.js
Error: module not found: ./proxy/idGenerator
Error: No native storage bridge found during initialization
```

Le dossier `dist/proxy/` était initialement absent de l’ASAR. Sa réinjection complète était nécessaire, mais insuffisante : le chargeur sandboxé du preload Electron ne permettait toujours pas les imports locaux arbitraires suivants :

```text
./proxy/idGenerator
./proxy/errorClassifier
```

Correction : le patcher transforme le preload compilé pour incorporer des versions pures et autonomes de :

- `generateModelPlaceholderId`
- `toSlug`
- `classifyError`

et supprime les `require()` locaux incompatibles avec le sandbox.

### 2. Bridge 2.3.1 `ide` manquant

Après chargement du preload, le renderer échouait avec :

```text
TypeError: a.getState is not a function
```

La comparaison avec le preload officiel 2.3.1 a montré un bridge supplémentaire :

```js
const ideAPI = {
  isInstalled: () => ipcRenderer.invoke('ide:is-installed'),
};
contextBridge.exposeInMainWorld('ide', ideAPI);
```

Ce bridge a été ajouté au preload transformé.

### 3. Méthode updater `getState()` manquante

Le preload officiel 2.3.1 expose aussi :

```js
getState: () => ipcRenderer.invoke('updater:get-state')
```

La méthode a été ajoutée à `electronUpdater`, avec un handler IPC correspondant renvoyant un état initial `idle`.

### 4. Double initialisation du proxy

Deux composants démarraient le proxy :

- `proxy-runner.js` sur `50999`
- `dist/languageServer.js`, qui rencontrait `EADDRINUSE` puis basculait sur `51000`

Le binaire patché cible pourtant `50999`. Le patcher supprime maintenant l’appel `startProxy()` du `languageServer.js` injecté et conserve `proxy-runner.js` comme propriétaire unique.

### 5. Packaging ASAR incomplet et validation Windows

Le patcher a été renforcé pour :

- découvrir récursivement les fichiers `.js` sous `dist/proxy/` ;
- préserver leur arborescence ;
- exclure `.d.ts`, `.map`, tests et sources TypeScript du manifeste validé ;
- vérifier les artefacts critiques avant patch ;
- rouvrir le candidat ASAR après repack ;
- normaliser les chemins Windows `\dist\...` retournés par `@electron/asar` ;
- refuser une archive candidate incomplète avant installation.

## Particularité du backup `.unpacked`

Le backup :

```text
app.asar.pre-2.3.1.bak
```

référençait des fichiers externalisés dans un dossier compagnon attendu :

```text
app.asar.pre-2.3.1.bak.unpacked
```

Comme seul `app.asar.unpacked` existait, une copie compagnon a été créée pour permettre à `@electron/asar.extractAll()` de lire les fichiers `chrome-devtools-mcp` externalisés.

## Fichiers principaux modifiés ou créés

```text
scripts/patch_2_3.js
scripts/lib/patch-2-3-artifacts.js
scripts/lib/patch-2-3-source.js
src/ipcHandlers.ts
tests/scripts/patch-2-3-artifacts.test.ts
tests/scripts/patch-2-3-source.test.ts
tests/scripts/patch-2-3-preload.test.ts
tests/scripts/patch-2-3-ide-bridge.test.ts
tests/scripts/patch-2-3-updater-bridge.test.ts
```

Documents associés :

```text
docs/superpowers/specs/2026-07-22-antigravity-2-3-1-black-screen-design.md
docs/superpowers/plans/2026-07-22-antigravity-2-3-1-black-screen-fix.md
```

## Sauvegardes de l’installation

Les sauvegardes conservées dans `resources/` comprennent :

```text
app.asar.pre-2.3.1.bak
app.asar.black-screen-2026-07-22.bak
app.asar.bak-pre-proxyfix
```

Ne pas les supprimer avant d’avoir confirmé durablement le fonctionnement du patch.

## Vérification finale

La dernière inspection CDP a confirmé :

- URL renderer HTTPS chargée ;
- `document.readyState === "complete"` ;
- `window.nativeStorage` est un objet ;
- `#root` contient l’interface React complète ;
- menus, conversations, projets et zone de saisie visibles ;
- aucune erreur de chargement du preload ;
- aucune erreur `module not found: ./proxy/idGenerator` ;
- aucune erreur `No native storage bridge found` ;
- TTIR observé : environ 6,7 secondes.

Le renderer affiche correctement Antigravity 2.3.1.

## Vérification des tests

Commandes ciblées :

```bash
npm run build
npm run lint
npx vitest run tests/scripts/patch-2-3-*.test.ts
```

Résultat observé :

- build TypeScript réussi ;
- typecheck réussi ;
- 5 fichiers ciblés réussis ;
- 14 tests ciblés réussis.

La suite complète :

```bash
npm test
```

a exécuté 20 fichiers et 357 assertions avec succès, mais Vitest retourne encore le code 1 à cause de trois rejets asynchrones préexistants dans `src/__tests__/dnsResolver.test.ts` :

- timeout DNS vers `8.8.8.8` ;
- `SERVFAIL` ;
- `ENOTFOUND`.

Ces erreurs existaient dans la baseline avant le correctif d’écran noir et n’ont pas été corrigées pendant cette session.

## Avertissement runtime restant

La console renderer signale :

```text
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 storage:changed listeners added.
```

Cet avertissement n’empêche pas l’interface de fonctionner, mais mérite une investigation séparée sur le cycle de vie des abonnements `nativeStorage.onChanged`.

## Procédure de vérification rapide lors d’une prochaine session

1. Compiler :

```bash
npm run build
```

2. Exécuter les tests ciblés :

```bash
npx vitest run tests/scripts/patch-2-3-*.test.ts
```

3. Construire le candidat depuis le backup original :

```bash
node scripts/patch_2_3.js \
  "$LOCALAPPDATA/Programs/Antigravity/resources/app.asar.pre-2.3.1.bak" \
  "$TEMP/antigravity-2.3.1-patch-validation/extracted" \
  "$TEMP/antigravity-2.3.1-patch-validation/app.asar"
```

4. Après installation et lancement, inspecter le renderer :

```bash
node scripts/diag/cdp-renderer-dump.cjs
```

Critères indispensables :

```text
nativeStorage = object
#root non vide
aucune erreur preload
aucune erreur getState
texte de l’interface visible
```

## État Git important

Le travail a été réalisé directement sur `main`, sans worktree, à la demande de l’utilisateur. Un commit documentaire précédent, `17abb6a`, a inclus accidentellement plusieurs changements déjà indexés. L’utilisateur a explicitement choisi de le laisser tel quel. Les corrections finales de cette session ne doivent pas être supposées commitées : vérifier `git status` et `git diff` avant toute nouvelle opération Git.
