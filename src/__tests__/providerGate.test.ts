/**
 * Tests for the providerGate module.
 *
 * Verifies:
 *   - default whitelist is non-empty and frozen.
 *   - extension adds/trusted/untrusted work.
 *   - URL prefix matching works for self-hosted gateways.
 *   - module-level state is reset between tests via `_resetProviderGate`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_TRUSTED_PROVIDERS,
  isTrustedProvider,
  loadTrustedProviders,
  trust,
  untrust,
  snapshot,
  _resetProviderGate,
} from '../proxy/providerGate';

beforeEach(() => {
  _resetProviderGate();
});

describe('providerGate / default whitelist', () => {
  it('ships a non-empty list of default trusted providers', () => {
    expect(DEFAULT_TRUSTED_PROVIDERS.length).toBeGreaterThan(0);
  });

  it('contains the well-known openai/anthropic/openrouter entries', () => {
    expect(DEFAULT_TRUSTED_PROVIDERS).toContain('openai');
    expect(DEFAULT_TRUSTED_PROVIDERS).toContain('anthropic');
    expect(DEFAULT_TRUSTED_PROVIDERS).toContain('openrouter');
  });

  it('default list is frozen', () => {
    expect(Object.isFrozen(DEFAULT_TRUSTED_PROVIDERS)).toBe(true);
  });

  it('default trusted providers are accepted by the predicate', () => {
    expect(isTrustedProvider('openai')).toBe(true);
    expect(isTrustedProvider('anthropic')).toBe(true);
  });

  it('returns false for empty input', () => {
    expect(isTrustedProvider('')).toBe(false);
  });

  it('returns false for unknown providers', () => {
    expect(isTrustedProvider('skynet-local')).toBe(false);
  });
});

describe('providerGate / extension', () => {
  it('extension adds new ids to the effective gate', () => {
    loadTrustedProviders(['my-llm-gateway']);
    expect(isTrustedProvider('my-llm-gateway')).toBe(true);
    expect(isTrustedProvider('skynet-local')).toBe(false);
  });

  it('trust() adds a single id', () => {
    trust('foo');
    expect(isTrustedProvider('foo')).toBe(true);
  });

  it('trust() ignores empty/whitespace ids', () => {
    const before = snapshot().extension.length;
    trust('   ');
    const after = snapshot().extension.length;
    expect(after).toBe(before);
  });

  it('untrust() removes a previously-trusted id', () => {
    trust('foo');
    expect(isTrustedProvider('foo')).toBe(true);
    untrust('foo');
    expect(isTrustedProvider('foo')).toBe(false);
  });

  it('untrust() on missing id is a noop', () => {
    loadTrustedProviders(['a', 'b']);
    untrust('zzz');
    expect([...snapshot().extension].sort()).toEqual(['a', 'b']);
  });

  it('loadTrustedProviders dedupes and trims entries', () => {
    loadTrustedProviders(['  foo  ', 'foo', 'bar']);
    expect([...snapshot().extension].sort()).toEqual(['bar', 'foo']);
  });

  it('loadTrustedProviders() with empty / missing clears extension', () => {
    trust('foo');
    expect(snapshot().extension.length).toBe(1);
    loadTrustedProviders();
    expect(snapshot().extension.length).toBe(0);
    expect(isTrustedProvider('foo')).toBe(false);
    loadTrustedProviders([]);
    expect(snapshot().extension.length).toBe(0);
  });
});

describe('providerGate / URL prefix matching', () => {
  it('matches a full URL against a prefix trust entry', () => {
    trust('https://my-llm-gateway.local');
    expect(
      isTrustedProvider('https://my-llm-gateway.local/v1/chat/completions'),
    ).toBe(true);
  });

  it('does not match a URL that shares only a partial path', () => {
    trust('https://my-llm-gateway.local/v2');
    expect(
      isTrustedProvider('https://my-llm-gateway.local/v1/chat/completions'),
    ).toBe(false);
  });

  it('matches against the full default entry', () => {
    expect(isTrustedProvider('openai')).toBe(true);
    expect(isTrustedProvider('openai-pro')).toBe(false);
  });
});

describe('providerGate / snapshot', () => {
  it('exposes default, extension, and effective', () => {
    trust('foo');
    const snap = snapshot();
    expect(snap.default).toBe(DEFAULT_TRUSTED_PROVIDERS);
    expect(snap.extension).toContain('foo');
    expect(snap.effective).toContain('openai');
    expect(snap.effective).toContain('foo');
    expect(snap.fresh).toBe(true);
  });

  it('does not duplicate entries when the same id is in both', () => {
    // 'openai' is in the default whitelist; adding it again should be a no-op.
    trust('openai');
    const snap = snapshot();
    const openaiCount = snap.effective.filter((p) => p === 'openai').length;
    expect(openaiCount).toBe(1);
  });
});
