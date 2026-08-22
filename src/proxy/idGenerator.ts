/**
 * Deterministic ID generation for custom models.
 * Pure functions — no I/O, no side effects, fully testable.
 */

import type { CustomModel } from './types';
import { DJB2_SEED, PLACEHOLDER_ID_BASE, PLACEHOLDER_ID_RANGE } from '../constants';

export { DJB2_SEED, PLACEHOLDER_ID_BASE, PLACEHOLDER_ID_RANGE };


/**
 * Generates a deterministic placeholder ID for a custom model.
 * Used to inject models into the GetAvailableModels response.
 *
 * The same input always produces the same output (idempotent), enabling
 * consistent references across requests.
 *
 * NOTE: Includes provider, apiUrl, externalModelName and displayName in the hash
 * to ensure unique IDs when multiple models share the same displayName but use
 * different providers or endpoints.
 */
export function generateModelPlaceholderId(model: CustomModel): string {
  // Include provider, apiUrl, and externalModelName to ensure uniqueness
  const effortTag = model._effortSuffix || '';
  const input = `${model.provider}-${model.apiUrl}-${model.externalModelName}-${model.displayName || model.name || 'custom-model'}${effortTag}`.toLowerCase();
  let hash = DJB2_SEED;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash = hash & hash; // Force 32-bit integer
  }
  const placeholderNum = PLACEHOLDER_ID_BASE + (Math.abs(hash) % PLACEHOLDER_ID_RANGE);
  return `MODEL_PLACEHOLDER_M${placeholderNum}`;
}

/**
 * Generates a URL-safe slug for a custom model.
 * Used for routing and identification (and as the key in the injected models map).
 *
 * NOTE: provider is included in the slug so that two models which share the same
 * apiUrl + externalModelName but use a DIFFERENT provider get distinct slugs.
 * Without this, the models map (keyed by slug) collides and only the last-added
 * model appears in the Antigravity model dropdown.
 */
export function toSlug(model: CustomModel): string {
  const provider = (model.provider || 'custom').toLowerCase();
  const effortTag = model._effortSuffix || '';
  const input = `${provider}-${model.apiUrl}-${model.externalModelName || model.name}${effortTag}`
    .replace(/^models\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return `custom-${input}`;
}
