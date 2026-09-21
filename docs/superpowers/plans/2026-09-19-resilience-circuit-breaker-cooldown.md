# Circuit Breaker Adaptatif & Google Account Pool Cooldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer les requêtes inutiles et les latences superflues en implémentant un Circuit Breaker à TTL adaptatif (15 min pour erreurs 402/billing vs 60s pour 429) avec isolation par compte, et un système de cooldown automatique (10 min) pour les comptes Google Cloud Code en 429.

**Architecture:** 
1. `src/proxy/circuitBreaker.ts` intègre l'identité du compte dans la clé de hachage du disjoncteur (`keyOf`) et module la durée de rétention en fonction du type d'erreur (`billing` vs `rate_limit`/`server`).
2. `src/proxy.ts` implémente un registre de cooldown en mémoire (`googleAccountCooldowns`) pour ordonner le pool multi-comptes en privilégiant immédiatement les comptes sains non plafonnés.

**Tech Stack:** TypeScript, Node.js (http/https/crypto), Vitest.

## Global Constraints
- Suivre les règles "Ponytail, lazy senior dev mode": code minimal, aucune abstraction superflue, aucun nouveau package.
- 0 régression sur les 1469 tests vitest du proxy.
- Rétro-compatibilité totale avec les configurations de modèles existantes.

---

### Task 1: Circuit Breaker Adaptatif & Isolation par Compte

**Files:**
- Modify: `src/proxy/circuitBreaker.ts`
- Test: `src/__tests__/circuitBreaker.test.ts`

**Interfaces:**
- Produces: `CIRCUIT_BREAKER_BILLING_RESET_MS = 15 * 60_000`
- Updates: `getOpenBreaker(model: CustomModel): CachedDiagnostic | null` pour inspecter `diagnostic.errorType === 'billing'`
- Updates: `keyOf(model: CustomModel): string` pour inclure l'adresse de compte (`model.accountEmail`)

- [ ] **Step 1: Écrire les tests unitaires pour le TTL billing et l'isolation par compte**

Ajouter dans `src/__tests__/circuitBreaker.test.ts` :
```typescript
it('applies a 15-minute cooldown for billing errors', () => {
  recordFailure(baseModel, 'billing');
  expect(getOpenBreaker(baseModel)).not.toBeNull();
  // À 2 minutes (120s), un rate_limit normal serait fermé (reset à 60s), mais billing reste OUVERT
  vi.advanceTimersByTime(120_000);
  expect(getOpenBreaker(baseModel)).not.toBeNull();
  // À 16 minutes (960s), le breaker billing est maintenant fermé
  vi.advanceTimersByTime(840_000);
  expect(getOpenBreaker(baseModel)).toBeNull();
});

it('isolates breaker state between different accounts of the same model', () => {
  const account1: CustomModel = { ...baseModel, accountEmail: 'user1@gmail.com' };
  const account2: CustomModel = { ...baseModel, accountEmail: 'user2@gmail.com' };
  recordFailure(account1, 'rate_limit');
  expect(getOpenBreaker(account1)).not.toBeNull();
  expect(getOpenBreaker(account2)).toBeNull();
});
```

- [ ] **Step 2: Exécuter les tests pour vérifier l'échec initial**

Run: `npx vitest run src/__tests__/circuitBreaker.test.ts`
Expected: FAIL car le TTL billing n'est pas encore de 15 minutes et `keyOf` n'isole pas les comptes.

- [ ] **Step 3: Implémenter le TTL billing et l'isolation par compte dans `src/proxy/circuitBreaker.ts`**

Dans `src/proxy/circuitBreaker.ts` :
1. Déclarer `export const CIRCUIT_BREAKER_BILLING_RESET_MS = 15 * 60_000;` (15 minutes).
2. Dans `keyOf(model)` :
```typescript
function keyOf(model: CustomModel): string {
  const accountId = model.accountEmail ? `::${model.accountEmail.toLowerCase()}` : '';
  return `${model.provider}::${model.apiUrl}::${model.name}${accountId}`;
}
```
3. Dans `getOpenBreaker(model)` :
```typescript
export function getOpenBreaker(model: CustomModel): CachedDiagnostic | null {
  const entry = getBreakerState(model);
  if (!entry.diagnostic) return null;
  const elapsed = Date.now() - entry.diagnostic.trippedAt;
  const ttl = entry.diagnostic.errorType === 'billing'
    ? CIRCUIT_BREAKER_BILLING_RESET_MS
    : CIRCUIT_BREAKER_RESET_MS;
  if (elapsed >= ttl) {
    return null;
  }
  return entry.diagnostic;
}
```

- [ ] **Step 4: Exécuter les tests unitaires pour valider la réussite**

Run: `npx vitest run src/__tests__/circuitBreaker.test.ts`
Expected: PASS (10/10 tests passés).

- [ ] **Step 5: Compilation TypeScript du projet**

Run: `npm run lint`
Expected: 0 erreur.

---

### Task 2: Cooldown Automatique sur les Comptes Google en 429

**Files:**
- Modify: `src/proxy.ts`
- Test: `src/__tests__/googleAccountPool.test.ts`

**Interfaces:**
- Produces: `isAccountInCooldown(candidate: CustomModel): boolean`
- Produces: `setAccountCooldown(candidate: CustomModel, durationMs?: number): void`
- Produces: `clearAccountCooldown(candidate: CustomModel): void`

- [ ] **Step 1: Écrire les tests unitaires pour le cooldown des comptes Google**

Dans `src/__tests__/googleAccountPool.test.ts` :
```typescript
it('deprioritizes accounts that are currently in 429 cooldown', () => {
  const acc1 = { ...mockGoogleModels[0], accountEmail: 'exhausted@gmail.com' };
  const acc2 = { ...mockGoogleModels[1], accountEmail: 'healthy@gmail.com' };
  setAccountCooldown(acc1, 10 * 60_000);
  expect(isAccountInCooldown(acc1)).toBe(true);
  expect(isAccountInCooldown(acc2)).toBe(false);
  
  clearAccountCooldown(acc1);
  expect(isAccountInCooldown(acc1)).toBe(false);
});
```

- [ ] **Step 2: Exécuter les tests pour vérifier l'échec initial**

Run: `npx vitest run src/__tests__/googleAccountPool.test.ts`
Expected: FAIL car `setAccountCooldown` n'est pas encore défini.

- [ ] **Step 3: Implémenter le registre de cooldown dans `src/proxy.ts`**

Dans `src/proxy.ts` :
1. Ajouter le registre en mémoire :
```typescript
const googleAccountCooldowns = new Map<string, number>();

export function isAccountInCooldown(candidate: CustomModel): boolean {
  const key = getAccountQuotaKey(candidate);
  const until = googleAccountCooldowns.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    googleAccountCooldowns.delete(key);
    return false;
  }
  return true;
}

export function setAccountCooldown(candidate: CustomModel, durationMs = 10 * 60_000): void {
  const key = getAccountQuotaKey(candidate);
  googleAccountCooldowns.set(key, Date.now() + durationMs);
}

export function clearAccountCooldown(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  googleAccountCooldowns.delete(key);
}
```
2. Dans `executeGoogleCloudCodeWithPool` :
- Lors du tri initial de `sortedAccounts` : placer les comptes hors cooldown en priorité :
```typescript
  const sortedAccounts = [...accountPool].sort((a, b) => {
    const cdA = isAccountInCooldown(a) ? 1 : 0;
    const cdB = isAccountInCooldown(b) ? 1 : 0;
    if (cdA !== cdB) return cdA - cdB;
    const breakerA = getOpenBreaker(a) ? 1 : 0;
    const breakerB = getOpenBreaker(b) ? 1 : 0;
    if (breakerA !== breakerB) return breakerA - breakerB;
    return getModelQuotaScore(b) - getModelQuotaScore(a);
  });
```
- Lors d'une erreur 429 (`outcome.statusCode === 429`), appeler `setAccountCooldown(candidate);`.
- Lors d'un succès (`outcome.success`), appeler `clearAccountCooldown(candidate);`.

- [ ] **Step 4: Exécuter les tests unitaires pour valider la réussite**

Run: `npx vitest run src/__tests__/googleAccountPool.test.ts`
Expected: PASS.

- [ ] **Step 5: Compilation et vérification complète**

Run: `npm run lint && npm run build && npm test`
Expected: PASS sur l'ensemble de la suite.
