/**
 * Model ID utilities for Antigravity.
 *
 * Inspired by `vscode-unify-chat-provider/src/model-id-utils.ts`, but adapted
 * to the Antigravity MITM context (we inject custom models into the
 * GetAvailableModels Cloud Code envelope, not the VS Code LM API).
 *
 * Pure functions — no I/O, no side effects, fully testable.
 */

/**
 * Delimiter used to separate a base model ID from an optional reasoning suffix.
 * Example: "claude-sonnet-4#thinking" -> baseId="claude-sonnet-4", version="thinking"
 */
export const MODEL_VERSION_DELIMITER = '#';

/**
 * Result of splitting a model ID into its base + optional version parts.
 */
export interface ModelIdParts {
  baseId: string;
  version?: string;
}

/**
 * Parse a model ID into base ID and optional version suffix.
 *
 * @example
 * parseModelIdParts('claude-sonnet-4#thinking') => { baseId: 'claude-sonnet-4', version: 'thinking' }
 * parseModelIdParts('gpt-4o') => { baseId: 'gpt-4o' }
 */
export function parseModelIdParts(id: string): ModelIdParts {
  if (!id) {
    return { baseId: '' };
  }
  const delimiterIndex = id.indexOf(MODEL_VERSION_DELIMITER);
  if (delimiterIndex === -1) {
    return { baseId: id };
  }
  const baseId = id.slice(0, delimiterIndex);
  const version = id.slice(delimiterIndex + 1);
  if (!version) {
    return { baseId: id };
  }
  return { baseId, version };
}

/**
 * Get the base model ID (strip any version suffix).
 *
 * @example
 * getBaseModelId('claude-sonnet-4#thinking') => 'claude-sonnet-4'
 */
export function getBaseModelId(id: string): string {
  return parseModelIdParts(id).baseId;
}

/**
 * Get the version suffix of a model ID, or undefined if none.
 *
 * @example
 * getModelVersion('claude-sonnet-4#thinking') => 'thinking'
 * getModelVersion('gpt-4o') => undefined
 */
export function getModelVersion(id: string): string | undefined {
  return parseModelIdParts(id).version;
}

/**
 * Check if a model ID has a version suffix.
 */
export function hasVersion(id: string): boolean {
  return parseModelIdParts(id).version !== undefined;
}

/**
 * Build a versioned model ID.
 *
 * @example
 * createVersionedModelId('claude-sonnet-4', 'thinking') => 'claude-sonnet-4#thinking'
 */
export function createVersionedModelId(baseId: string, version: string): string {
  if (!baseId) {
    throw new Error('createVersionedModelId: baseId must be non-empty');
  }
  if (!version) {
    throw new Error('createVersionedModelId: version must be non-empty');
  }
  return `${baseId}${MODEL_VERSION_DELIMITER}${version}`;
}

/**
 * Strip the version suffix from a model ID. Idempotent on plain IDs.
 *
 * @example
 * stripVersion('claude-sonnet-4#thinking') => 'claude-sonnet-4'
 * stripVersion('gpt-4o') => 'gpt-4o'
 */
export function stripVersion(id: string): string {
  return getBaseModelId(id);
}

/**
 * Normalize a human-typed model ID into a canonical slug-like form.
 * Used when users paste free-form IDs ("GPT-4o", "gpt 4o", "gpt_4o").
 *
 * Rules:
 *  - lowercase
 *  - trims whitespace
 *  - replaces '/', ' ', '_', '.' with '-'
 *  - collapses multiple '-'
 *  - strips leading/trailing '-'
 *
 * @example
 * normalizeModelId('  GPT-4o ') => 'gpt-4o'
 * normalizeModelId('claude 3.5 sonnet') => 'claude-3-5-sonnet'
 * normalizeModelId('o1-preview') => 'o1-preview'
 */
export function normalizeModelId(input: string): string {
  if (!input) {
    return '';
  }
  return input
    .trim()
    .toLowerCase()
    .replace(/models\//g, '')
    .replace(/[\s._/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a URL-safe slug from a model identifier (already lowercase).
 * Used as the stable key in the injected models map.
 *
 * @example
 * toSlug('Claude Sonnet 4') => 'claude-sonnet-4'
 * toSlug('Qwen 2.5-Coder') => 'qwen-2-5-coder'
 */
export function toSlug(id: string): string {
  return normalizeModelId(id);
}

/**
 * Find the next available numeric version suffix for a base model ID.
 * Returns "1" when no existing version is found, "2" when "1" exists, etc.
 *
 * @example
 * generateAutoVersion('gpt-4o', []) => '1'
 * generateAutoVersion('gpt-4o', [{ id: 'gpt-4o#1' }]) => '2'
 */
export function generateAutoVersion(
  baseModelId: string,
  existingIds: string[],
): string {
  if (!baseModelId) {
    throw new Error('generateAutoVersion: baseModelId must be non-empty');
  }
  let maxVersion = 0;
  for (const id of existingIds) {
    const { baseId, version } = parseModelIdParts(id);
    if (baseId === baseModelId && version !== undefined) {
      const numVersion = parseInt(version, 10);
      if (!Number.isNaN(numVersion) && numVersion > maxVersion) {
        maxVersion = numVersion;
      }
    }
  }
  return String(maxVersion + 1);
}

/**
 * Build a versioned model ID, auto-assigning the next available numeric suffix.
 *
 * @example
 * generateAutoVersionedId('gpt-4o', []) => 'gpt-4o#1'
 * generateAutoVersionedId('gpt-4o', ['gpt-4o', 'gpt-4o#1']) => 'gpt-4o#2'
 */
export function generateAutoVersionedId(
  baseModelId: string,
  existingIds: string[],
): string {
  const version = generateAutoVersion(baseModelId, existingIds);
  return createVersionedModelId(baseModelId, version);
}

/**
 * Check whether a base model ID (ignoring version suffix) is already in use.
 *
 * @example
 * isBaseModelIdUsed('gpt-4o', ['gpt-4o#1']) => true
 */
export function isBaseModelIdUsed(
  baseModelId: string,
  existingIds: string[],
  excludeId?: string,
): boolean {
  return existingIds.some((id) => {
    if (id === excludeId) {
      return false;
    }
    return getBaseModelId(id) === baseModelId;
  });
}

/**
 * Simple fuzzy match: returns true if `query` is a substring of `candidate`
 * after both are normalized. Used for autocomplete / search.
 *
 * Two-tier matching:
 *  1. Dashes-collapsed: strips dashes from both sides (so "gpt4o" matches "gpt-4o").
 *  2. Substring: normalized substring match (so "sonnet" matches "claude-3-5-sonnet").
 *
 * @example
 * fuzzyMatch('gpt4o', 'gpt-4o') => true
 * fuzzyMatch('sonnet', 'claude-3-5-sonnet') => true
 */
export function fuzzyMatch(query: string, candidate: string): boolean {
  const q = normalizeModelId(query);
  const c = normalizeModelId(candidate);
  if (!q) {
    return true;
  }
  if (c.includes(q)) {
    return true;
  }
  // Fallback: ignore dashes so "gpt4o" matches "gpt-4o".
  const qCompact = q.replace(/-/g, '');
  const cCompact = c.replace(/-/g, '');
  return cCompact.includes(qCompact);
}

/**
 * Resolve a user input into a canonical model ID, picking the best
 * match from a list of known IDs. Returns the matched canonical ID,
 * or null if no candidates match.
 *
 * Exact match wins. Otherwise the first normalized substring match wins.
 */
export function resolveModelId(
  input: string,
  knownIds: string[],
): string | null {
  if (!input || !Array.isArray(knownIds) || knownIds.length === 0) {
    return null;
  }
  const normalizedInput = normalizeModelId(input);
  if (!normalizedInput) {
    return null;
  }

  // 1. Exact match (case-insensitive).
  for (const id of knownIds) {
    if (id.toLowerCase() === normalizedInput) {
      return id;
    }
  }

  // 2. Normalized exact match.
  for (const id of knownIds) {
    if (normalizeModelId(id) === normalizedInput) {
      return id;
    }
  }

  // 3. Fuzzy substring match.
  for (const id of knownIds) {
    if (fuzzyMatch(normalizedInput, id)) {
      return id;
    }
  }

  return null;
}
