import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { invalidateHealthCache, getCachedHealth } from '../proxy/modelHealthChecker';
import { injectCustomModelsIntoResponse } from '../proxy/protoInjector';
import { setupCustomModelsWatcher, stopCustomModelsWatcher } from '../proxy';
import type { CustomModel } from '../proxy/types';

describe('Live Model Synchronization & Cache Invalidation', () => {
  beforeEach(() => {
    invalidateHealthCache();
  });

  it('should invalidate health cache when invalidateHealthCache is called', () => {
    invalidateHealthCache();
    expect(getCachedHealth('test-model')).toBeNull();
  });

  it('should clear specific model from health cache', () => {
    invalidateHealthCache('models/test-1');
    expect(getCachedHealth('models/test-1')).toBeNull();
  });

  it('should deduplicate concurrent in-flight pings to the same endpoint', async () => {
    const { pingCustomModel } = await import('../proxy/modelHealthChecker');
    const m1: CustomModel = {
      name: 'models/dedup-1',
      displayName: 'Dedup 1',
      provider: 'openai',
      apiUrl: 'https://example.com/v1',
      apiKey: 'key-123',
    };
    const m2: CustomModel = {
      name: 'models/dedup-2',
      displayName: 'Dedup 2',
      provider: 'openai',
      apiUrl: 'https://example.com/v1',
      apiKey: 'key-123',
    };

    // Both pings invoked concurrently for the exact same endpoint
    const p1 = pingCustomModel(m1);
    const p2 = pingCustomModel(m2);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r1.status).toEqual(r2.status);
    expect(getCachedHealth('models/dedup-1')).toBeDefined();
    expect(getCachedHealth('models/dedup-2')).toBeDefined();
  });

  it('should setup and stop custom_models.json watcher without errors', () => {
    expect(() => setupCustomModelsWatcher()).not.toThrow();
    expect(() => stopCustomModelsWatcher()).not.toThrow();
  });

  it('should inject models even when health status is pending/undefined', () => {
    const customModels: CustomModel[] = [
      {
        name: 'models/gpt-4o',
        displayName: 'GPT-4o Test',
        description: 'Test model',
        provider: 'openai',
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        externalModelName: 'gpt-4o',
      },
    ];

    // Minimal mock proto buffer containing a gRPC-Web header and model tag 1 string
    // Tag 1 wire type 2 = 0x0a, length = 6 "models"
    const sampleProtoMsg = Buffer.from([0x0a, 0x06, 0x6d, 0x6f, 0x64, 0x65, 0x6c, 0x73]);
    const sampleGrpcFrame = Buffer.alloc(5 + sampleProtoMsg.length);
    sampleGrpcFrame[0] = 0; // flags
    sampleGrpcFrame.writeUInt32BE(sampleProtoMsg.length, 1);
    sampleProtoMsg.copy(sampleGrpcFrame, 5);

    const result = injectCustomModelsIntoResponse(sampleGrpcFrame, customModels, undefined);
    expect(result.injectedCount).toBe(1);
    expect(result.modified).toBe(true);
  });
});
