/**
 * Unit Test Suite for Pillars 1, 2, 3, and 4
 * Verifies Real-time Stats, Health Probe Service, Encrypted Box Export/Import, and Traffic Replay & Diff.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((name: string) => '/mock/' + name) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (str: string) => Buffer.from(str),
    decryptString: (buf: Buffer) => buf.toString('utf-8'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/modelStore', () => ({
  testModelConnection: vi.fn(async () => ({ success: false, error: 'Connection failed' })),
}));

import { trackTokenUsage, getRealtimeStats, reset as resetMetrics } from '../metrics';
import { HealthProbeService } from '../services/healthProbe';
import { exportAgBoxPackage, importAgBoxPackage } from '../services/cryptoStore';
import { TrafficInspectorEngine } from '../../ag-doctor-ui/src/renderer/traffic-inspector';

describe('Pillar 1: Real-time Telemetry & Token Stats', () => {
  it('tracks token usage per provider correctly', () => {
    resetMetrics();
    trackTokenUsage('openai', 150, 350);
    trackTokenUsage('openai', 50, 100);

    const stats = getRealtimeStats();
    expect(stats.totalTokens).toBe(650);
    expect(stats.successRate).toBe(100);
  });
});

describe('Pillar 2: Auto-Healing & Background Probe', () => {
  it('manages provider health state and suggests fallbacks', async () => {
    const probe = new HealthProbeService(60000);
    const mockProviders = [
      { id: 'p1', provider: 'openai', apiUrl: 'http://localhost:9999/v1' },
      { id: 'p2', provider: 'anthropic', apiUrl: 'http://localhost:9999/v1' },
    ];

    const healthMap = await probe.runProbeCycle(mockProviders);
    expect(healthMap.size).toBe(2);

    const fallback = probe.suggestFallback('p1');
    expect(fallback).toBeNull(); // localhost connection failed in mock
  });
});

describe('Pillar 3: OS Keychain Sync & Encrypted Box Export/Import', () => {
  it('exports and imports .agbox configuration package', () => {
    const sampleData = {
      models: [{ name: 'gpt-4o', provider: 'openai', apiKey: 'sk-secret' }],
      customProviders: [{ id: 'p-1', name: 'Custom AI' }],
    };

    const boxed = exportAgBoxPackage(sampleData, 'secret-pass');
    expect(typeof boxed).toBe('string');
    expect(boxed.length).toBeGreaterThan(20);

    const imported = importAgBoxPackage(boxed, 'secret-pass');
    expect(imported.success).toBe(true);
    expect(imported.data).toEqual(sampleData);
  });

  it('rejects malformed .agbox packages gracefully', () => {
    const imported = importAgBoxPackage('invalid-base64-content');
    expect(imported.success).toBe(false);
    expect(imported.error).toBeDefined();
  });
});

describe('Pillar 4: Traffic Inspector & 1-Click Replay', () => {
  it('captures traffic entries, computes diffs, and replays requests', async () => {
    const inspector = new TrafficInspectorEngine();
    const entry = inspector.logTraffic({
      method: 'POST',
      path: '/v1/chat/completions',
      targetModel: 'gpt-4o',
      translatedProvider: 'openai',
      statusCode: 429,
      latencyMs: 120,
      requestPayload: '{"prompt":"hello"}',
      responsePayload: '{"error":"rate_limit"}',
    });

    expect(entry.id).toBeDefined();
    expect(inspector.getEntries().length).toBe(1);

    const diff = inspector.generateDiffView(entry);
    expect(diff.isError).toBe(true);
    expect(diff.reqRaw).toContain('hello');

    const replayed = await inspector.replayEntry(entry.id, async () => ({
      statusCode: 200,
      latencyMs: 45,
    }));

    expect(replayed).not.toBeNull();
    expect(replayed?.statusCode).toBe(200);
    expect(inspector.getEntries().length).toBe(2);
  });
});
