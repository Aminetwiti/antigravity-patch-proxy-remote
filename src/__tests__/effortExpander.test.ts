import { describe, it, expect } from 'vitest';
import { expandModelsWithEffort } from '../proxy/effortExpander';
import type { CustomModel } from '../proxy/types';

describe('expandModelsWithEffort', () => {
  it('expands reasoning-capable models into Low, Medium, High tiers', () => {
    const input: CustomModel[] = [
      {
        name: 'models/MODEL_PLACEHOLDER_1',
        displayName: 'Gemini 3.8 Flash',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-1',
        externalModelName: 'gemini-3.8-flash',
      },
    ];

    const expanded = expandModelsWithEffort(input);
    expect(expanded).toHaveLength(3);

    expect(expanded[0].displayName).toBe('Gemini 3.8 Flash (Low)');
    expect(expanded[0].reasoningEffort).toBe('low');
    expect(expanded[0].thinkingBudget).toBe(1000);
    expect(expanded[0]._effortSuffix).toBe('-low');

    expect(expanded[1].displayName).toBe('Gemini 3.8 Flash (Medium)');
    expect(expanded[1].reasoningEffort).toBe('medium');
    expect(expanded[1].thinkingBudget).toBe(4000);
    expect(expanded[1]._effortSuffix).toBe('-medium');

    expect(expanded[2].displayName).toBe('Gemini 3.8 Flash (High)');
    expect(expanded[2].reasoningEffort).toBe('high');
    expect(expanded[2].thinkingBudget).toBe(10001);
    expect(expanded[2]._effortSuffix).toBe('-high');
  });

  it('does not expand non-reasoning models', () => {
    const input: CustomModel[] = [
      {
        name: 'models/MODEL_PLACEHOLDER_GPT4O',
        displayName: 'GPT-4o',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        externalModelName: 'gpt-4o',
      },
    ];

    const expanded = expandModelsWithEffort(input);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].displayName).toBe('GPT-4o');
    expect(expanded[0]._effortSuffix).toBeUndefined();
  });

  it('does not re-expand already tiered models', () => {
    const input: CustomModel[] = [
      {
        name: 'models/MODEL_PLACEHOLDER_HIGH',
        displayName: 'Gemini 3.8 Flash (High)',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-1',
        externalModelName: 'gemini-3.8-flash-high',
      },
    ];

    const expanded = expandModelsWithEffort(input);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].displayName).toBe('Gemini 3.8 Flash (High)');
  });
});
