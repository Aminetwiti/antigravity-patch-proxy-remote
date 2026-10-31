# Version-Aware Patch System

## Aperçu

Le système de patch a été amélioré pour détecter automatiquement la version d'Antigravity installée et appliquer le patch correspondant.

## Problème Résolu

**Avant:** Le patch utilisait une seule URL hardcodée qui fonctionnait uniquement pour Antigravity 2.0.1 - 2.1.x. Si l'utilisateur avait une version 2.2.x, le patch échouait silencieusement.

**Maintenant:** Le système détecte la version d'Antigravity et applique le patch approprié pour cette version.

## Architecture

### Fichiers Modifiés/Créés

1. **`src/core/version-specific-patch.ts`** (NOUVEAU)
   - Registre de patches pour différentes versions
   - Détection automatique de la version
   - Application du patch version-spécifique

2. **`src/core/binary-patch.ts`** (MODIFIÉ)
   - `getPatchStatus()` utilise maintenant la détection version-aware
   - `applyPatch()` délègue à `applyVersionSpecificPatch()`

3. **`src/commands/patch/status.ts`** (MODIFIÉ)
   - Affiche des informations détaillées sur la compatibilité
   - Montre quelle version est détectée
   - Indique quel patch serait appliqué

### Registre de Patches

Le registre dans `version-specific-patch.ts` contient:

```typescript
export const PATCH_REGISTRY: PatchDefinition[] = [
  {
    versionRange: '2.0.1 - 2.1.x',
    minVersion: '2.0.1',
    maxVersion: '2.1.99',
    originalUrl: 'https://daily-cloudcode-pa.googleapis.com',
    patchedUrl: 'http://localhost:${AG_PROXY_PORT:-51074}/v1internal/xxxxxxx',
    description: 'Patch for Antigravity 2.0.1 to 2.1.x (41 bytes)',
  },
  // Patches futurs pour 2.2.x peuvent être ajoutés ici
];
```

## Utilisation

### Vérifier la compatibilité

```bash
ag-doctor patch status
```

**Sortie exemple:**

```
Antigravity Version: 2.1.0

✓ Binary found: C:\Users\...\language_server.exe
  Backup exists: yes

✓ Version is compatible with available patches

Recommended Patch:
  Version Range: 2.0.1 - 2.1.x
  Description: Patch for Antigravity 2.0.1 to 2.1.x (41 bytes)
  Original URL: https://daily-cloudcode-pa.googleapis.com
  Patched URL:  http://localhost:${AG_PROXY_PORT:-51074}/v1internal/xxxxxxx

Detected URL patterns in binary:
  • 2.0.1 - 2.1.x: https://daily-cloudcode-pa.googleapis.com

○ Patch is not applied
  Run `ag-doctor patch apply` to apply the patch
```

### Appliquer le patch

```bash
ag-doctor patch apply
```

Le système:
1. Détecte la version d'Antigravity
2. Trouve le patch correspondant
3. Vérifie que l'URL originale existe dans le binaire
4. Applique le patch approprié

## Ajouter un Patch pour 2.2.x

Quand vous identifiez la nouvelle URL dans Antigravity 2.2.x:

1. **Trouver la nouvelle URL:**

```powershell
# Chercher des patterns d'URL dans le binaire
$binary = "$env:LOCALAPPDATA\Programs\Antigravity\resources\bin\language_server.exe"
$content = [System.IO.File]::ReadAllBytes($binary)
$text = [System.Text.Encoding]::ASCII.GetString($content)

# Chercher des URLs googleapis.com
$text -match 'https?://[a-z0-9-]+\.googleapis\.com'
```

2. **Ajouter au registre dans `version-specific-patch.ts`:**

```typescript
{
  versionRange: '2.2.0+',
  minVersion: '2.2.0',
  maxVersion: null, // null = pas de limite supérieure
  originalUrl: 'https://nouvelle-url-trouvee.googleapis.com',
  patchedUrl: 'http://localhost:${AG_PROXY_PORT:-51074}/v1internal/xxxxxxx', // même longueur!
  description: 'Patch for Antigravity 2.2.0+',
},
```

3. **Vérifier les longueurs:**

```typescript
// Les URLs doivent avoir EXACTEMENT la même longueur
'https://nouvelle-url-trouvee.googleapis.com'.length ===
'http://localhost:${AG_PROXY_PORT:-51074}/v1internal/xxxxxxx'.length
```

4. **Rebuild:**

```bash
cd ag-doctor
npm run build
```

## Messages d'Erreur

### Version Non Compatible

```
✗ Version compatibility issue detected
  No patch available for Antigravity 2.2.1. This version may not be supported yet.
```

**Solution:** Ajouter un patch pour cette version dans le registre.

### URL Non Trouvée

```
✗ Version compatibility issue detected
  Binary does not contain expected URL pattern for version 2.1.0.
```

**Solution:** Google a peut-être changé l'URL. Analyser le binaire pour trouver la nouvelle URL.

### Mismatch de Version

```
✗ Version compatibility issue detected
  Binary contains URL from 2.0.1 - 2.1.x, but Antigravity reports version 2.2.1.
```

**Solution:** La détection de version ou le binaire est incohérent.

## API pour ag-doctor-ui

L'UI peut utiliser:

```typescript
import { getVersionAwarePatchStatus } from '../ag-doctor/src/core/version-specific-patch';

const status = getVersionAwarePatchStatus();

// Afficher dans l'UI:
console.log(`Version: ${status.antigravityVersion}`);
console.log(`Compatible: ${status.compatible}`);
console.log(`Applied: ${status.applied}`);
if (status.warningMessage) {
  console.warn(status.warningMessage);
}
```

## Tests

Pour tester avec une version spécifique:

```typescript
import { findPatchForVersion } from './version-specific-patch';

// Test 2.1.0
const patch210 = findPatchForVersion('2.1.0');
console.assert(patch210?.versionRange === '2.0.1 - 2.1.x');

// Test 2.2.0 (pas encore supporté)
const patch220 = findPatchForVersion('2.2.0');
console.assert(patch220 === null);
```

## Backward Compatibility

L'API existante reste fonctionnelle:

```typescript
// Ancienne API - toujours fonctionnelle
import { getPatchStatus, applyPatch } from './core/binary-patch';

const status = getPatchStatus(); // utilise version-aware en arrière-plan
const result = applyPatch();     // utilise version-aware en arrière-plan
```

## Prochaines Étapes

1. **Identifier l'URL pour 2.2.x:**
   - Analyser le binaire `language_server.exe` de la version 2.2.x
   - Trouver la nouvelle URL googleapis.com

2. **Ajouter le patch 2.2.x au registre**

3. **Tester sur Antigravity 2.2.x**

4. **Mettre à jour la documentation**
