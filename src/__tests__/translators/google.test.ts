/**
 * google.ts translator unit tests.
 *
 * Key regression: when externalCascade calls mapGeminiToGoogle with the cascade
 * model name (e.g. "gemini-4-hydrogen"), the original body model (e.g. a
 * MODEL_PLACEHOLDER_ or "gemini-3.8-flash-medium") must NOT override it.
 */

import { describe, it, expect } from 'vitest';
import { mapGeminiToGoogle, toAiStudioModelId } from '../../proxy/translators/google';
import type { GeminiRequestBody } from '../../proxy/core/types';

// ── toAiStudioModelId ────────────────────────────────────────────────────────

describe('toAiStudioModelId', () => {
  it('strips -tiered suffix', () => {
    expect(toAiStudioModelId('gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash');
  });

  it('strips -high suffix', () => {
    expect(toAiStudioModelId('gemini-3.8-flash-high')).toBe('gemini-3.8-flash');
  });

  it('strips -medium and -low suffixes', () => {
    expect(toAiStudioModelId('gemini-3.8-flash-medium')).toBe('gemini-3.8-flash');
    expect(toAiStudioModelId('gemini-3.8-flash-low')).toBe('gemini-3.8-flash');
  });

  it('leaves clean model names untouched', () => {
    expect(toAiStudioModelId('gemini-4-hydrogen')).toBe('gemini-4-hydrogen');
    expect(toAiStudioModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash');
  });
});

// ── mapGeminiToGoogle — model resolution priority ────────────────────────────

describe('mapGeminiToGoogle — modelName takes precedence over body model', () => {
  it('uses caller-supplied modelName when body has a MODEL_PLACEHOLDER_', () => {
    const body = {
      model: 'MODEL_PLACEHOLDER_M401',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    } as unknown as GeminiRequestBody;

    const result = mapGeminiToGoogle(body, 'gemini-4-hydrogen') as Record<string, unknown>;
    // body.model should be overwritten with the cascade target, not the placeholder
    expect(result.model).toBe('gemini-4-hydrogen');
  });

  it('uses caller-supplied modelName when body has the original tiered model ID', () => {
    // Simulates the cascade scenario: pool exhausted on gemini-3.8-flash-tiered,
    // cascading to AI Studio with gemini-4-hydrogen as the target.
    const body = {
      model: 'gemini-3.8-flash-medium',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    } as unknown as GeminiRequestBody;

    const result = mapGeminiToGoogle(body, 'gemini-4-hydrogen') as Record<string, unknown>;
    expect(result.model).toBe('gemini-4-hydrogen');
  });

  it('uses caller-supplied modelName when body has a Cloud Code envelope with placeholder', () => {
    // Typical Cloud Code envelope: { model: "MODEL_PLACEHOLDER_...", request: { model: "...", contents: [] } }
    const body = {
      model: 'MODEL_PLACEHOLDER_M401',
      request: {
        model: 'MODEL_PLACEHOLDER_M401',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    } as unknown as GeminiRequestBody;

    const result = mapGeminiToGoogle(body, 'gemini-4-hydrogen') as Record<string, unknown>;
    expect(result.model).toBe('gemini-4-hydrogen');
  });

  it('falls back to body model when no modelName is supplied', () => {
    const body = {
      model: 'gemini-3.8-flash-tiered',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    } as unknown as GeminiRequestBody;

    const result = mapGeminiToGoogle(body, '') as Record<string, unknown>;
    // -tiered is stripped by toAiStudioModelId
    expect(result.model).toBe('gemini-3.8-flash');
  });

  it('strips Cloud Code internal fields from the output', () => {
    const body = {
      model: 'gemini-3.8-flash-tiered',
      request: {
        model: 'gemini-3.8-flash-tiered',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        project: 'some-project',
        enabledCreditTypes: ['GOOGLE_ONE_AI'],
        planModel: 'MODEL_PLACEHOLDER_M401',
      },
    } as unknown as GeminiRequestBody;

    const result = mapGeminiToGoogle(body, 'gemini-4-hydrogen') as Record<string, unknown>;
    expect(result.project).toBeUndefined();
    expect(result.enabledCreditTypes).toBeUndefined();
    expect(result.planModel).toBeUndefined();
    expect(result.request).toBeUndefined(); // envelope unwrapped
  });
});
