import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockReadFileSync,
  mockGetAppAsarPath,
  mockListPackage,
  mockExtractFile,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockGetAppAsarPath: vi.fn(),
  mockListPackage: vi.fn(),
  mockExtractFile: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
}));

vi.mock('./paths', () => ({
  getAppAsarPath: mockGetAppAsarPath,
  getLanguageServerBinary: vi.fn(),
  getLanguageServerBackup: vi.fn(),
}));

vi.mock('./antigravity', () => ({
  detectAntigravityVersion: vi.fn(),
}));

vi.mock('./config', () => ({
  getPatchVersionOverride: vi.fn(() => ({ range: null, reason: null, setAt: null })),
  DEFAULT_MITM_PORT: 51074,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronAsarPath = require.resolve('@electron/asar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronAsarReal = require('@electron/asar');
// @ts-ignore
require.cache[electronAsarPath] = {
  id: electronAsarPath,
  filename: electronAsarPath,
  loaded: true,
  exports: {
    ...electronAsarReal,
    listPackage: (...args: any[]) => mockListPackage(...args),
    extractFile: (...args: any[]) => mockExtractFile(...args),
  },
  // @ts-ignore
  children: [],
  // @ts-ignore
  paths: [],
};

(globalThis as any).__hoistedAsarSpy__ = {
  listPackage: mockListPackage,
  extractFile: vi.fn(),
};

import fs from 'fs';
import { inspectOverlayPatchFingerprint } from './version-specific-patch';

describe('inspectOverlayPatchFingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAppAsarPath.mockReturnValue('C:\\Antigravity\\resources\\app.asar');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(Buffer.from(''));
    mockListPackage.mockReturnValue([]);
    // Default: package.json unreadable → version unknown → tree-only heuristic.
    mockExtractFile.mockImplementation(() => {
      throw new Error('no package.json');
    });
  });

  it('returns unavailable when app.asar is missing', () => {
    mockExistsSync.mockReturnValue(false);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result).toEqual({
      detected: false,
      range: null,
      confidence: 'low',
      reason: 'app.asar not found; JS overlay fingerprint unavailable.',
      signals: [],
    });
  });

  it('detects the 2.2 family with high confidence when proxy tree and proxy-runner exist', () => {
    mockListPackage.mockReturnValue([
      'dist/proxy/modelLoader.js',
      'dist/proxy/registry.js',
      'proxy-runner.js',
      'dist/cryptoStore.js',
    ]);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.2.0 - 2.2.x');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('proxy tree and proxy-runner are present');
    expect(result.signals).toEqual(expect.arrayContaining(['proxy-tree-present', 'proxy-runner-present']));
  });

  it('detects the 2.2 family with medium confidence when only the proxy tree exists', () => {
    mockListPackage.mockReturnValue([
      'dist/proxy/modelLoader.js',
      'dist/proxy/registry.js',
    ]);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.2.0 - 2.2.x');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('proxy tree is still present');
    expect(result.signals).toContain('proxy-tree-present');
    expect(result.signals).not.toContain('proxy-runner-present');
  });

  it('detects the 2.3 family with high confidence when proxy tree, proxy-runner, and helper modules are all absent', () => {
    mockListPackage.mockReturnValue([
      'dist/main.js',
      'dist/ipcHandlers.js',
    ]);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.3.0+');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('proxy tree, proxy-runner, and helper overlay modules are all absent');
    expect(result.signals).toEqual(['overlay-helper-modules-missing']);
  });

  it('detects the 2.3 family with medium confidence when proxy tree and proxy-runner are absent but helper modules remain', () => {
    mockListPackage.mockReturnValue([
      'dist/cryptoStore.js',
      'dist/customModelStore.js',
      'dist/schemaValidator.js',
    ]);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.3.0+');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('proxy tree is absent');
    expect(result.signals).toEqual([]);
  });

  it('returns inconclusive when signals conflict', () => {
    mockListPackage.mockReturnValue([
      'proxy-runner.js',
      'dist/customModelStore.js',
    ]);

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result).toEqual({
      detected: false,
      range: null,
      confidence: 'low',
      reason: 'JS overlay fingerprint is inconclusive for this installation.',
      signals: ['proxy-runner-present'],
    });
  });

  it('labels a patched overlay on a 2.3+ install as injected, not stock 2.2', () => {
    mockListPackage.mockReturnValue([
      'dist/proxy/modelLoader.js',
      'dist/proxy/registry.js',
      'proxy-runner.js',
      'dist/cryptoStore.js',
    ]);
    mockExtractFile.mockReturnValue(Buffer.from(JSON.stringify({ name: 'antigravity', version: '2.10.0' })));

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.3.0+');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('injected by ag-doctor');
    expect(result.signals).toEqual(
      expect.arrayContaining(['proxy-tree-present', 'proxy-runner-present', 'patched-overlay-present']),
    );
  });

  it('keeps the stock 2.2 label when the app version really is 2.2.x', () => {
    mockListPackage.mockReturnValue([
      'dist/proxy/modelLoader.js',
      'dist/proxy/registry.js',
      'proxy-runner.js',
    ]);
    mockExtractFile.mockReturnValue(Buffer.from(JSON.stringify({ name: 'antigravity', version: '2.2.5' })));

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(true);
    expect(result.range).toBe('2.2.0 - 2.2.x');
    expect(result.reason).toContain('proxy tree and proxy-runner are present');
    expect(result.signals).not.toContain('patched-overlay-present');
  });

  it('returns a low-confidence error when app.asar inspection throws', () => {
    mockListPackage.mockImplementation(() => {
      throw new Error('corrupt asar');
    });

    const result = inspectOverlayPatchFingerprint('C:\\Antigravity');

    expect(result.detected).toBe(false);
    expect(result.range).toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Failed to inspect app.asar');
    expect(result.reason).toContain('corrupt asar');
    expect(result.signals).toEqual([]);
  });
});
