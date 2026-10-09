import { describe, it, expect } from 'vitest';
import {
  cleanToolParametersJsonSchema,
  sanitizeCloudCodeTools,
  applyAntiTruncation,
  extractSyntheticToolContent,
  SYNTHETIC_TOOL_NAME,
} from '../services/googleAuth';
import { parseDurationMs, parseRetryDelayFromError } from '../proxy/retryStrategy';

describe('gcli2api Inspired Enhancements', () => {
  describe('Recommendation 2: Tool JSON Schema Sanitization', () => {
    it('flattens allOf into properties and merged required fields', () => {
      const rawSchema = {
        type: 'object',
        allOf: [
          {
            type: 'object',
            properties: {
              foo: { type: 'string' },
            },
            required: ['foo'],
          },
          {
            type: 'object',
            properties: {
              bar: { type: 'number' },
            },
            required: ['bar'],
          },
        ],
      };

      const cleaned = cleanToolParametersJsonSchema(rawSchema);
      expect(cleaned.allOf).toBeUndefined();
      expect(cleaned.properties.foo).toEqual({ type: 'string' });
      expect(cleaned.properties.bar).toEqual({ type: 'number' });
      expect(cleaned.required).toEqual(['foo', 'bar']);
    });

    it('normalizes anyOf/oneOf and removes nullable: true', () => {
      const rawSchema = {
        type: 'object',
        properties: {
          tag: {
            anyOf: [
              { type: 'string', description: 'tag name' },
              { type: 'null' },
            ],
          },
          age: {
            type: ['integer', 'null'],
            nullable: true,
          },
        },
      };

      const cleaned = cleanToolParametersJsonSchema(rawSchema);
      expect(cleaned.properties.tag.type).toBe('string');
      expect(cleaned.properties.tag.anyOf).toBeUndefined();
      expect(cleaned.properties.tag.description).toContain('(nullable)');
      expect(cleaned.properties.age.type).toBe('integer');
      expect(cleaned.properties.age.nullable).toBeUndefined();
      expect(cleaned.properties.age.description).toContain('(nullable)');
    });

    it('handles circular references gracefully', () => {
      const circular: any = { type: 'object', properties: {} };
      circular.properties.self = circular;

      const cleaned = cleanToolParametersJsonSchema(circular);
      expect(cleaned.properties.self.description).toBe('circular reference');
    });

    it('sanitizes tools in reqObj', () => {
      const reqObj = {
        tools: [
          {
            functionDeclarations: [
              {
                name: 'test_fn',
                parameters: {
                  allOf: [{ properties: { id: { type: 'string' } } }],
                },
              },
            ],
          },
        ],
      };

      sanitizeCloudCodeTools(reqObj);
      expect(reqObj.tools[0].functionDeclarations[0].parameters.allOf).toBeUndefined();
      expect(reqObj.tools[0].functionDeclarations[0].parameters.properties.id).toEqual({ type: 'string' });
    });
  });

  describe('Recommendation 3: Enhanced 429 & Cooldown Extraction', () => {
    it('parses days and compound durations', () => {
      expect(parseDurationMs('1d')).toBe(86400000);
      expect(parseDurationMs('6d 12h')).toBe(6 * 86400000 + 12 * 3600000);
      expect(parseDurationMs('154h21m14s')).toBe((154 * 3600 + 21 * 60 + 14) * 1000);
    });

    it('extracts delay from quotaResetTimeStamp ISO date', () => {
      const futureDate = new Date(Date.now() + 65000).toISOString();
      const errObj = {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              metadata: {
                quotaResetTimeStamp: futureDate,
              },
            },
          ],
        },
      };

      const delay = parseRetryDelayFromError(errObj);
      expect(delay).toBeGreaterThan(60000);
      expect(delay).toBeLessThanOrEqual(66000);
    });

    it('extracts delay from natural language messages in 429 errors', () => {
      const textErr = 'You have exhausted your capacity. Your quota will reset after 6m 30s.';
      const delay = parseRetryDelayFromError(textErr);
      expect(delay).toBe((6 * 60 + 30) * 1000);

      const resetsInErr = 'Rate limit exceeded. Resets in 45s.';
      expect(parseRetryDelayFromError(resetsInErr)).toBe(45000);
    });
  });

  describe('Recommendation 5: Anti-Truncation (Synthetic Tool Call)', () => {
    it('injects emit_answer tool and system instructions', () => {
      const payload: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: 'Write a long program' }] }],
      };

      applyAntiTruncation(payload);

      const tools = payload.tools as any[];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0].functionDeclarations[0].name).toBe(SYNTHETIC_TOOL_NAME);

      const sysInst = payload.systemInstruction as any;
      expect(sysInst.parts[0].text).toContain(SYNTHETIC_TOOL_NAME);
    });

    it('extracts synthetic tool content back to text', () => {
      const responseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: SYNTHETIC_TOOL_NAME,
                    args: {
                      content: 'Here is the full non-truncated output.',
                    },
                  },
                },
              ],
            },
          },
        ],
      };

      const text = extractSyntheticToolContent(responseData);
      expect(text).toBe('Here is the full non-truncated output.');
    });
  });
});
