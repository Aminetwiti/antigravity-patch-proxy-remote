import { describe, expect, it } from 'vitest';

/**
 * Unit tests for ASAR backup candidate labeling logic.
 */

function labelFor(filename: string): string {
  if (/original/i.test(filename)) return 'original snapshot';
  if (/pre-(sslcert|proxyfix|dnsfix)/i.test(filename)) return 'pre-fix snapshot';
  if (/v\d+\.\d+\.\d+/i.test(filename)) return 'versioned backup';
  if (/^app\.asar\.backup$/i.test(filename)) return 'pre-edit backup';
  if (/\.tmp2?$/i.test(filename)) return 'temp file (risky)';
  if (/\.bak$/i.test(filename)) return 'generic backup';
  return 'asar file';
}

describe('ASAR backup candidate labeling', () => {
  it('labels original snapshot files correctly', () => {
    expect(labelFor('app.asar.2.2.0.original-1710000000.bak')).toBe('original snapshot');
    expect(labelFor('app.asar.original.bak')).toBe('original snapshot');
  });

  it('labels pre-fix snapshot files correctly', () => {
    expect(labelFor('app.asar.pre-sslcert.bak')).toBe('pre-fix snapshot');
    expect(labelFor('app.asar.pre-proxyfix.bak')).toBe('pre-fix snapshot');
    expect(labelFor('app.asar.pre-dnsfix.bak')).toBe('pre-fix snapshot');
  });

  it('labels versioned backup files correctly', () => {
    expect(labelFor('app.asar.v2.3.1.bak')).toBe('versioned backup');
    expect(labelFor('app.asar.v2.2.0.bak')).toBe('versioned backup');
  });

  it('labels pre-edit backup files correctly', () => {
    expect(labelFor('app.asar.backup')).toBe('pre-edit backup');
  });

  it('labels temporary files as risky', () => {
    expect(labelFor('app.asar.tmp')).toBe('temp file (risky)');
    expect(labelFor('app.asar.tmp2')).toBe('temp file (risky)');
  });

  it('labels generic backup files correctly', () => {
    expect(labelFor('app.asar.old.bak')).toBe('generic backup');
    expect(labelFor('app.asar.12345.bak')).toBe('generic backup');
  });

  it('defaults to asar file for unrecognized names', () => {
    expect(labelFor('custom-archive.asar')).toBe('asar file');
  });
});
