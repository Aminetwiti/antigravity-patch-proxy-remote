/**
 * Tests for the diagnostics snapshot module.
 *
 * Asserts:
 *   - shape keys exist + are JSON-serialisable
 *   - per-model aggregation across the three sources (known, breakers, budget)
 *   - hash is stable across calls and changes when the budget moves
 *   - formatSnapshot returns parseable markdown
 */

import { describe, it, expect } from 'vitest';

import {
  _buildSnapshot,
  formatSnapshot,
  knownDefaultProviders,
} from '../proxy/diagnostics';
import { _resetProviderGate } from '../proxy/providerGate';
import { _resetAllBreakers } from '../proxy/circuitBreaker';
import { _resetRetryBudget } from '../proxy/retryBudget';

describe('diagnostics / _buildSnapshot shape', () => {
  it('exposes the documented top-level keys', () => {
    _resetProviderGate();
    _resetAllBreakers();
    const snap = _buildSnapshot({
      baseMaxRetries: 5,
      retryBudget: () => ({ perModel: [] }),
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    });
    expect(snap).toHaveProperty('uptimeMs');
    expect(snap).toHaveProperty('now');
    expect(snap).toHaveProperty('hash');
    expect(snap).toHaveProperty('models');
    expect(snap).toHaveProperty('breakersOpen');
    expect(snap).toHaveProperty('retryBudget');
    expect(snap).toHaveProperty('baseMaxRetries');
    expect(snap).toHaveProperty('providerGate');
    expect(snap.baseMaxRetries).toBe(5);
  });

  it('hash is deterministic for identical sources', () => {
    const srcA = {
      baseMaxRetries: 2,
      retryBudget: () => ({ perModel: [{ key: 'm', trust: 0.5, maxRetries: 1, samples: 1 }] }),
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    };
    const hash1 = _buildSnapshot(srcA).hash;
    const hash2 = _buildSnapshot(srcA).hash;
    expect(hash1).toBe(hash2);
  });

  it('hash changes when the retry budget moves', () => {
    const base = {
      baseMaxRetries: 2,
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    };
    const hash1 = _buildSnapshot({
      ...base,
      retryBudget: () => ({ perModel: [{ key: 'm', trust: 0.9, maxRetries: 1, samples: 1 }] }),
    }).hash;
    const hash2 = _buildSnapshot({
      ...base,
      retryBudget: () => ({ perModel: [{ key: 'm', trust: 0.1, maxRetries: 0, samples: 1 }] }),
    }).hash;
    expect(hash1).not.toBe(hash2);
  });
});

describe('diagnostics / model aggregation', () => {
  it('flags a known model even when no budget samples exist', () => {
    const snap = _buildSnapshot({
      baseMaxRetries: 3,
      retryBudget: () => ({ perModel: [] }),
      breakers: () => ({ open: [] }),
      knownModels: () => ['openai::url::gpt-4o'],
    });
    expect(snap.models['openai::url::gpt-4o']).toEqual({
      known: true,
      budgeted: false,
      breakerOpen: false,
      trust: null,
    });
  });

  it('flags a model with both budget and breaker', () => {
    const snap = _buildSnapshot({
      baseMaxRetries: 1,
      retryBudget: () => ({ perModel: [{ key: 'm', trust: 0.4, maxRetries: 0, samples: 3 }] }),
      breakers: () => ({
        open: [
          {
            key: 'm',
            errorType: 'timeout',
            trippedAt: 0,
            failures: 2,
            msRemaining: 1000,
          },
        ],
      }),
      knownModels: () => [],
    });
    expect(snap.models.m).toEqual({
      known: false,
      budgeted: true,
      breakerOpen: true,
      trust: 0.4,
    });
  });

  it('flags an unrecognised (budgeted but never registered) model', () => {
    const snap = _buildSnapshot({
      baseMaxRetries: 1,
      retryBudget: () => ({ perModel: [{ key: 'ghost', trust: 0.2, maxRetries: 0, samples: 1 }] }),
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    });
    expect(snap.models.ghost).toEqual({
      known: false,
      budgeted: true,
      breakerOpen: false,
      trust: 0.2,
    });
  });
});

describe('diagnostics / formatSnapshot', () => {
  it('renders a markdown report', () => {
    const snap = _buildSnapshot({
      baseMaxRetries: 1,
      retryBudget: () => ({ perModel: [] }),
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    });
    const md = formatSnapshot(snap);
    expect(md).toContain('# Proxy Diagnostics');
    expect(md).toContain('## Provider Gate');
    expect(md).toContain('## Circuit Breakers (open)');
    expect(md).toContain('## Retry Budget');
    expect(md).toContain('## Known Models');
    expect(md).toContain('- none');
  });

  it('renders breaker entries when present', () => {
    const snap = _buildSnapshot({
      baseMaxRetries: 1,
      retryBudget: () => ({ perModel: [] }),
      breakers: () => ({
        open: [
          {
            key: 'a',
            errorType: 'server',
            trippedAt: 0,
            failures: 1,
            msRemaining: 60_000,
          },
        ],
      }),
      knownModels: () => ['a'],
    });
    const md = formatSnapshot(snap);
    expect(md).toContain('a :: error=server');
  });
});

describe('diagnostics / provider gate integration', () => {
  it('reflects the runtime extension list', () => {
    _resetProviderGate();
    _resetRetryBudget();
    _resetAllBreakers();
    const snap = _buildSnapshot({
      baseMaxRetries: 1,
      retryBudget: () => ({ perModel: [] }),
      breakers: () => ({ open: [] }),
      knownModels: () => [],
    });
    expect(snap.providerGate.extension.length).toBe(0);
    expect(snap.providerGate.default.length).toBeGreaterThan(0);
    expect(knownDefaultProviders()).toBe(snap.providerGate.default.length);
  });
});
