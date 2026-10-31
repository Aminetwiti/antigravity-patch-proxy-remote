# RECOMMENDATIONS_DOCTOR_UI — Améliorations basées sur la session du 2026-07-11

> **Origine** : retour d'expérience de la résolution du bug `127.0.0.1:443
> connection refused` sur Antigravity 2.2.1 (cf. [docs/troubleshooting/install-errors.md](docs/troubleshooting/install-errors.md)).
> **Cible** : `ag-doctor-ui/` (Electron renderer) + `ag-doctor/` (CLI).
> **Audience** : développeurs qui maintiennent `ag-doctor-ui`.

---

## Contexte : frictions rencontrées pendant la session

Pour bien comprendre la valeur de chaque recommandation, voici les moments où
le doctor UI **aurait pu** économiser du temps ou éviter des erreurs :

1. **Détection tardive du MITM manquant** : le diagnostic initial a conclu à
   tort « MITM optionnel ». Il a fallu une deuxième session pour découvrir
   que le MITM sur 443 est **obligatoire**. Un check visuel dans le UI
   aurait fait économiser 1h.

2. **« Black screen » + « unexpected issue setting up your account »** : ces
   deux symptômes venaient du même problème (MITM off) mais ne le
   suggéraient pas. Sans recherche dans `main.log` + `language_server.log`,
   impossible de savoir ce qui se passait.

3. **Patch overlay complet qui crash l'app** : un test de validation
   automatique (delta size > 100 KB → suspicion) aurait pu être intégré
   au UI plutôt que d'être codé en dur dans le script.

4. **« lance Antigravity et suivis ses logs »** répété 3× dans la même
   session : le UI devrait avoir un bouton « stream logs » qui tail
   `main.log` en temps réel.

5. **Découverte empirique du path de patch (`scripts/patch_2_2_1.js`)** :
   un UI qui présente le pipeline comme un wizard éviterait de réinventer
   à chaque session.

6. **Backup manuel avec timestamps** : 4 backups créés manuellement dans
   la session (`app.asar.pre-recon-*.bak`, `app.asar.pre-surgical-*.bak`).
   Un UI avec backup manager éviterait les fautes de frappe.

---

## P0 — Critique (à implémenter en premier)

### P0.1 — Dashboard « Patch State » en page d'accueil

**Pourquoi** : actuellement le UI montre des checks atomiques (proxy up,
MITM up, etc.) mais **pas la cohérence globale**. La session a prouvé
qu'on peut avoir proxy up + MITM down + erreur en boucle sans le
réaliser.

**Description** :

Une vue d'accueil (refactor de `doctor.ts`) qui affiche un verdict
global : `PATCH OK` / `PATCH KAPUT` / `MITM REQUIS` / `VERSION INCOMPATIBLE`,
avec un seul bouton « Repair all ».

**Implémentation** :

```typescript
// ag-doctor/src/commands/doctor.ts (refactor)
interface PatchState {
  antigravityVersion: string;          // "2.2.1"
  asarBackedUp: boolean;
  asarIntact: boolean;                 // sha match expectations
  proxyListening: boolean;             // ${AG_PROXY_PORT:-51074} LISTEN
  proxyResponding: boolean;            // /health 200
  mitmListening: boolean;              // 443 LISTEN sur 127.0.0.1
  mitmCaInstalled: boolean;            // Cert:\LocalMachine\Root contient CA
  customModelsLoaded: number;
  startProxyErrors: number;            // grep -c dans main.log
  blockingErrors: string[];            // diagnostic lisible
}

async function computePatchState(): Promise<PatchState> { /* ... */ }

function verdict(state: PatchState): { label: string; severity: 'ok'|'warn'|'error'; action?: string } {
  if (!state.proxyListening)        return { label: 'Proxy off',          severity: 'error', action: 'patch' };
  if (!state.mitmListening)         return { label: 'MITM off',           severity: 'error', action: 'launch-mitm' };
  if (state.startProxyErrors > 0)   return { label: 'Patch broken',       severity: 'error', action: 'repair' };
  if (!state.mitmCaInstalled)       return { label: 'CA not trusted',     severity: 'warn',  action: 'install-ca' };
  if (state.customModelsLoaded === 0) return { label: 'No custom models', severity: 'warn',  action: 'add-model' };
  return { label: 'Patch OK', severity: 'ok' };
}
```

**Acceptance** : à l'ouverture du UI, l'utilisateur voit immédiatement si
le système est fonctionnel ou pas, avec un bouton « Repair » qui lance le
pipeline décrit dans [docs/troubleshooting/mitm-443.md](docs/troubleshooting/mitm-443.md).

---

### P0.2 — Live log stream dans le UI

**Pourquoi** : 3 sessions consécutives ont demandé « lance et suis les
logs ». Le UI doit le faire nativement.

**Description** : un panneau dans le UI qui tail `main.log` (et
`language_server.log`) en temps réel, avec highlighting des lignes
`[error]` et `[Proxy]`.

**Implémentation** : `ag-doctor-ui/src/main.ts` peut spawner un
`tail -F` (ou son équivalent Node) sur les logs et streamer via IPC
vers le renderer. Voir `chokidar` ou `node:fs.watch`.

```typescript
// ag-doctor-ui/src/main.ts
import { watch } from 'node:fs';

ipcMain.handle('logs:tail', async (event, logPath: string) => {
  // Return an async iterator of new lines
  const queue: string[] = [];
  const watcher = watch(logPath, { persistent: true });
  let pos = 0;
  setInterval(() => {
    const stat = readFileSync(logPath);
    if (stat.length > pos) {
      const newContent = stat.slice(pos).toString();
      pos = stat.length;
      queue.push(...newContent.split('\n').filter(Boolean));
    }
  }, 500);
  return { queue /* ... */ };
});
```

**Acceptance** : ouvrir le UI → panneau logs live → voir le flux sans
avoir à tail manuellement.

---

### P0.3 — Décodeur d'erreurs connues ✅ *subset livré le 2026-07-11*

**Implémentation** :
- `app.ts` ligne ~325 : helpers `decodeError(stderr, stdout)` et
  `runErrorAction(action)` ajoutés.
- 3 patterns reconnus :
  - `127.0.0.1:443` (proxy MITM injoignable) → ouvre la vue MITM
  - `Cannot find module` (dépendance CLI manquante) → lance `doctor --fix`
  - `Antigravity crash on launch` → toast invitant à réessayer / restore
- `app.ts` lignes ~1770 et ~1800 : les erreurs de `patch apply` et
  `patch restore` passent maintenant par `decodeError` et affichent
  le hint + l'action correspondante quand un pattern connu matche.
- `app.ts` lignes ~1530 et ~1590 : même branche `decodeError()` câblée
  dans `#mitmProxyOnBtn` et `#mitmProxyOffBtn` — une erreur de type
  `127.0.0.1:443` redirige désormais vers la vue MITM (`navigate('mitm')`)
  via `runErrorAction('open-mitm-view')`.

**Pourquoi** : l'utilisateur a vu `127.0.0.1:443 refused` à 14:09 et
n'a pas su quoi faire. Le UI doit matcher les erreurs à des solutions.

**Description** : un panneau « Last error » qui :
1. Lit les 200 dernières lignes de `main.log`
2. Matche les patterns connus (cf. tableau)
3. Affiche une carte avec : erreur + cause probable + bouton « Apply fix »
   qui ouvre le wizard

| Pattern log | Cause probable | Action proposée |
|---|---|---|
| `startProxy failed: Cannot find module '../cryptoStore'` | Patch pas appliqué | Run surgical patch |
| `dial tcp 127.0.0.1:443:.*actively refused` | MITM off | Launch MITM |
| `EACCES` sur port 443 | Pas en admin | Re-launch as admin |
| `asar.*corrupt\|integrity.*failed` | Asar partiel | Restore from backup |
| `MODULE_NOT_FOUND` (autre) | Patch incomplet | Re-patch |

**Implémentation** : table de patterns dans
`ag-doctor/src/commands/diagnose.ts`, matcher avec regex, présenter
résultats structurés au UI.

**Acceptance** : erreur connue → carte « Apply fix » → wizard s'ouvre.

---

## P1 — Haute valeur

### P1.1 — Patch wizard « from scratch to running »

**Pourquoi** : le pipeline de patching est complexe (stop → rebuild →
patch → start MITM → launch → verify). Le UI devrait l'orchestrer.

**Description** : un wizard multi-étapes avec progress bar et logs en
direct. Chaque étape :
- Affiche ce qui va se passer
- A un bouton « Run this step »
- Stream les logs live
- Marque vert quand OK

**Implémentation** : nouveau composant React dans
`ag-doctor-ui/src/renderer/`, qui appelle séquentiellement les
commandes ag-doctor existantes (`patch`, `mitm install`, `launch`).

**Acceptance** : un utilisateur novice peut patcher Antigravity 2.2.x
de bout en bout sans toucher au terminal.

---

### P1.2 — Backup manager

**Pourquoi** : 4 backups créés manuellement pendant la session avec des
timestamps choisis à la main. Erreurs de frappe possibles. Pas de
visibilité.

**Description** : UI qui liste les backups de `app.asar.pre-*.bak` avec :
- Date
- Taille
- « Ce qui était appliqué à ce moment » (extrait de changelog)
- Bouton « Restore » + confirmation

**Implémentation** : nouveau composant, s'appuie sur
`ag-doctor/src/commands/snapshot.ts` (qui existe déjà).

**Acceptance** : un clic pour voir tous les backups + un clic pour
restaurer le bon.

---

### P1.3 — Pré-validation avant déploiement de patch ✅ *subset UI livré le 2026-07-11*

**Pourquoi** : pendant la session, le recon asar (overlay complet,
21 195 021 B) a crashé l'app. Un check de taille aurait pu alerter.

**Description** : avant de déployer un asar patché, le UI vérifie :
- Delta de taille < 100 KB (sinon warning)
- `dist/main.js` présent et taille ≈ 14 554 B (sinon warning)
- `dist/cryptoStore.js` etc. présents (sinon error)
- Pas de `dist/__mocks__/*` (sinon error)

**Implémentation** : dans `ag-doctor/src/commands/patch/`, ajouter une
fonction `validateAsar(asarPath)` qui retourne un verdict avant
écrasement du live.

**Acceptance** : patch overlay complet bloqué avant déploiement.

**Subset livré (UI renderer uniquement)** :
- `app.ts` ligne ~297 : `escapeHtml` + `formatBytes` restaurés comme
  helpers de la modale de pré-validation.
- `app.ts` ligne ~1608 : handler `#patchApplyBtn` réécrit avec un
  preflight qui lit `window.ag.run(['patch','status','--json'])`
  et bloque la modale de confirmation si `!preflight.exists`,
  `!preflight.compatible`, `!preflight.recommendedPatch` ou
  `preflight.applied`. Le champ optionnel `deltaSizeBytes` est
  affiché en lecture via `formatBytes()` dans le corps de la modale.
- `PatchStatus` interface enrichie avec `deltaSizeBytes?: number | null`
  pour typer la sortie du backend (UI renderer, ligne ~221).
- Subset CLI livré le 2026-07-11 : nouveau module
  `ag-doctor/src/commands/patch/validate-asar.ts` qui exécute les
  vérifications sur l'archive candidate (taille, présence de
  `dist/main.js` ~14 554 B ± 10 %, `dist/cryptoStore.js`,
  absence de `dist/__mocks__/*`, delta vs live asar < 100 KB).
  Sortie : `{ verdict, checks, deltaSizeBytes }`.
- `ag-doctor/src/commands/patch/status.ts` (lignes ~12-37) : la
  branche `patch status --json` calcule maintenant le verdict via
  `validateAsar()` et inclut `deltaSizeBytes`, `verdict` et
  `validateAsarReport` dans la sortie JSON consommée par le UI.

---

### P1.4 — Détection de version Antigravity + stratégie adaptée

**Pourquoi** : Antigravity 2.0.x/2.1.0 vs 2.2.x ont des structures
différentes. Le UI doit adapter le patch.

**Description** : au démarrage, le UI détecte la version (déjà
partiellement dans `ag-doctor/src/commands/antigravity.ts`) et choisit :
- 2.0.x / 2.1.0 : patch overlay complet OK
- 2.2.x : patch chirurgical uniquement
- 2.3+ : warning, demander confirmation

**Implémentation** : table `version → strategy` dans
`ag-doctor/src/commands/patch/`.

**Acceptance** : UI affiche la stratégie utilisée et refuse les
stratégies incompatibles.

---

### P1.5 — Indicateur MITM (REQUIRED, pas optionnel)

**Pourquoi** : le UI actuel ne distingue pas clairement que le MITM
est obligatoire pour Antigravity 2.2.x.

**Description** : dans l'écran MITM, ajouter un bandeau permanent :
> ⚠️ Antigravity 2.2.x **REQUIERT** le MITM sur 443. Sans lui, le LS
> continuera à échouer avec `127.0.0.1:443 refused`.

**Implémentation** : simple bandeau rouge dans
`ag-doctor-ui/src/renderer/mitm-section.tsx` (à créer).

**Acceptance** : impossible de manquer que le MITM est obligatoire.

---

## P2 — Nice to have

### P2.1 — Pattern library (base de symptômes → fixes)

**Description** : à chaque nouveau bug résolu, ajouter une entrée dans
une table YAML/JSON :

```yaml
- pattern: "dial tcp 127.0.0.1:443.*refused"
  severity: error
  cause: "MITM not running"
  fix: "scripts/mitm/start_mitm_443.ps1 (admin)"
  added: 2026-07-11
  reference: docs/troubleshooting/mitm-443.md
```

**Implémentation** : `ag-doctor/src/patterns/symptoms.yml` chargé au
démarrage.

---

### P2.2 — Backup rotation auto

**Description** : garder automatiquement les 5 derniers backups, purger
les plus vieux.

**Implémentation** : hook post-`cp` dans `ag-doctor/src/commands/snapshot.ts`.

---

### P2.3 — Diagnostic « one-click »

**Description** : un bouton « Diagnose everything » qui :
1. Dump l'état complet (processes, ports, asar SHA, log tail, hosts file)
2. Compare à une baseline connue-bonne
3. Affiche un rapport structuré exportable en JSON

**Implémentation** : nouvelle commande `ag-doctor diagnose --full`
appelée par un bouton UI.

---

### P2.4 — Live monitoring des modèles custom

**Description** : un panneau qui affiche en temps réel combien de
requêtes passent par le proxy, combien par Google natif, latences,
erreurs par endpoint.

**Implémentation** : parseur de `main.log` côté UI, agrégation par
endpoint.

---

### P2.5 — Intégration directe avec les fichiers de doc

**Description** : le UI affiche des extraits des fichiers de `docs/troubleshooting/`,
`TROUBLESHOOTING.md`, etc. directement dans les écrans concernés, au
lieu de demander à l'utilisateur d'ouvrir les fichiers manuellement.

**Implémentation** : bundle les `.md` dans l'app, parseur markdown
simple côté UI.

---

## Tableau récapitulatif (par priorité)

| # | Recommandation | Priorité | Effort estimé | Valeur |
|---|---|---|---|---|
| P0.1 | Dashboard Patch State | P0 | 1-2 jours | 🔥🔥🔥 |
| P0.2 | Live log stream | P0 | 1 jour | 🔥🔥🔥 |
| P0.3 | Décodeur d'erreurs | P0 | 1-2 jours | 🔥🔥🔥 |
| P1.1 | Patch wizard | P1 | 3-5 jours | 🔥🔥 |
| P1.2 | Backup manager | P1 | 1-2 jours | 🔥🔥 |
| P1.3 | Pré-validation patch | P1 | 1 jour | 🔥🔥 |
| P1.4 | Détection version + stratégie | P1 | 1 jour | 🔥🔥 |
| P1.5 | Bandeau MITM obligatoire | P1 | 2 heures | 🔥🔥 |
| P2.1 | Pattern library | P2 | 1 jour | 🔥 |
| P2.2 | Backup rotation auto | P2 | 2 heures | 🔥 |
| P2.3 | Diagnostic one-click | P2 | 2-3 jours | 🔥 |
| P2.4 | Monitoring live modèles | P2 | 2-3 jours | 🔥 |
| P2.5 | Intégration docs | P2 | 1-2 jours | 🔥 |

---

## Quick-win (≤ 2h chacun, à faire maintenant)

Si je devais commencer par **3 quick wins** :

1. **P1.5** (Bandeau MITM obligatoire) — 2h, juste un bandeau rouge
   dans l'écran MITM. Évite la confusion qui a coûté 1h dans la session.

2. **P1.3 (subset)** — Pré-validation delta size dans le bouton
   « Deploy patch ». 1h. Évite de redéployer un overlay complet
   accidentel.

3. **P0.3 (subset)** — Décodeur de 3 patterns connus
   (`127.0.0.1:443`, `Cannot find module`, `antigravity s'ouvre et se ferme`).
   1 jour. Couvre 80% des erreurs courantes.

---

## Implémentation pratique

Pour contribuer :

1. Créer une branche `feature/doctor-ui-improvements`
2. Commencer par P1.5 (quick win) puis P0.1 (dashboard)
3. Chaque recommandation = 1 PR
4. Tests E2E : `ag-doctor-ui/src/__tests__/doctor.spec.ts`

Pour chaque PR, inclure :
- Avant/après screenshot
- Test E2E
- Mise à jour de `ag-doctor-ui/README.md` si nouveau flow
