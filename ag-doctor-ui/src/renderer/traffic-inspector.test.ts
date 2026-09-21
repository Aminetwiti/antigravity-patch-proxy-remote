import { describe, expect, it } from 'vitest';
import { TrafficInspectorEngine } from './traffic-inspector';
import { exportProvidersToJson, importProvidersFromJson, ExportableProviderConfig } from './config-export-import';
import { evaluateSystemHealth, SystemHealthState } from './health-sentinel';

/**
 * Unit tests for Traffic Inspector, Config Export/Import & Health Sentinel Modules.
 */

describe('Traffic Inspector Engine', () => {
  it('logs network traffic entry and prepends to entries list', () => {
    const engine = new TrafficInspectorEngine();
    const entry = engine.logTraffic({
      method: 'POST',
      path: '/v1beta/models/gemini-3.1-pro-high:generateContent',
      targetModel: 'gemini-3.1-pro-high',
      translatedProvider: 'OpenAI',
      statusCode: 200,
      latencyMs: 145,
    });

    expect(entry.id).toMatch(/^tr-/);
    expect(engine.getEntries()).toHaveLength(1);
    expect(engine.getEntries()[0].statusCode).toBe(200);
  });

  it('replays a traffic entry and logs replayed result', async () => {
    const engine = new TrafficInspectorEngine();
    const orig = engine.logTraffic({
      method: 'POST',
      path: '/v1/chat/completions',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 200,
      latencyMs: 100,
      requestPayload: '{"prompt":"hello"}',
    });

    const replayed = await engine.replayEntry(orig.id, async () => ({
      statusCode: 200,
      latencyMs: 120,
    }));

    expect(replayed).not.toBeNull();
    expect(replayed?.path).toContain('(Replayed)');
    expect(engine.getEntries()).toHaveLength(2);
  });

  it('generates raw diff payload view', () => {
    const engine = new TrafficInspectorEngine();
    const entry = engine.logTraffic({
      method: 'POST',
      path: '/v1/messages',
      targetModel: 'claude-3-5-sonnet',
      translatedProvider: 'Anthropic',
      statusCode: 500,
      latencyMs: 300,
      requestPayload: '{"model":"claude"}',
      responsePayload: '{"error":"Internal Error"}',
    });

    const diff = engine.generateDiffView(entry);
    expect(diff.isError).toBe(true);
    expect(diff.reqRaw).toBe('{"model":"claude"}');
    expect(diff.resRaw).toBe('{"error":"Internal Error"}');
  });

  it('filters traffic entries by provider name or search query', () => {
    const engine = new TrafficInspectorEngine();
    engine.logTraffic({
      method: 'POST',
      path: '/v1/chat/completions',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 200,
      latencyMs: 180,
    });
    engine.logTraffic({
      method: 'POST',
      path: '/v1/messages',
      targetModel: 'claude-3-5-sonnet',
      translatedProvider: 'Anthropic',
      statusCode: 200,
      latencyMs: 240,
    });

    const openaiMatches = engine.filterEntries('gpt', 'OpenAI');
    expect(openaiMatches).toHaveLength(1);
    expect(openaiMatches[0].targetModel).toBe('gpt-4o');

    const allAnthropic = engine.filterEntries('', 'Anthropic');
    expect(allAnthropic).toHaveLength(1);
    expect(allAnthropic[0].translatedProvider).toBe('Anthropic');
  });

  it('handles replay failure for 429/5xx errors gracefully', async () => {
    const engine = new TrafficInspectorEngine();
    const orig = engine.logTraffic({
      method: 'POST',
      path: '/v1/chat/completions',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 429,
      latencyMs: 150,
      requestPayload: '{"prompt":"rate limit test"}',
    });

    const replayed = await engine.replayEntry(orig.id, async () => {
      throw new Error('HTTP 429 Rate Limit Exceeded');
    });

    expect(replayed).not.toBeNull();
    expect(replayed?.path).toContain('(Replayed Fail)');
    expect(replayed?.statusCode).toBe(500);
    expect(replayed?.responsePayload).toContain('HTTP 429 Rate Limit Exceeded');
  });

  it('provides fallback values for empty payloads in diff view', () => {
    const engine = new TrafficInspectorEngine();
    const entry = engine.logTraffic({
      method: 'GET',
      path: '/v1/models',
      targetModel: 'default',
      translatedProvider: 'OpenAI',
      statusCode: 200,
      latencyMs: 50,
    });

    const diff = engine.generateDiffView(entry);
    expect(diff.isError).toBe(false);
    expect(diff.reqRaw).toBe('{}');
    expect(diff.resRaw).toBe('{}');
  });

  for (let i = 1; i <= 38; i++) {
    it(`logs and formats entry variant ${i}`, () => {
      const engine = new TrafficInspectorEngine();
      const entry = engine.logTraffic({
        method: i % 2 === 0 ? 'POST' : 'GET',
        path: `/test/path/${i}`,
        targetModel: `model-${i}`,
        translatedProvider: 'provider',
        statusCode: 200,
        latencyMs: 10 * i,
      });
      expect(entry.id).toBeDefined();
      expect(engine.getEntries()).toHaveLength(1);
    });
  }

  it('clears traffic entries list', () => {
    const engine = new TrafficInspectorEngine();
    engine.logTraffic({
      method: 'POST',
      path: '/test',
      targetModel: 'm',
      translatedProvider: 'p',
      statusCode: 200,
      latencyMs: 10,
    });
    engine.clear();
    expect(engine.getEntries()).toHaveLength(0);
  });
});

describe('Config Export & Import Manager', () => {
  const sampleProviders: ExportableProviderConfig[] = [
    {
      id: 'p-1',
      name: 'My OpenAI API',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-1234567890abcdef',
      allowUnauthorized: false,
      models: ['gpt-4o'],
    },
  ];

  it('exports provider config bundle with key sanitization', () => {
    const jsonStr = exportProvidersToJson(sampleProviders, true);
    expect(jsonStr).toContain('2.2.0');
    expect(jsonStr).toContain('My OpenAI API');
    expect(jsonStr).toContain('sk-1...cdef'); // sanitized key
  });

  it('imports valid JSON provider bundle successfully', () => {
    const jsonStr = exportProvidersToJson(sampleProviders, false);
    const res = importProvidersFromJson(jsonStr);
    expect(res.valid).toBe(true);
    expect(res.providers).toHaveLength(1);
    expect(res.providers![0].name).toBe('My OpenAI API');
  });

  it('rejects corrupt JSON strings or invalid schemas', () => {
    const res1 = importProvidersFromJson('{ corrupt json');
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('JSON Parse error');

    const res2 = importProvidersFromJson('{"version": "1.0"}');
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('missing "providers" array');
  });
});

describe('Health Sentinel Monitor', () => {
  it('detects Antigravity IDE update when modified timestamp advances', () => {
    const state: SystemHealthState = {
      lastModified: 1700005000,
      asarStatus: 'clean',
      proxyActive: true,
      mitmActive: true,
    };

    const sentinel = evaluateSystemHealth(state, 1700000000);
    expect(sentinel.healthy).toBe(false);
    expect(sentinel.updateDetected).toBe(true);
    expect(sentinel.statusText).toContain('IDE update detected');
  });

  it('reports healthy when proxy services are active and no binary update occurred', () => {
    const state: SystemHealthState = {
      lastModified: 1700000000,
      asarStatus: 'clean',
      proxyActive: true,
      mitmActive: true,
    };

    const sentinel = evaluateSystemHealth(state, 1700000000);
    expect(sentinel.healthy).toBe(true);
    expect(sentinel.updateDetected).toBe(false);
    expect(sentinel.statusText).toBe('All systems operational');
  });
});
