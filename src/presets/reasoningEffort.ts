/**
 * Reasoning effort / thinking budget helpers (Sprint 1, TODO-006).
 *
 * Inspired by the vendor UCP preset-templates.ts (applyThinkingPreset),
 * simplified for the Antigravity MITM context.
 *
 * Pure functions — pure input/output, no I/O. Safe to call from any
 * renderer / proxy code path.
 */

/**
 * Canonical reasoning effort levels.
 *
 * - `auto`     - let the upstream model decide (default).
 * - `none`     - explicitly disable reasoning for non-thinking models.
 * - `low`      - minimal reasoning effort.
 * - `medium`   - balanced reasoning effort.
 * - `high`     - maximum reasoning effort.
 */
export type ReasoningEffort = 'auto' | 'none' | 'low' | 'medium' | 'high';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'auto',
  'none',
  'low',
  'medium',
  'high',
];

/**
 * Canonical thinking budget modes (vendor style).
 *
 * - `auto`     - upstream chooses.
 * - `enabled`  - force thinking.
 * - `disabled` - force no thinking.
 */
export type ThinkingBudget = 'auto' | 'enabled' | 'disabled';

export const THINKING_BUDGETS: readonly ThinkingBudget[] = [
  'auto',
  'enabled',
  'disabled',
];

/**
 * Coerce an unknown value into a valid `ReasoningEffort`, falling back to
 * `auto` when the input is malformed. Strict (rejects invalid values).
 *
 * @example
 * coerceReasoningEffort('medium') => 'medium'
 * coerceReasoningEffort('xyz')    => 'auto'
 * coerceReasoningEffort(undefined) => 'auto'
 */
export function coerceReasoningEffort(value: unknown): ReasoningEffort {
  if (typeof value !== 'string') {
    return 'auto';
  }
  const normalized = value.trim().toLowerCase();
  if ((REASONING_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as ReasoningEffort;
  }
  return 'auto';
}

/**
 * Coerce an unknown value into a valid `ThinkingBudget`, falling back to
 * `auto` when the input is malformed.
 */
export function coerceThinkingBudget(value: unknown): ThinkingBudget {
  if (typeof value !== 'string') {
    return 'auto';
  }
  const normalized = value.trim().toLowerCase();
  if ((THINKING_BUDGETS as readonly string[]).includes(normalized)) {
    return normalized as ThinkingBudget;
  }
  return 'auto';
}

/**
 * Compute the adaptive reasoning effort for a model based on its context
 * length. Inspired by UCP's preset-templates.ts `applyThinkingPreset` flow.
 *
 * Rules:
 *  - If effort is already provided and not 'auto', keep it.
 *  - If the upstream context is unusually short (< 4k tokens), use 'low'.
 *  - If the upstream context is huge (>= 200k tokens), use 'high'.
 *  - Otherwise, return 'medium' as a balanced default.
 *
 * @example
 * adaptiveReasoningEffort('auto', 1_000) => 'low'
 * adaptiveReasoningEffort('auto', 8_000) => 'medium'
 * adaptiveReasoningEffort('auto', 500_000) => 'high'
 * adaptiveReasoningEffort('low', 100_000) => 'low'
 */
export function adaptiveReasoningEffort(
  declaredEffort: unknown,
  contextTokens: number,
): ReasoningEffort {
  const explicit = coerceReasoningEffort(declaredEffort);
  if (explicit !== 'auto') {
    return explicit;
  }

  if (!Number.isFinite(contextTokens) || contextTokens <= 0) {
    return 'medium';
  }
  if (contextTokens < 4_000) {
    return 'low';
  }
  if (contextTokens >= 200_000) {
    return 'high';
  }
  return 'medium';
}

/**
 * Compute the thinking-budget mode adaptively.
 *
 * Rules:
 *  - If budget is already provided and not 'auto', keep it.
 *  - If the upstream model is reasoning-class (deepseek-r1, o1, o3, etc.),
 *    return 'enabled'.
 *  - If the upstream model is a thinking-class (claude-3-7-sonnet, etc.),
 *    return 'enabled'.
 *  - Otherwise, return 'disabled' for pure chat models.
 *
 * @example
 * budgetReasoningEffort('auto', 'claude-3-7-sonnet') => 'enabled'
 * budgetReasoningEffort('auto', 'gpt-4o-mini') => 'disabled'
 * budgetReasoningEffort('enabled', 'gpt-4o-mini') => 'enabled'
 */
export function budgetReasoningEffort(
  declaredBudget: unknown,
  modelName: string,
): ThinkingBudget {
  const explicit = coerceThinkingBudget(declaredBudget);
  if (explicit !== 'auto') {
    return explicit;
  }

  return isReasoningLikeModel(modelName) ? 'enabled' : 'disabled';
}

/**
 * Determine if a model name hints at reasoning / thinking capabilities.
 * Useful to short-circuit IPC handlers that need to pick a default mode.
 *
 * @example
 * isReasoningLikeModel('claude-3-7-sonnet') => true
 * isReasoningLikeModel('gpt-4o') => false
 */
export function isReasoningLikeModel(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }
  return /(o1|o3|r1|reasoning|reasoner|thinking|claude-3-7|opus|sonnet|gemini-3|gpt-oss)/i.test(
    modelName,
  );
}
