/**
 * Safe JSON repair utility.
 *
 * Repairs common JSON malformations encountered in upstream API responses
 * without using `eval()` or `new Function()`. This is a defensive measure for
 * providers that occasionally emit slightly malformed JSON (trailing commas,
 * unquoted keys, single quotes, JS-style comments, truncated payloads).
 *
 * SECURITY: This module never executes arbitrary code. All repairs are
 * string-level transformations followed by a standard `JSON.parse`.
 */

const MAX_REPAIR_INPUT_BYTES = 1024 * 1024; // 1 MB safety cap

/**
 * Attempts to parse a JSON string. If parsing fails, applies a series of
 * safe string-level repairs and retries. Returns `null` if the input cannot
 * be repaired.
 *
 * @param input Potentially malformed JSON string
 * @returns Parsed value, or `null` if unrepairable
 */
export function repairPartialJson(input: string | null | undefined): unknown {
  if (input == null) return null;
  if (typeof input !== 'string') return null;
  if (input.length === 0) return null;
  if (input.length > MAX_REPAIR_INPUT_BYTES) return null;

  // Fast path: already valid JSON
  try {
    return JSON.parse(input);
  } catch {
    // fall through to repair
  }

  // Apply repairs in order from cheapest to most invasive.
  const candidates: string[] = [input];

  // Strip BOM and whitespace
  const stripped = input.replace(/^\uFEFF/, '').trim();
  if (stripped !== input) candidates.push(stripped);

  // Strip line and block comments
  const noComments = stripped
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noComments !== stripped) candidates.push(noComments);

  // Strip trailing commas before closing braces/brackets
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1');
  if (noTrailingCommas !== noComments) candidates.push(noTrailingCommas);

  // Quote unquoted object keys
  const quotedKeys = noTrailingCommas.replace(
    /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g,
    '$1"$2":',
  );
  if (quotedKeys !== noTrailingCommas) candidates.push(quotedKeys);

  // Normalize single-quoted JSON strings
  const doubleQuoted = noTrailingCommas.replace(/'/g, '"');
  if (doubleQuoted !== noTrailingCommas) candidates.push(doubleQuoted);

  // Repair truncated arrays/objects by closing pending delimiters
  const lastOpen = stripped.lastIndexOf('[');
  const lastClose = stripped.lastIndexOf(']');
  if (lastOpen > lastClose) {
    candidates.push(stripped + ']');
  }
  const lastOpenBrace = stripped.lastIndexOf('{');
  const lastCloseBrace = stripped.lastIndexOf('}');
  if (lastOpenBrace > lastCloseBrace) {
    candidates.push(stripped + '}');
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Like `repairPartialJson` but throws if the input cannot be repaired.
 * Use this when a valid value is required and failure should propagate.
 */
export function repairPartialJsonOrThrow(input: string): unknown {
  const result = repairPartialJson(input);
  if (result === null) {
    throw new SyntaxError('Failed to repair JSON input');
  }
  return result;
}
