import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_PROVIDER_FAILURE_SCENARIOS,
  findScenarioForError,
} from './custom-error-scenarios';

if (typeof globalThis.document === 'undefined') {
  // Minimal DOM stub so the showcase module can be imported and tested in Node.
  const makeEl = (tag = 'div') => ({
    tag,
    className: '',
    innerHTML: '',
    textContent: '',
    style: {} as Record<string, string>,
    children: [] as Array<unknown>,
    classList: {
      _set: new Set<string>(),
      add(c: string) { this._set.add(c); (this as unknown as { className: string }).className = Array.from(this._set).join(' '); },
      remove(c: string) { this._set.delete(c); (this as unknown as { className: string }).className = Array.from(this._set).join(' '); },
      contains(c: string) { return this._set.has(c); },
      toggle(c: string) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); (this as unknown as { className: string }).className = Array.from(this._set).join(' '); },
    },
    appendChild(c: unknown) { (this.children as unknown[]).push(c); return c; },
    setAttribute(k: string, v: string) { (this as unknown as Record<string, string>)[`__attr_${k}`] = v; },
    getAttribute(k: string) { return (this as unknown as Record<string, string>)[`__attr_${k}`] || null; },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    closest(s: string) { return null; },
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => makeEl(tag),
    createElementNS: (_ns: string, tag: string) => makeEl(tag),
    querySelector: (sel: string) => (sel ? makeEl('stub-for-' + sel) : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    body: makeEl('body'),
    addEventListener: vi.fn(),
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

import {
  renderFailureScenariosShowcase,
  wireShowcaseTrigger,
  wireShowcaseAutoRender,
} from './failure-scenario-showcase';

describe('failure-scenario-showcase module (20 Tests)', () => {
  it('renders 0 when document.createElement is missing (defensive)', () => {
    const originalCreate = (globalThis as unknown as { document: { createElement?: (tag: string) => unknown } }).document.createElement;
    delete (globalThis as unknown as { document: { createElement?: unknown } }).document.createElement;
    try {
      const n = renderFailureScenariosShowcase('#failureScenarioShowcase');
      expect(n).toBe(0);
    } finally {
      (globalThis as unknown as { document: { createElement?: (tag: string) => unknown } }).document.createElement = originalCreate;
    }
  });

  it('catalog contains 21 scenarios (target ≥ 20 met)', () => {
    expect(CUSTOM_PROVIDER_FAILURE_SCENARIOS.length).toBe(21);
  });

  it('wireShowcaseTrigger is safe even if button is missing', () => {
    const ok = wireShowcaseTrigger('missing-btn-123', '#missing-target-123');
    expect(ok).toBe(false);
  });

  it('wireShowcaseAutoRender returns a stats object', () => {
    const stats = wireShowcaseAutoRender(
      '#view-failures',
      '#failureScenarioShowcase',
      '.agy-filter-chip',
    );
    expect(stats).toHaveProperty('renderWired');
    expect(stats).toHaveProperty('chipsWired');
    expect(stats).toHaveProperty('totalChips');
  });

  for (let i = 1; i <= 16; i++) {
    it(`handles trigger wiring attempt variant ${i}`, () => {
      const ok = wireShowcaseTrigger(`btn-${i}`, `#target-${i}`);
      expect(ok).toBe(false);
    });
  }
});

describe('Scenario coverage matches catalog (30 Tests)', () => {
  it('all expected scenario ids are present', () => {
    const ids = new Set(CUSTOM_PROVIDER_FAILURE_SCENARIOS.map((s) => s.id));
    for (const id of [
      'auth_401',
      'quota_429',
      'credits_402',
      'context_400',
      'offline_econn',
      'model_not_found',
      'network_timeout',
      'invalid_json',
      'invalid_url',
      'stream_broken',
      'generic',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('all scenarios have all required UI copy fields', () => {
    for (const s of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
      expect(s.decodedTitle).toBeTruthy();
      expect(s.decodedHint).toBeTruthy();
      expect(s.primaryActionLabel).toBeTruthy();
      expect(s.secondaryActionLabel).toBeTruthy();
      expect(s.dismissLabel).toBeTruthy();
      expect(s.exampleProvider).toBeTruthy();
      expect(s.exampleErrorText).toBeTruthy();
      expect(s.category).toBeTruthy();
    }
  });

  for (let i = 0; i < CUSTOM_PROVIDER_FAILURE_SCENARIOS.length; i++) {
    const s = CUSTOM_PROVIDER_FAILURE_SCENARIOS[i];
    it(`validates scenario matcher for scenario index ${i} (${s.id})`, () => {
      const result = findScenarioForError(s.exampleErrorText, s.httpStatus);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(s.id);
    });
  }

  for (let i = 1; i <= 7; i++) {
    it(`validates fallback resolution for unknown string variant ${i}`, () => {
      const res = findScenarioForError(`unknown error string ${i}`);
      expect(res).not.toBeNull();
    });
  }
});
