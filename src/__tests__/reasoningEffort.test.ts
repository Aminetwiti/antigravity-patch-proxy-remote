import { describe, it, expect } from 'vitest';
import {
  REASONING_EFFORTS,
  THINKING_BUDGETS,
  coerceReasoningEffort,
  coerceThinkingBudget,
  adaptiveReasoningEffort,
  budgetReasoningEffort,
  isReasoningLikeModel,
  type ReasoningEffort,
  type ThinkingBudget,
} from '../presets/reasoningEffort';

describe('REASONING_EFFORTS / THINKING_BUDGETS', () => {
  it('exposes the canonical lists', () => {
    expect(REASONING_EFFORTS).toEqual(['auto', 'none', 'low', 'medium', 'high']);
    expect(THINKING_BUDGETS).toEqual(['auto', 'enabled', 'disabled']);
  });
});

describe('coerceReasoningEffort', () => {
  it('keeps valid values', () => {
    for (const effort of REASONING_EFFORTS) {
      expect(coerceReasoningEffort(effort)).toBe(effort);
    }
  });

  it('lowercases casing', () => {
    expect(coerceReasoningEffort('MEDIUM')).toBe<ReasoningEffort>('medium');
  });

  it('trims whitespace', () => {
    expect(coerceReasoningEffort('  high  ')).toBe('high');
  });

  it('falls back to auto on unknown values', () => {
    expect(coerceReasoningEffort('xyz')).toBe('auto');
    expect(coerceReasoningEffort('')).toBe('auto');
  });

  it('falls back to auto on non-string', () => {
    expect(coerceReasoningEffort(undefined)).toBe('auto');
    expect(coerceReasoningEffort(null)).toBe('auto');
    expect(coerceReasoningEffort(42)).toBe('auto');
    expect(coerceReasoningEffort({})).toBe('auto');
  });
});

describe('coerceThinkingBudget', () => {
  it('keeps valid values', () => {
    for (const budget of THINKING_BUDGETS) {
      expect(coerceThinkingBudget(budget)).toBe(budget);
    }
  });

  it('lowercases + trims', () => {
    expect(coerceThinkingBudget('ENABLED')).toBe<ThinkingBudget>('enabled');
    expect(coerceThinkingBudget(' disabled ')).toBe('disabled');
  });

  it('falls back to auto on unknown', () => {
    expect(coerceThinkingBudget('xyz')).toBe('auto');
    expect(coerceThinkingBudget(7)).toBe('auto');
  });
});

describe('adaptiveReasoningEffort', () => {
  it('returns explicit non-auto values', () => {
    expect(adaptiveReasoningEffort('low', 100_000)).toBe('low');
    expect(adaptiveReasoningEffort('high', 0)).toBe('high');
  });

  it('uses low for short context', () => {
    expect(adaptiveReasoningEffort('auto', 1_000)).toBe('low');
    expect(adaptiveReasoningEffort('auto', 0)).toBe('medium'); // 0 fallback
  });

  it('uses medium for typical context', () => {
    expect(adaptiveReasoningEffort('auto', 8_000)).toBe('medium');
    expect(adaptiveReasoningEffort('auto', 64_000)).toBe('medium');
  });

  it('uses high for very large context', () => {
    expect(adaptiveReasoningEffort('auto', 250_000)).toBe('high');
    expect(adaptiveReasoningEffort('auto', 1_000_000)).toBe('high');
  });

  it('falls back to medium on invalid context', () => {
    expect(adaptiveReasoningEffort('auto', Number.NaN)).toBe('medium');
    expect(adaptiveReasoningEffort('auto', -1)).toBe('medium');
  });
});

describe('budgetReasoningEffort', () => {
  it('returns explicit non-auto values', () => {
    expect(budgetReasoningEffort('enabled', 'gpt-4o-mini')).toBe<ThinkingBudget>('enabled');
    expect(budgetReasoningEffort('disabled', 'o1-mini')).toBe('disabled');
  });

  it('enables for reasoning-like models', () => {
    for (const m of ['o1-mini', 'o3', 'deepseek-r1', 'reasoning-model', 'claude-3-7-sonnet']) {
      expect(budgetReasoningEffort('auto', m)).toBe('enabled');
    }
  });

  it('disables for plain chat models', () => {
    for (const m of ['gpt-4o', 'gpt-4o-mini', 'llama3.1', 'mistral-large']) {
      expect(budgetReasoningEffort('auto', m)).toBe('disabled');
    }
  });

  it('handles empty input', () => {
    expect(budgetReasoningEffort('auto', '')).toBe('disabled');
  });
});

describe('isReasoningLikeModel', () => {
  it('returns true for reasoning-like names', () => {
    expect(isReasoningLikeModel('o1-mini')).toBe(true);
    expect(isReasoningLikeModel('deepseek-r1')).toBe(true);
    expect(isReasoningLikeModel('claude-3-7-sonnet')).toBe(true);
    expect(isReasoningLikeModel('reasoning-model')).toBe(true);
    expect(isReasoningLikeModel('gemini-3.8-flash')).toBe(true);
    expect(isReasoningLikeModel('gemini-3.7-pro')).toBe(true);
    expect(isReasoningLikeModel('gpt-oss-120b')).toBe(true);
  });

  it('returns false for plain chat models', () => {
    expect(isReasoningLikeModel('gpt-4o')).toBe(false);
    expect(isReasoningLikeModel('llama3.1')).toBe(false);
  });

  it('handles empty input', () => {
    expect(isReasoningLikeModel('')).toBe(false);
  });
});
