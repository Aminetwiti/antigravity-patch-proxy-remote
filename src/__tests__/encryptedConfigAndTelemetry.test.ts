/**
 * Unit & Integration Tests for Telemetry Store & AES-256-GCM Encrypted Config Exchange
 */

import { describe, it, expect } from 'vitest';
import { telemetryStore } from '../services/telemetryStore';
import { exportEncryptedConfig, importEncryptedConfig } from '../services/configExchange';
import type { ProviderFileEntry } from '../preload/types';

describe('Telemetry & Metrics Store', () => {
  it('initializes default metrics for a new provider', () => {
    const metrics = telemetryStore.getOrCreateMetrics('prov-test-1');
    expect(metrics.providerId).toBe('prov-test-1');
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.status).toBe('unknown');
  });

  it('records successful requests and calculates rolling latency average', () => {
    telemetryStore.recordRequest('prov-test-2', true, 120, 100, 50);
    telemetryStore.recordRequest('prov-test-2', true, 180, 200, 100);

    const metrics = telemetryStore.getOrCreateMetrics('prov-test-2');
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(2);
    expect(metrics.inputTokens).toBe(300);
    expect(metrics.outputTokens).toBe(150);
    expect(metrics.averageLatencyMs).toBe(150);
    expect(metrics.status).toBe('healthy');
  });

  it('marks status as degraded when average latency exceeds 1500ms', () => {
    telemetryStore.recordRequest('prov-slow', true, 2000);
    const metrics = telemetryStore.getOrCreateMetrics('prov-slow');
    expect(metrics.status).toBe('degraded');
  });

  it('marks status as offline when failures exceed successes', () => {
    telemetryStore.recordRequest('prov-failing', false, 500);
    telemetryStore.recordRequest('prov-failing', false, 500);
    const metrics = telemetryStore.getOrCreateMetrics('prov-failing');
    expect(metrics.status).toBe('offline');
  });
});

describe('Password-Protected AES-256-GCM Encrypted Config Exchange', () => {
  const sampleProviders: ProviderFileEntry[] = [
    {
      id: 'custom-secret-1',
      name: 'Secret Provider',
      baseUrl: 'https://secret.api.com/v1',
      apiKey: 'sk-secret-key-12345',
      models: [{ id: 'secret-model-v1', name: 'Secret Model' }],
    },
  ];

  it('encrypts and decrypts provider config with correct password', () => {
    const password = 'SuperSecretPassword123!';
    const encryptedBase64 = exportEncryptedConfig(sampleProviders, password);
    expect(typeof encryptedBase64).toBe('string');
    expect(encryptedBase64.length).toBeGreaterThan(50);

    const decrypted = importEncryptedConfig(encryptedBase64, password);
    expect(decrypted).toHaveLength(1);
    expect(decrypted[0].id).toBe('custom-secret-1');
    expect(decrypted[0].apiKey).toBe('sk-secret-key-12345');
  });

  it('throws error when attempting to decrypt with incorrect password', () => {
    const encryptedBase64 = exportEncryptedConfig(sampleProviders, 'CorrectPassword');
    expect(() => importEncryptedConfig(encryptedBase64, 'WrongPassword')).toThrow(/Decryption failed/i);
  });

  it('throws error on corrupted base64 string', () => {
    expect(() => importEncryptedConfig('not-a-valid-base64!!!', 'pass')).toThrow();
  });
});
