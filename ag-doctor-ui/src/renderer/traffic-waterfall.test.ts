import { describe, expect, it } from 'vitest';
import {
  TrafficInspectorEngine,
  generateCurlCommand,
  computeTimingBreakdown,
  filterByStatusCategory,
  TrafficEntry,
} from './traffic-inspector';

describe('Traffic Waterfall & cURL Generation Module', () => {
  it('computes timing breakdown with DNS, TLS, TTFT and Stream durations', () => {
    const entry: TrafficEntry = {
      id: 'tr-test-1',
      timestamp: Date.now(),
      method: 'POST',
      path: '/v1internal:streamGenerateContent?alt=sse',
      targetModel: 'gemini-3.8-flash-tiered',
      translatedProvider: 'GoogleCloudCode',
      statusCode: 200,
      latencyMs: 1450,
      dnsLookupMs: 12,
      tlsHandshakeMs: 45,
      timeToFirstTokenMs: 250,
      streamMs: 1200,
      stepId: 'cortex_step_492',
    };

    const timing = computeTimingBreakdown(entry);
    expect(timing.dns).toBe(12);
    expect(timing.tls).toBe(45);
    expect(timing.ttft).toBe(250);
    expect(timing.stream).toBe(1200);
    expect(timing.total).toBe(1450);
  });

  it('generates valid sanitized cURL command with masked tokens by default', () => {
    const entry: TrafficEntry = {
      id: 'tr-test-2',
      timestamp: Date.now(),
      method: 'POST',
      path: '/v1internal:streamGenerateContent',
      targetModel: 'gemini-3.8-flash-tiered',
      translatedProvider: 'GoogleCloudCode',
      statusCode: 200,
      latencyMs: 800,
      stepId: 'step_301',
      requestPayload: JSON.stringify({
        model: 'gemini-3.8-flash-tiered',
        request: { contents: [{ role: 'user', parts: [{ text: 'Hello AI' }] }] },
      }),
      headers: {
        Authorization: 'Bearer ya29.a0ARrdaM8secret999',
        'x-api-key': 'AIzaSySecretKey999',
      },
    };

    const curl = generateCurlCommand(entry);
    expect(curl).toContain('curl -X POST');
    expect(curl).toContain('/v1internal:streamGenerateContent');
    expect(curl).toContain('-H "x-antigravity-model: gemini-3.8-flash-tiered"');
    expect(curl).toContain('-H "x-cortex-step-id: step_301"');
    expect(curl).toContain('Bearer [REDACTED_TOKEN]');
    expect(curl).not.toContain('ya29.a0ARrdaM8secret999');
    expect(curl).toContain('[REDACTED_KEY]');
    expect(curl).not.toContain('AIzaSySecretKey999');
    expect(curl).toContain('Hello AI');
  });

  it('allows unmasked tokens when maskToken is false', () => {
    const entry: TrafficEntry = {
      id: 'tr-test-3',
      timestamp: Date.now(),
      method: 'POST',
      path: '/v1/chat/completions',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 200,
      latencyMs: 300,
      headers: {
        Authorization: 'Bearer test-live-token',
      },
    };

    const curl = generateCurlCommand(entry, { maskToken: false });
    expect(curl).toContain('Bearer test-live-token');
  });

  it('filters traffic entries by status category (2xx, 4xx, 5xx)', () => {
    const entries: TrafficEntry[] = [
      { id: '1', timestamp: 1, method: 'POST', path: '/a', targetModel: 'm1', translatedProvider: 'p1', statusCode: 200, latencyMs: 50 },
      { id: '2', timestamp: 2, method: 'POST', path: '/b', targetModel: 'm1', translatedProvider: 'p1', statusCode: 400, latencyMs: 50 },
      { id: '3', timestamp: 3, method: 'POST', path: '/c', targetModel: 'm1', translatedProvider: 'p1', statusCode: 429, latencyMs: 50 },
      { id: '4', timestamp: 4, method: 'POST', path: '/d', targetModel: 'm1', translatedProvider: 'p1', statusCode: 504, latencyMs: 50 },
    ];

    expect(filterByStatusCategory(entries, 'all')).toHaveLength(4);
    expect(filterByStatusCategory(entries, '2xx')).toHaveLength(1);
    expect(filterByStatusCategory(entries, '4xx')).toHaveLength(2);
    expect(filterByStatusCategory(entries, '5xx')).toHaveLength(1);
  });

  it('filters traffic entries by stepId and status category in engine', () => {
    const engine = new TrafficInspectorEngine();
    engine.logTraffic({
      method: 'POST',
      path: '/stream',
      targetModel: 'gemini-3.8-flash',
      translatedProvider: 'Google',
      statusCode: 200,
      latencyMs: 120,
      stepId: 'cortex-step-abc',
    });
    engine.logTraffic({
      method: 'POST',
      path: '/stream',
      targetModel: 'gemini-3.8-flash',
      translatedProvider: 'Google',
      statusCode: 504,
      latencyMs: 20000,
      stepId: 'cortex-step-xyz',
    });

    const stepFilter = engine.filterEntries('cortex-step-abc');
    expect(stepFilter).toHaveLength(1);
    expect(stepFilter[0].statusCode).toBe(200);

    const errorFilter = engine.filterEntries('', 'all', '5xx');
    expect(errorFilter).toHaveLength(1);
    expect(errorFilter[0].statusCode).toBe(504);
  });
});
