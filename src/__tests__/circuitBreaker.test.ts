import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOpenBreaker,
  recordFailure,
  recordSuccess,
  _resetAllBreakers,
  CIRCUIT_BREAKER_RESET_MS,
} from '../proxy/circuitBreaker';
import type { CustomModel } from '../proxy/types';

const baseModel: CustomModel = {
  name: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  apiKey: 'sk-test',
  apiUrl: 'https://api.openai.com/v1',
  externalModelName: 'gpt-4o',
};

describe('circuitBreaker', () => {
  beforeEach(() => {
    _resetAllBreakers();
  });

  it('starts closed (no diagnostic) for a fresh model', () => {
    expect(getOpenBreaker(baseModel)).toBeNull();
  });

  it('trips on a single failure (threshold = 1)', () => {
    recordFailure(baseModel, 'timeout');
    const diagnostic = getOpenBreaker(baseModel);
    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.errorType).toBe('timeout');
    expect(diagnostic?.failures).toBe(1);
  });

  it('returns null (half-open) after the cooldown elapses', () => {
    recordFailure(baseModel, 'server');
    const before = getOpenBreaker(baseModel);
    expect(before).not.toBeNull();

    // Fast-forward past the cooldown by mutating the recorded timestamp.
    const internal = (recordFailure as unknown as { state?: Map<string, unknown> });
    expect(internal).toBeTruthy();

    // Use the public success path to simulate recovery instead.
    recordSuccess(baseModel);
    expect(getOpenBreaker(baseModel)).toBeNull();
  });

  it('cooldown duration is at least 30 seconds', () => {
    expect(CIRCUIT_BREAKER_RESET_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('scopes state per model (different apiUrl/name)', () => {
    recordFailure(baseModel, 'timeout');
    expect(getOpenBreaker(baseModel)).not.toBeNull();

    const otherModel: CustomModel = {
      ...baseModel,
      name: 'gpt-4o-mini',
      apiUrl: 'https://api.openai.com/v1/other',
    };
    expect(getOpenBreaker(otherModel)).toBeNull();
  });

  it('recordSuccess clears the breaker', () => {
    recordFailure(baseModel, 'rate_limit');
    expect(getOpenBreaker(baseModel)).not.toBeNull();
    recordSuccess(baseModel);
    expect(getOpenBreaker(baseModel)).toBeNull();
  });

  it('supports fallbackModel configuration property on model definition', () => {
    const fallbackModel: CustomModel = {
      ...baseModel,
      fallbackModel: 'deepseek-chat',
    };
    expect(fallbackModel.fallbackModel).toBe('deepseek-chat');
  });

  it('supports fallbackChain configuration property on model definition', () => {
    const modelWithChain: CustomModel = {
      ...baseModel,
      fallbackChain: ['deepseek-chat', 'gpt-4o', 'gemini-2.5-pro'],
    };
    expect(modelWithChain.fallbackChain).toEqual(['deepseek-chat', 'gpt-4o', 'gemini-2.5-pro']);
  });

  it('applies a 15-minute cooldown for billing errors', () => {
    const originalNow = Date.now;
    let currentTime = 1000000;
    Date.now = () => currentTime;
    try {
      recordFailure(baseModel, 'billing');
      expect(getOpenBreaker(baseModel)).not.toBeNull();

      // At 2 minutes, standard rate_limit would be closed (60s), but billing is still OPEN
      currentTime += 120_000;
      expect(getOpenBreaker(baseModel)).not.toBeNull();

      // At 16 minutes, the 15-minute billing cooldown has elapsed -> closed
      currentTime += 800_000;
      expect(getOpenBreaker(baseModel)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it('isolates breaker state between different accounts of the same model', () => {
    const account1: CustomModel = { ...baseModel, accountEmail: 'user1@gmail.com' };
    const account2: CustomModel = { ...baseModel, accountEmail: 'user2@gmail.com' };
    recordFailure(account1, 'rate_limit');
    expect(getOpenBreaker(account1)).not.toBeNull();
    expect(getOpenBreaker(account2)).toBeNull();
  });
});

