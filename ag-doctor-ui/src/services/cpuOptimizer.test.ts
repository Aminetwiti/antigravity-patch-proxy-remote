import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getCpuOptimizationStatus,
  applyCpuOptimizations,
  revertCpuOptimizations,
  CPU_OPTIMIZATION_CONFIG,
} from './cpuOptimizer';

describe('cpuOptimizer service', () => {
  let tmpDir: string;
  let testSettingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cpu-opt-test-'));
    testSettingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('reports non-existent settings file properly', () => {
    const status = getCpuOptimizationStatus([testSettingsPath]);
    expect(status.isOptimized).toBe(false);
    expect(status.profiles).toHaveLength(1);
    expect(status.profiles[0].exists).toBe(false);
    expect(status.profiles[0].optimized).toBe(false);
  });

  it('detects unoptimized settings file', () => {
    fs.writeFileSync(testSettingsPath, '{\n  "editor.fontSize": 14\n}\n', 'utf-8');
    const status = getCpuOptimizationStatus([testSettingsPath]);
    expect(status.isOptimized).toBe(false);
    expect(status.profiles[0].exists).toBe(true);
    expect(status.profiles[0].optimized).toBe(false);
    expect(status.profiles[0].hasWatcherExclude).toBe(false);
  });

  it('applies CPU optimizations and creates backup', () => {
    fs.writeFileSync(testSettingsPath, '{\n  "editor.fontSize": 14\n}\n', 'utf-8');
    const res = applyCpuOptimizations([testSettingsPath]);
    expect(res.success).toBe(true);
    expect(res.modified).toContain(testSettingsPath);

    const updated = fs.readFileSync(testSettingsPath, 'utf-8');
    expect(updated).toContain('files.watcherExclude');
    expect(updated).toContain('typescript.tsserver.maxTsServerMemory');
    expect(updated).toContain('editor.fontSize');

    const status = getCpuOptimizationStatus([testSettingsPath]);
    expect(status.isOptimized).toBe(true);
    expect(status.profiles[0].optimized).toBe(true);
    expect(status.profiles[0].backupExists).toBe(true);
  });

  it('skips already optimized settings without re-modifying', () => {
    fs.writeFileSync(testSettingsPath, '{\n  "editor.fontSize": 14\n}\n', 'utf-8');
    applyCpuOptimizations([testSettingsPath]);
    const res2 = applyCpuOptimizations([testSettingsPath]);
    expect(res2.skipped).toContain(testSettingsPath);
    expect(res2.modified).toHaveLength(0);
  });

  it('reverts optimizations from backup', () => {
    const original = '{\n  "editor.fontSize": 14\n}\n';
    fs.writeFileSync(testSettingsPath, original, 'utf-8');
    applyCpuOptimizations([testSettingsPath]);

    const revertRes = revertCpuOptimizations([testSettingsPath]);
    expect(revertRes.success).toBe(true);
    expect(revertRes.restored).toContain(testSettingsPath);

    const restoredContent = fs.readFileSync(testSettingsPath, 'utf-8');
    expect(restoredContent).toBe(original);
  });
});
