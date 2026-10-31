import { describe, expect, it } from 'vitest';
import path from 'path';

/**
 * Unit tests for platform path resolution and WSL mount conversion.
 */

function winToWsl(winPath: string): string {
  const m = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return winPath;
  return path.posix.join('/mnt', m[1].toLowerCase(), m[2].replace(/\\/g, '/'));
}

describe('platform winToWsl path conversion', () => {
  it('converts Windows drive paths (C:\\...) to WSL mount paths (/mnt/c/...)', () => {
    expect(winToWsl('C:\\Users\\developer\\AppData')).toBe('/mnt/c/Users/developer/AppData');
    expect(winToWsl('D:\\Projects\\antigravity')).toBe('/mnt/d/Projects/antigravity');
    expect(winToWsl('E:\\test\\file.txt')).toBe('/mnt/e/test/file.txt');
  });

  it('handles lower and upper case drive letters identically', () => {
    expect(winToWsl('c:\\Users\\developer')).toBe('/mnt/c/Users/developer');
    expect(winToWsl('Z:\\data')).toBe('/mnt/z/data');
  });

  it('returns non-Windows paths unchanged', () => {
    expect(winToWsl('/usr/local/bin')).toBe('/usr/local/bin');
    expect(winToWsl('relative/path/to/file')).toBe('relative/path/to/file');
  });
});
