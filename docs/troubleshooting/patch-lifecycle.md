# Patch lifecycle (Antigravity update -> repatch)

> Formerly part of the consolidated `FIX_ERROR.md` troubleshooting document. For the primary diagnostic, see [install-errors.md](install-errors.md).

## 8. Leçons apprises

### 8.1 Toujours lire les logs applicatifs AVANT l'erreur réseau

L'erreur `127.0.0.1:443 refused` est déroutante parce qu'elle parle réseau,
mais la cause est dans `main.log` :

```
[error] [PATCH] startProxy failed: Cannot find module '../cryptoStore'
```

→ Le réflexe : `grep -i "error\|fail" main.log` **avant** de chercher du côté
des ports/firewall/réseau.

### 8.2 Diff `dist/` du repo vs `dist/` de l'asar déployé

```bash
# Fichiers dans dist/ du repo mais pas dans l'asar déployé :
npx -y @electron/asar list "$RES/app.asar" | sort > /tmp/asar.txt
ls "$REPO/dist/"*.js | xargs -n1 basename | sort > /tmp/dist.txt
comm -23 /tmp/dist.txt <(awk -F'/' '/^\/dist\/[a-zA-Z][^\/]*\.js$/ {print $3}' /tmp/asar.txt | sort)
```

Cette commande a révélé les 3 modules manquants.

### 8.3 L'overlay complet de `dist/` n'est PAS une option sûre

Un repack qui copie tout `dist/` :

- Remplace le `dist/main.js` patché par le `main.js` upstream (perd
  l'integration TLS bypass + `require('../proxy-runner')`).
- Emporte les `__mocks__/*` (mocks vitest) → Electron résout ces mocks
  comme s'ils étaient les vrais modules `electron`, `electron-log`, etc.
- Emporte les `*.test.js` → pollution de l'asar de production.

→ Toujours faire un overlay **chirurgical** : copier uniquement les fichiers
explicitement nécessaires.

### 8.4 Backup avant chaque opération destructive

Le pattern `app.asar.pre-<operation>-<ISO>.bak` a sauvé la mise plusieurs fois :

```
app.asar.pre-recon-20260711T133348.bak       ← utilisé pour restaurer après tentative ratée
app.asar.pre-surgical-20260711T135228.bak    ← snapshot après restauration
```

À garder : au minimum les 3 derniers backups.

### 8.5 Versioning sémantique d'Antigravity = breaking changes

| 2.0.x → 2.1.0 | pas de breaking change (proxy intact) |
| 2.1.0 → 2.2.x | **breaking** : proxy code supprimé du bundle officiel |
| 2.2.x → 2.3+ | à surveiller (le pattern de Google est de réduire le surface area) |

À chaque update, refaire le diagnostic de [install-errors.md#3-diagnostic-timeline-de-la-résolution](install-errors.md) avant d'appliquer le patch.

---

## 9. Références

- **Session kimchi de référence** : `019f4c39-447f-74ac-8dc8-8e4be561aa0d` (2026-07-10 13:30)
  - Message 14:02:01 : explication de la suppression du proxy en v2.2.x
  - Message 14:20:24 : première confirmation de patch réussi
- **Patcher** : `scripts/patch_2_2_1.js`
- **Code source des modules injectés** :
  - `src/cryptoStore.ts`
  - `src/customModelStore.ts`
  - `src/schemaValidator.ts`
- **Caller** : `src/proxy/modelLoader.ts` (ligne 10 : `import * as cryptoStore from '../cryptoStore';`)
- **Fallback dans le LS** : `src/languageServer.ts` (ligne 168-169)
- **Autre doc liée** :
  - `TROUBLESHOOTING.md` (flowchart port ${AG_PROXY_PORT:-51074})
  - `SOLUTION_LAUNCH_FIX.md` (problème de lancement après update)
  - `docs/MITM-Notes.md` (notes sur le MITM 443)

---
