import { describe, it, expect } from 'vitest';
import {
  parseModelIdParts,
  getBaseModelId,
  getModelVersion,
  hasVersion,
  createVersionedModelId,
  stripVersion,
  normalizeModelId,
  toSlug,
  generateAutoVersion,
  generateAutoVersionedId,
  isBaseModelIdUsed,
  fuzzyMatch,
  resolveModelId,
} from '../wellKnown/modelIdUtils';

describe('parseModelIdParts', () => {
  it('returns baseId only when no delimiter', () => {
    expect(parseModelIdParts('gpt-4o')).toEqual({ baseId: 'gpt-4o' });
  });

  it('splits on the delimiter', () => {
    expect(parseModelIdParts('claude-sonnet-4#thinking')).toEqual({
      baseId: 'claude-sonnet-4',
      version: 'thinking',
    });
  });

  it('treats empty version as no version', () => {
    expect(parseModelIdParts('gpt-4o#')).toEqual({ baseId: 'gpt-4o#' });
  });

  it('handles empty input gracefully', () => {
    expect(parseModelIdParts('')).toEqual({ baseId: '' });
  });
});

describe('getBaseModelId', () => {
  it('returns base when version present', () => {
    expect(getBaseModelId('claude-sonnet-4#thinking')).toBe('claude-sonnet-4');
  });

  it('returns id unchanged when no version', () => {
    expect(getBaseModelId('gpt-4o')).toBe('gpt-4o');
  });
});

describe('getModelVersion', () => {
  it('returns version when present', () => {
    expect(getModelVersion('claude-sonnet-4#thinking')).toBe('thinking');
  });

  it('returns undefined when no version', () => {
    expect(getModelVersion('gpt-4o')).toBeUndefined();
  });
});

describe('hasVersion', () => {
  it('returns true when version present', () => {
    expect(hasVersion('a#1')).toBe(true);
  });

  it('returns false when no version', () => {
    expect(hasVersion('a')).toBe(false);
  });

  it('returns false on empty version', () => {
    expect(hasVersion('a#')).toBe(false);
  });
});

describe('createVersionedModelId', () => {
  it('joins base + version with delimiter', () => {
    expect(createVersionedModelId('claude-sonnet-4', 'thinking')).toBe(
      'claude-sonnet-4#thinking',
    );
  });

  it('throws on empty baseId', () => {
    expect(() => createVersionedModelId('', '1')).toThrow();
  });

  it('throws on empty version', () => {
    expect(() => createVersionedModelId('gpt-4o', '')).toThrow();
  });
});

describe('stripVersion', () => {
  it('strips version', () => {
    expect(stripVersion('a#1')).toBe('a');
  });

  it('is idempotent', () => {
    expect(stripVersion('gpt-4o')).toBe('gpt-4o');
  });
});

describe('normalizeModelId', () => {
  it('lowercases', () => {
    expect(normalizeModelId('GPT-4o')).toBe('gpt-4o');
  });

  it('trims whitespace', () => {
    expect(normalizeModelId('  gpt-4o  ')).toBe('gpt-4o');
  });

  it('replaces spaces with dashes', () => {
    expect(normalizeModelId('gpt 4o')).toBe('gpt-4o');
  });

  it('replaces underscores with dashes', () => {
    expect(normalizeModelId('gpt_4o')).toBe('gpt-4o');
  });

  it('replaces dots with dashes', () => {
    expect(normalizeModelId('claude 3.5 sonnet')).toBe('claude-3-5-sonnet');
  });

  it('strips leading/trailing dashes', () => {
    expect(normalizeModelId('--gpt-4o--')).toBe('gpt-4o');
  });

  it('collapses multiple dashes', () => {
    expect(normalizeModelId('gpt--4o')).toBe('gpt-4o');
  });

  it('preserves o1-preview', () => {
    expect(normalizeModelId('o1-preview')).toBe('o1-preview');
  });

  it('strips "models/" prefix', () => {
    expect(normalizeModelId('models/gpt-4o')).toBe('gpt-4o');
  });

  it('returns empty string on empty input', () => {
    expect(normalizeModelId('')).toBe('');
  });
});

describe('toSlug', () => {
  it('returns the normalized form', () => {
    expect(toSlug('Claude Sonnet 4')).toBe('claude-sonnet-4');
    expect(toSlug('Qwen 2.5-Coder')).toBe('qwen-2-5-coder');
  });
});

describe('generateAutoVersion', () => {
  it('returns "1" when no existing versions', () => {
    expect(generateAutoVersion('gpt-4o', [])).toBe('1');
  });

  it('returns "2" when #1 exists', () => {
    expect(generateAutoVersion('gpt-4o', ['gpt-4o#1'])).toBe('2');
  });

  it('skips numeric gaps and returns max+1', () => {
    expect(generateAutoVersion('gpt-4o', ['gpt-4o#1', 'gpt-4o#3'])).toBe('4');
  });

  it('ignores other base IDs', () => {
    expect(generateAutoVersion('gpt-4o', ['claude-3-5-sonnet#1'])).toBe('1');
  });

  it('throws on empty baseModelId', () => {
    expect(() => generateAutoVersion('', [])).toThrow();
  });
});

describe('generateAutoVersionedId', () => {
  it('builds a versioned id', () => {
    expect(generateAutoVersionedId('gpt-4o', [])).toBe('gpt-4o#1');
  });

  it('auto-increments', () => {
    expect(generateAutoVersionedId('gpt-4o', ['gpt-4o#1'])).toBe('gpt-4o#2');
  });
});

describe('isBaseModelIdUsed', () => {
  it('detects collision with versioned id', () => {
    expect(isBaseModelIdUsed('gpt-4o', ['gpt-4o#1'])).toBe(true);
  });

  it('detects collision with plain id', () => {
    expect(isBaseModelIdUsed('gpt-4o', ['gpt-4o'])).toBe(true);
  });

  it('returns false when not used', () => {
    expect(isBaseModelIdUsed('gpt-4o', ['claude-3-5-sonnet'])).toBe(false);
  });

  it('respects excludeId', () => {
    expect(isBaseModelIdUsed('gpt-4o', ['gpt-4o'], 'gpt-4o')).toBe(false);
  });
});

describe('fuzzyMatch', () => {
  it('matches normalized substring', () => {
    expect(fuzzyMatch('gpt4o', 'gpt-4o')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(fuzzyMatch('SONNET', 'claude-3-5-sonnet')).toBe(true);
  });

  it('returns false when not contained', () => {
    expect(fuzzyMatch('banana', 'claude-3-5-sonnet')).toBe(false);
  });

  it('empty query matches everything', () => {
    expect(fuzzyMatch('', 'claude-3-5-sonnet')).toBe(true);
  });
});

describe('resolveModelId', () => {
  const known = [
    'gpt-4o',
    'claude-3-5-sonnet',
    'gpt-4o-mini',
    'deepseek-r1',
  ];

  it('exact match wins', () => {
    expect(resolveModelId('gpt-4o', known)).toBe('gpt-4o');
  });

  it('case-insensitive match', () => {
    expect(resolveModelId('GPT-4O', known)).toBe('gpt-4o');
  });

  it('normalized match', () => {
    expect(resolveModelId('  claude 3.5 sonnet  ', known)).toBe(
      'claude-3-5-sonnet',
    );
  });

  it('fuzzy match (longest input first)', () => {
    expect(resolveModelId('gpt 4o mini', known)).toBe('gpt-4o-mini');
  });

  it('returns null when no match', () => {
    expect(resolveModelId('banana', known)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(resolveModelId('', known)).toBeNull();
  });

  it('returns null on empty known list', () => {
    expect(resolveModelId('gpt-4o', [])).toBeNull();
  });
});
