/**
 * Deterministic ID generation for custom models.
 * Pure functions -- no I/O, no side effects, fully testable.
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
 */
export function generateModelPlaceholderId(model: CustomModel): string {
  const effortTag = model._effortSuffix || '';
  // Google models used to be pooled, but this caused conflicts when multiple Google accounts were added
  const accountTag = (model.accountName || model.accountEmail || '');
  const cleanDisplayName = (model.displayName || model.name || 'custom-model').replace(/^\[[^\]]+\]\s*/, '');
  const input = `${model.provider}-${model.apiUrl}-${model.externalModelName}-${cleanDisplayName}${accountTag ? `-${accountTag}` : ''}${effortTag}`.toLowerCase();
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
 */
export function toSlug(model: CustomModel): string {
  const provider = (model.provider || 'custom').toLowerCase();
  const effortTag = model._effortSuffix || '';
  const isGoogle = provider === 'google' || provider === 'google-gemini' || provider === 'gemini' || provider === 'gemini-cli';
  // Google models are pooled across accounts in the backend, so they share a unified slug
  const accountTag = isGoogle ? '' : (model.accountName || model.accountEmail || '');
  const urlPart = isGoogle ? 'google' : (model.apiUrl || '');
  const rawModel = isGoogle
    ? (model.externalModelName || model.name || '').replace(/^models\//, '')
    : (model.externalModelName || model.name || '');
  const input = `${isGoogle ? 'google' : provider}-${urlPart}-${rawModel}${accountTag ? `-${accountTag}` : ''}${effortTag}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return `custom-${input}`;
}
