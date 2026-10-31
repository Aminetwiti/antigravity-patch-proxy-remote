/**
 * Provider Gating — runtime override of the trusted-provider whitelist.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 * `presets.ts` ships with a hardcoded whitelist of well-known providers
 * (OpenAI, Anthropic, OpenRouter, …). Users running their own self-hosted
 * gateway (LiteLLM, vLLM, llama.cpp proxy, an internal LLM gateway) cannot
 * use them without editing the source — which is hostile for production use.
 *
 * `providerGate` exposes a tiny runtime "trust extension":
 *
 *   loadTrustedProviders([...userAdded, ...devOverrides])
 *
 * It returns a `ProviderGate` whose `isTrustedProvider(id)` is true if the
 * id appears in either the default whitelist OR the runtime extension.
 * The default whitelist never changes, so removing providers is impossible
 * from the API — but adding new ones is trivial.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this layering matters
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspired by `vscode-unify-chat-provider`'s `PerModelRetryConfig`: a config
 * shape that augments built-in defaults rather than replacing them. Same
 * idea here — users get a "trust more" knob without rewriting the registry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Determinism for tests
 * ─────────────────────────────────────────────────────────────────────────────
 * The module exposes a `_resetProviderGate()` test helper that drops the
 * cached extension list. The default whitelist is a frozen module export.
 */

import { WELL_KNOWN_PRESETS } from '../presets';

/**
 * Default list of provider ids we ship trusted out of the box.
 * Derived from `presets.ts` so adding a preset automatically grants it trust.
 */
export const DEFAULT_TRUSTED_PROVIDERS: ReadonlyArray<string> = Object.freeze(
  WELL_KNOWN_PRESETS.map((p) => p.provider),
);

/**
 * Runtime-trusted provider ids (typically user-configured via
 * `settings.json` or a per-installation override).
 */
export type ProviderGate = ReadonlySet<string>;

let _extension: ReadonlyArray<string> = [];

interface ProviderGateSnapshot {
  /** The default trusted providers. */
  default: ReadonlyArray<string>;
  /** The user/runtime trust extension. */
  extension: ReadonlyArray<string>;
  /** The effective merged gate. */
  effective: string[];
  /** Test helper — was this gate built from a fresh module load? */
  fresh: boolean;
}

/**
 * Update the runtime trust extension. Pass `undefined` (or zero args) to
 * clear it. Returns a snapshot of the resulting gate.
 *
 * @param extra provider ids (or full API URLs) to grant trust to.
 *              Empty / undefined clears the extension.
 */
export function loadTrustedProviders(
  extra?: ReadonlyArray<string>,
): ProviderGateSnapshot {
  if (extra == null || extra.length === 0) {
    _extension = [];
  } else {
    _extension = Object.freeze(
      Array.from(new Set(extra.map((s) => s.trim()).filter(Boolean))),
    );
  }
  return snapshot();
}

/**
 * Adds a single provider id to the extension list.
 */
export function trust(providerId: string): ProviderGateSnapshot {
  const trimmed = providerId.trim();
  if (!trimmed) return snapshot();
  _extension = Object.freeze([..._extension, trimmed]);
  return snapshot();
}

/**
 * Removes a single provider id from the extension list.
 */
export function untrust(providerId: string): ProviderGateSnapshot {
  _extension = Object.freeze(_extension.filter((p) => p !== providerId));
  return snapshot();
}

/**
 * Predicate. True if `providerId` is in either the default whitelist or
 * the runtime extension.
 *
 * `apiUrl` is also accepted so callers that look up by URL (the custom
 * model store) can use this without resolving to a provider id first.
 * Matches by `startsWith` on the URL so e.g.
 *   "https://my-llm-gateway.local/v1/chat/completions"
 * matches a trust entry of
 *   "https://my-llm-gateway.local".
 */
export function isTrustedProvider(input: string): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (DEFAULT_TRUSTED_PROVIDERS.includes(trimmed)) return true;
  if (_extension.includes(trimmed)) return true;
  // URL prefix match against extension entries.
  for (const entry of _extension) {
    if (trimmed.startsWith(entry)) return true;
  }
  return false;
}

/**
 * Returns a JSON-serialisable snapshot of the current gate. Useful for the
 * diagnostics module and tests.
 */
export function snapshot(): ProviderGateSnapshot {
  const effective: string[] = [];
  const seen = new Set<string>();
  for (const id of DEFAULT_TRUSTED_PROVIDERS) {
    if (!seen.has(id)) {
      seen.add(id);
      effective.push(id);
    }
  }
  for (const id of _extension) {
    if (!seen.has(id)) {
      seen.add(id);
      effective.push(id);
    }
  }
  return {
    default: DEFAULT_TRUSTED_PROVIDERS,
    extension: _extension,
    effective,
    fresh: true,
  };
}

/**
 * Test/diagnostic helper. Clears the extension back to a fresh state.
 */
export function _resetProviderGate(): void {
  _extension = [];
}
