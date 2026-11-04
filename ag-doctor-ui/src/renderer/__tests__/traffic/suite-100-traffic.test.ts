import { describe, expect, it } from 'vitest';
import { TrafficInspectorEngine, TrafficEntry } from '../../../renderer/services/monitoring/traffic-inspector';

describe('Traffic Inspector - Export, Retry & Filter Matrix', () => {
  describe('Traffic Log Export JSON & Schema Validation', () => {
    const exportScenarios = [
      { method: 'POST', path: '/v1/models/custom-model-1', model: 'model-1', prov: 'OpenAI', status: 200, latency: 92 },
      { method: 'GET', path: '/v1/models/custom-model-2', model: 'model-2', prov: 'Anthropic', status: 250, latency: 104 },
      { method: 'POST', path: '/v1/models/custom-model-3', model: 'model-3', prov: 'Gemini', status: 300, latency: 116 },
      { method: 'POST', path: '/v1/models/custom-model-5', model: 'model-5', prov: 'Anthropic', status: 400, latency: 140 },
    ];

    it.each(exportScenarios)(
      'serializes and validates traffic entry export payload ($method $path)',
      ({ method, path, model, prov, status, latency }) => {
        const engine = new TrafficInspectorEngine();
        const entry = engine.logTraffic({
          method,
          path,
          targetModel: model,
          translatedProvider: prov,
          statusCode: status,
          latencyMs: latency,
          requestPayload: JSON.stringify({ prompt: `test prompt ${model}` }),
          responsePayload: JSON.stringify({ output: `response payload ${model}` }),
        });

        const entries = engine.getEntries();
        expect(entries).toHaveLength(1);

        const exportedJson = JSON.stringify(entries, null, 2);
        const parsed = JSON.parse(exportedJson) as TrafficEntry[];
        expect(parsed).toHaveLength(1);
        expect(parsed[0].id).toBe(entry.id);
        expect(parsed[0].statusCode).toBe(status);
        expect(parsed[0].requestPayload).toContain(`test prompt ${model}`);
      },
    );
  });

  describe('Auto-Retry Execution & Backoff Handling', () => {
    it.each([
      { expectedStatus: 200, label: 'successful recovery' },
      { expectedStatus: 500, label: 'upstream failure persists' },
    ])('executes retry attempt and logs replayed outcome ($label)', async ({ expectedStatus }) => {
      const engine = new TrafficInspectorEngine();

      const original = engine.logTraffic({
        method: 'POST',
        path: '/v1/chat/completions/retry-test',
        targetModel: 'model-retry',
        translatedProvider: 'OpenAI',
        statusCode: 429,
        latencyMs: 200,
        requestPayload: JSON.stringify({ prompt: 'test' }),
      });

      const replayed = await engine.replayEntry(original.id, async (e) => {
        expect(e.id).toBe(original.id);
        return {
          statusCode: expectedStatus,
          latencyMs: 150,
        };
      });

      expect(replayed).not.toBeNull();
      expect(replayed?.path).toContain('(Replayed)');
      expect(replayed?.statusCode).toBe(expectedStatus);

      const allEntries = engine.getEntries();
      expect(allEntries).toHaveLength(2);
      expect(allEntries[0].id).toBe(replayed?.id);
    });
  });

  describe('Provider & Query Filter Matrix', () => {
    function createTestEngine(): TrafficInspectorEngine {
      const eng = new TrafficInspectorEngine();
      const dataset = [
        { prov: 'OpenAI', path: '/api/v1/endpoint', status: 200 },
        { prov: 'Anthropic', path: '/api/v2/endpoint', status: 200 },
        { prov: 'Gemini', path: '/api/v3/endpoint', status: 500 },
        { prov: 'Groq', path: '/api/v4/endpoint', status: 200 },
        { prov: 'OpenRouter', path: '/api/v5/endpoint', status: 200 },
      ];
      dataset.forEach((item, idx) => {
        eng.logTraffic({
          method: idx % 2 === 0 ? 'POST' : 'GET',
          path: item.path,
          targetModel: `model-${idx}`,
          translatedProvider: item.prov,
          statusCode: item.status,
          latencyMs: 50,
        });
      });
      return eng;
    }

    it.each(['OpenAI', 'Anthropic', 'Gemini', 'Groq', 'OpenRouter'])(
      'filters correctly by provider %s',
      (prov) => {
        const engine = createTestEngine();
        const filtered = engine.filterEntries('', prov);
        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every((e) => e.translatedProvider.toLowerCase() === prov.toLowerCase())).toBe(true);
      },
    );

    it.each([
      { query: '/api/v1/endpoint', expectedCount: 1 },
      { query: '/api/', expectedCount: 5 },
      { query: 'non-existent', expectedCount: 0 },
    ])('filters correctly by query string: "$query"', ({ query, expectedCount }) => {
      const engine = createTestEngine();
      const matches = engine.filterEntries(query, 'all');
      expect(matches).toHaveLength(expectedCount);
    });
  });
});
