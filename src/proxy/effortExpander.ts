/**
 * Expand reasoning-capable models into per-effort-level variants.
 * Pure function — no I/O, no side effects.
 *
 * A model that matches the reasoning/thinking pattern gets cloned into
 * three entries (Low / Medium / High). Each clone carries a distinct
 * _effortSuffix so generateModelPlaceholderId hashes them to
 * separate placeholder IDs. Non-reasoning models or already-tiered
 * models pass through unchanged.
 */

import type { CustomModel } from './types';
import { isReasoningLikeModel } from '../presets/reasoningEffort';

const EFFORT_LEVELS = [
  { suffix: '-low', label: 'Low', effort: 'low', budget: 1000 },
  { suffix: '-medium', label: 'Medium', effort: 'medium', budget: 4000 },
  { suffix: '-high', label: 'High', effort: 'high', budget: 10001 },
] as const;

const ALREADY_TIERED_REGEX = /[-_ ](low|medium|high)$|\((low|medium|high)\)$/i;

export function expandModelsWithEffort(models: CustomModel[]): CustomModel[] {
  const result: CustomModel[] = [];
  for (const m of models) {
    const nameToCheck = m.externalModelName || m.name || '';
    const displayName = m.displayName || '';

    // If already tiered or carrying an effort suffix, don't re-expand
    if (m._effortSuffix || ALREADY_TIERED_REGEX.test(nameToCheck) || ALREADY_TIERED_REGEX.test(displayName)) {
      result.push(m);
      continue;
    }

    if (!isReasoningLikeModel(nameToCheck)) {
      result.push(m);
      continue;
    }

    for (const { suffix, label, effort, budget } of EFFORT_LEVELS) {
      result.push({
        ...m,
        displayName: (m.displayName || m.name) + ' (' + label + ')',
        reasoningEffort: effort,
        thinkingBudget: budget,
        _effortSuffix: suffix,
      });
    }
  }
  return result;
}
