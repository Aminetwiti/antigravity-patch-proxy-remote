import { describe, it, expect } from 'vitest';
import {
  readVarint,
  encodeVarint,
  parseProto,
  encodeProtoBuf,
  findModelEntryFieldTag,
  extractFieldMapping,
  encodeModelEntryForGetModels,
} from '../proxy/protobuf';

describe('readVarint', () => {
  it('decodes a single-byte varint', () => {
    const buf = Buffer.from([0x05]);
    const result = readVarint(buf, 0);
    expect(result.value).toBe(5);
    expect(result.bytes).toBe(1);
  });

  it('decodes a multi-byte varint', () => {
    const buf = Buffer.from([0xac, 0x02]);
    const result = readVarint(buf, 0);
    expect(result.value).toBe(300);
    expect(result.bytes).toBe(2);
  });

  it('decodes varint at non-zero offset', () => {
    const buf = Buffer.from([0xff, 0xff, 0x05]);
    const result = readVarint(buf, 2);
    expect(result.value).toBe(5);
    expect(result.bytes).toBe(1);
  });

  it('decodes zero', () => {
    const buf = Buffer.from([0x00]);
    const result = readVarint(buf, 0);
    expect(result.value).toBe(0);
    expect(result.bytes).toBe(1);
  });

  it('decodes 127 (max single-byte)', () => {
    const buf = Buffer.from([0x7f]);
    const result = readVarint(buf, 0);
    expect(result.value).toBe(127);
    expect(result.bytes).toBe(1);
  });

  it('decodes 128 (min two-byte)', () => {
    const buf = Buffer.from([0x80, 0x01]);
    const result = readVarint(buf, 0);
    expect(result.value).toBe(128);
    expect(result.bytes).toBe(2);
  });
});

describe('encodeVarint', () => {
  it('encodes single-byte values', () => {
    expect(encodeVarint(0)).toEqual(Buffer.from([0x00]));
    expect(encodeVarint(1)).toEqual(Buffer.from([0x01]));
    expect(encodeVarint(127)).toEqual(Buffer.from([0x7f]));
  });

  it('encodes multi-byte values', () => {
    expect(encodeVarint(128)).toEqual(Buffer.from([0x80, 0x01]));
    expect(encodeVarint(300)).toEqual(Buffer.from([0xac, 0x02]));
  });

  it('round-trips with readVarint for common values', () => {
    for (const v of [0, 1, 127, 128, 255, 16383, 16384, 1_000_000]) {
      const encoded = encodeVarint(v);
      const decoded = readVarint(encoded, 0);
      expect(decoded.value).toBe(v);
    }
  });
});

describe('parseProto', () => {
  it('parses an empty message', () => {
    const buf = Buffer.alloc(0);
    expect(parseProto(buf, 0, 0)).toEqual([]);
  });

  it('parses a varint field', () => {
    const buf = Buffer.from([0x08, 0x2a]);
    const fields = parseProto(buf, 0, buf.length);
    expect(fields).toHaveLength(1);
    expect(fields[0].fieldNum).toBe(1);
    expect(fields[0].wireType).toBe(0);
    expect(fields[0].value).toBe(42);
  });

  it('parses multiple varint fields', () => {
    const buf = Buffer.from([0x08, 0x01, 0x10, 0x02]);
    const fields = parseProto(buf, 0, buf.length);
    expect(fields).toHaveLength(2);
    expect(fields[0].fieldNum).toBe(1);
    expect(fields[0].value).toBe(1);
    expect(fields[1].fieldNum).toBe(2);
    expect(fields[1].value).toBe(2);
  });

  it('parses 64-bit (wireType=1) fields', () => {
    const buf = Buffer.from([0x09, 1, 2, 3, 4, 5, 6, 7, 8]);
    const fields = parseProto(buf, 0, buf.length);
    expect(fields).toHaveLength(1);
    expect(fields[0].wireType).toBe(1);
    expect((fields[0].value as Buffer).length).toBe(8);
  });

  it('parses 32-bit (wireType=5) fields', () => {
    const buf = Buffer.from([0x0d, 1, 2, 3, 4]);
    const fields = parseProto(buf, 0, buf.length);
    expect(fields).toHaveLength(1);
    expect(fields[0].wireType).toBe(5);
    expect((fields[0].value as Buffer).length).toBe(4);
  });

  it('parses length-delimited field with nested content', () => {
    const buf = Buffer.from([0x1a, 0x02, 0x08, 0x07]);
    const fields = parseProto(buf, 0, buf.length);
    expect(fields).toHaveLength(1);
    expect(fields[0].fieldNum).toBe(3);
    expect(fields[0].wireType).toBe(2);
    expect(Array.isArray(fields[0].value)).toBe(true);
    const inner = fields[0].value as { fieldNum: number; value: number }[];
    expect(inner[0].fieldNum).toBe(1);
    expect(inner[0].value).toBe(7);
  });
});

describe('encodeProtoBuf', () => {
  it('encodes a single field', () => {
    const encoded = encodeProtoBuf([{ tag: 0x0a, value: Buffer.from('x') }]);
    expect(encoded).toEqual(Buffer.from([0x0a, 0x01, 0x78]));
  });

  it('encodes multiple fields', () => {
    const encoded = encodeProtoBuf([
      { tag: 0x0a, value: Buffer.from('ab') },
      { tag: 0x12, value: Buffer.from('cd') },
    ]);
    expect(encoded).toEqual(Buffer.from([0x0a, 0x02, 0x61, 0x62, 0x12, 0x02, 0x63, 0x64]));
  });

  it('encodes empty buffer field', () => {
    const encoded = encodeProtoBuf([{ tag: 0x0a, value: Buffer.alloc(0) }]);
    expect(encoded).toEqual(Buffer.from([0x0a, 0x00]));
  });
});

describe('findModelEntryFieldTag', () => {
  it('returns null for empty input', () => {
    expect(findModelEntryFieldTag([])).toBeNull();
  });

  it('returns the most common tag among repeated fields', () => {
    const inner: never[] = [];
    const fields = [
      { tag: 0x1a, wireType: 2, fieldNum: 3, value: inner, start: 0, end: 0 },
      { tag: 0x1a, wireType: 2, fieldNum: 3, value: inner, start: 0, end: 0 },
      { tag: 0x22, wireType: 2, fieldNum: 4, value: inner, start: 0, end: 0 },
    ];
    expect(findModelEntryFieldTag(fields)).toBe(0x1a);
  });

  it('returns the only tag when only one repeated field exists', () => {
    const inner: never[] = [];
    const fields = [
      { tag: 0x1a, wireType: 2, fieldNum: 3, value: inner, start: 0, end: 0 },
    ];
    expect(findModelEntryFieldTag(fields)).toBe(0x1a);
  });
});

describe('extractFieldMapping', () => {
  it('maps string fields (wireType=2 with Buffer value)', () => {
    const entry = [
      { tag: 0x0a, wireType: 2, fieldNum: 1, value: Buffer.from('x'), start: 0, end: 0 },
    ];
    const mapping = extractFieldMapping(entry);
    expect(mapping.get(1)).toBe('string');
  });

  it('maps varint fields (wireType=0)', () => {
    const entry = [
      { tag: 0x08, wireType: 0, fieldNum: 1, value: 42, start: 0, end: 0 },
    ];
    const mapping = extractFieldMapping(entry);
    expect(mapping.get(1)).toBe('varint');
  });

  it('maps nested fields as bytes', () => {
    const entry = [
      { tag: 0x1a, wireType: 2, fieldNum: 3, value: [], start: 0, end: 0 },
    ];
    const mapping = extractFieldMapping(entry);
    expect(mapping.get(3)).toBe('bytes');
  });

  it('returns empty mapping for empty entry', () => {
    expect(extractFieldMapping([]).size).toBe(0);
  });
});

describe('encodeModelEntryForGetModels', () => {
  it('encodes field 1 as name', () => {
    const mapping = new Map([[1, 'string' as const]]);
    const encoded = encodeModelEntryForGetModels('gpt-4o', 'GPT-4o', mapping);
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded.toString('utf-8')).toContain('gpt-4o');
  });

  it('encodes field 2 as displayName', () => {
    const mapping = new Map([[2, 'string' as const]]);
    const encoded = encodeModelEntryForGetModels('x', 'MyDisplay', mapping);
    expect(encoded.toString('utf-8')).toContain('MyDisplay');
  });

  it('emits empty buffers for unknown string fields', () => {
    const mapping = new Map([[5, 'string' as const]]);
    const encoded = encodeModelEntryForGetModels('x', 'y', mapping);
    expect(encoded.length).toBeGreaterThan(0);
    const parsed = parseProto(encoded, 0, encoded.length);
    expect(parsed).toHaveLength(1);
    expect((parsed[0].value as Buffer).length).toBe(0);
  });

  it('handles varint fields', () => {
    const mapping = new Map([[1, 'varint' as const]]);
    const encoded = encodeModelEntryForGetModels('x', 'y', mapping);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('handles bytes fields', () => {
    const mapping = new Map([[1, 'bytes' as const]]);
    const encoded = encodeModelEntryForGetModels('x', 'y', mapping);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('handles mixed field types', () => {
    const mapping = new Map([
      [1, 'string' as const],
      [2, 'string' as const],
      [3, 'varint' as const],
    ]);
    const encoded = encodeModelEntryForGetModels('name', 'display', mapping);
    expect(encoded.toString('utf-8')).toContain('name');
    expect(encoded.toString('utf-8')).toContain('display');
  });
});
