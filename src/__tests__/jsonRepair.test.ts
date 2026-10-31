import { describe, it, expect } from 'vitest';
import { repairPartialJson, repairPartialJsonOrThrow } from '../proxy/jsonRepair';

describe('repairPartialJson', () => {
  describe('valid JSON (fast path)', () => {
    it('parses simple object', () => {
      expect(repairPartialJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses nested object', () => {
      expect(repairPartialJson('{"a":{"b":[1,2,3]}}')).toEqual({ a: { b: [1, 2, 3] } });
    });

    it('parses array', () => {
      expect(repairPartialJson('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses string', () => {
      expect(repairPartialJson('"hello"')).toBe('hello');
    });

    it('parses number', () => {
      expect(repairPartialJson('42')).toBe(42);
    });

    it('parses boolean', () => {
      expect(repairPartialJson('true')).toBe(true);
    });

    it('parses null', () => {
      expect(repairPartialJson('null')).toBe(null);
    });
  });

  describe('null and empty inputs', () => {
    it('returns null for null input', () => {
      expect(repairPartialJson(null)).toBe(null);
    });

    it('returns null for undefined input', () => {
      expect(repairPartialJson(undefined)).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(repairPartialJson('')).toBe(null);
    });

    it('returns null for non-string input', () => {
      expect(repairPartialJson(123 as unknown as string)).toBe(null);
    });
  });

  describe('BOM and whitespace', () => {
    it('strips BOM', () => {
      expect(repairPartialJson('\uFEFF{"a":1}')).toEqual({ a: 1 });
    });

    it('trims whitespace', () => {
      expect(repairPartialJson('  \n  {"a":1}  \t')).toEqual({ a: 1 });
    });
  });

  describe('trailing commas', () => {
    it('removes trailing comma in object', () => {
      expect(repairPartialJson('{"a":1,}')).toEqual({ a: 1 });
    });

    it('removes trailing comma in array', () => {
      expect(repairPartialJson('[1,2,3,]')).toEqual([1, 2, 3]);
    });

    it('removes trailing comma in nested structure', () => {
      expect(repairPartialJson('{"a":[1,2,], "b":{"c":3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
    });
  });

  describe('unquoted keys', () => {
    it('quotes simple unquoted keys', () => {
      expect(repairPartialJson('{a:1}')).toEqual({ a: 1 });
    });

    it('quotes multiple unquoted keys', () => {
      expect(repairPartialJson('{a:1, b:2, c:3}')).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('preserves already-quoted keys', () => {
      expect(repairPartialJson('{"a":1, b:2}')).toEqual({ a: 1, b: 2 });
    });
  });

  describe('single quotes', () => {
    it('converts single quotes to double quotes', () => {
      expect(repairPartialJson("{'a':1}")).toEqual({ a: 1 });
    });

    it('converts single quotes in string values', () => {
      expect(repairPartialJson("{'a':'hello'}")).toEqual({ a: 'hello' });
    });
  });

  describe('comments', () => {
    it('removes block comments', () => {
      expect(repairPartialJson('{"a":1 /* comment */}')).toEqual({ a: 1 });
    });

    it('removes line comments', () => {
      expect(repairPartialJson('{"a":1, // comment\n"b":2}')).toEqual({ a: 1, b: 2 });
    });
  });

  describe('truncated JSON', () => {
    it('closes truncated array', () => {
      expect(repairPartialJson('[1,2,3')).toEqual([1, 2, 3]);
    });

    it('closes truncated object', () => {
      expect(repairPartialJson('{"a":1')).toEqual({ a: 1 });
    });
  });

  describe('safety', () => {
    it('does not execute code via Function constructor', () => {
      // This input would be dangerous if eval'd but should just fail parsing
      const malicious = 'process.exit(1)';
      expect(repairPartialJson(malicious)).toBe(null);
    });

    it('rejects oversized input', () => {
      const huge = '{"a":"' + 'x'.repeat(2 * 1024 * 1024) + '"}';
      expect(repairPartialJson(huge)).toBe(null);
    });
  });

  describe('unrepairable input', () => {
    it('returns null for garbage', () => {
      expect(repairPartialJson('not json at all')).toBe(null);
    });

    it('returns null for deeply broken JSON', () => {
      expect(repairPartialJson('{{{}}}')).toBe(null);
    });
  });
});

describe('repairPartialJsonOrThrow', () => {
  it('returns parsed value for valid JSON', () => {
    expect(repairPartialJsonOrThrow('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns parsed value after repair', () => {
    expect(repairPartialJsonOrThrow('{"a":1,}')).toEqual({ a: 1 });
  });

  it('throws SyntaxError for unrepairable input', () => {
    expect(() => repairPartialJsonOrThrow('garbage')).toThrow(SyntaxError);
  });
});
