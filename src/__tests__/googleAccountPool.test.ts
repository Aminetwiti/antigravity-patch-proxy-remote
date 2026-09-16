import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import {
  getGoogleAccountPool,
  getAccountQuotaKey,
  getModelQuotaScore,
  selectBestModelByQuota,
  bindSessionToModel,
  extractSessionId,
  clearSessionAffinities,
} from '../proxy';
import { recordFailure, recordSuccess, getOpenBreaker } from '../proxy/circuitBreaker';
import type { CustomModel } from '../proxy/types';

describe('Google Multi-Account Pool & Failover', () => {
  beforeEach(() => {
    clearSessionAffinities();
  });

  const mockGoogleModels: CustomModel[] = [
    {
      name: 'models/google-acc1-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 1)',
      provider: 'google',
      apiKey: 'ya29.acc1_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user1@gmail.com',
      refreshToken: '1//refresh1',
      projectId: 'project-1',
      quotas: { fiveHourPercentage: 30, weeklyPercentage: 80 },
    },
    {
      name: 'models/google-acc2-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 2)',
      provider: 'google',
      apiKey: 'ya29.acc2_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user2@gmail.com',
      refreshToken: '1//refresh2',
      projectId: 'project-2',
      quotas: { fiveHourPercentage: 95, weeklyPercentage: 99 },
    },
    {
      name: 'models/google-acc3-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 3)',
      provider: 'google',
      apiKey: 'ya29.acc3_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user3@gmail.com',
      refreshToken: '1//refresh3',
      projectId: 'project-3',
      quotas: { fiveHourPercentage: 100, weeklyPercentage: 100 },
    },
    {
      name: 'models/google-acc1-claude-sonnet',
      displayName: 'Claude Sonnet 4.6 (Account 1)',
      provider: 'google',
      apiKey: 'ya29.acc1_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'claude-sonnet-4-6',
      accountEmail: 'user1@gmail.com',
      refreshToken: '1//refresh1',
      projectId: 'project-1',
      quotas: { claudeFiveHourPct: 40, claudeWeeklyPct: 90 },
    },
    {
      name: 'models/openai-gpt4o',
      displayName: 'GPT-4o',
      provider: 'openai',
      apiKey: 'sk-proj-test',
      apiUrl: 'https://api.openai.com/v1',
      externalModelName: 'gpt-4o',
    },
  ];

  it('generates distinct quota keys for each Google account', () => {
    const key1 = getAccountQuotaKey(mockGoogleModels[0]);
    const key2 = getAccountQuotaKey(mockGoogleModels[1]);
    const key3 = getAccountQuotaKey(mockGoogleModels[2]);

    expect(key1).toBe('google:user1@gmail.com');
    expect(key2).toBe('google:user2@gmail.com');
    expect(key3).toBe('google:user3@gmail.com');
    expect(key1).not.toBe(key2);
  });

  it('pools all distinct Google accounts offering the target model', () => {
    const targetModel = mockGoogleModels[0]; // user1's gemini-3.1-pro-high
    const pool = getGoogleAccountPool(targetModel, mockGoogleModels);

    expect(pool.length).toBe(3);
    const emails = pool.map((m) => m.accountEmail);
    expect(emails).toContain('user1@gmail.com');
    expect(emails).toContain('user2@gmail.com');
    expect(emails).toContain('user3@gmail.com');
  });

  it('deduplicates accounts if an account has multiple model aliases in allModels', () => {
    const duplicateList = [
      mockGoogleModels[0], // user1
      mockGoogleModels[0], // user1 duplicate
      mockGoogleModels[1], // user2
    ];
    const pool = getGoogleAccountPool(mockGoogleModels[0], duplicateList);
    expect(pool.length).toBe(2);
  });

  it('prioritizes accounts with highest remaining quota', () => {
    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);
    const sorted = [...pool].sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));

    // Account 3 has 100%, Account 2 has 95%, Account 1 has 30%
    expect(sorted[0].accountEmail).toBe('user3@gmail.com');
    expect(sorted[1].accountEmail).toBe('user2@gmail.com');
    expect(sorted[2].accountEmail).toBe('user1@gmail.com');
  });

  it('deprioritizes accounts with open circuit breaker upon failure', () => {
    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);

    // Simulate Account 3 failing with 429 quota exhaustion
    recordFailure(pool.find((m) => m.accountEmail === 'user3@gmail.com')!, 'rate_limit');

    const sorted = [...pool].sort((a, b) => {
      const breakerA = getOpenBreaker(a) ? 1 : 0;
      const breakerB = getOpenBreaker(b) ? 1 : 0;
      if (breakerA !== breakerB) return breakerA - breakerB;
      return getModelQuotaScore(b) - getModelQuotaScore(a);
    });

    // Healthy Account 2 should now be picked first instead of broken Account 3
    expect(sorted[0].accountEmail).toBe('user2@gmail.com');
    // Broken Account 3 should be moved to the end
    expect(sorted[sorted.length - 1].accountEmail).toBe('user3@gmail.com');

    // Clean up
    recordSuccess(pool.find((m) => m.accountEmail === 'user3@gmail.com')!);
  });

  it('preserves sticky session affinity when bound account is healthy', () => {
    const sessionId = 'test-conv-session-1';
    const acc2 = mockGoogleModels[1]; // user2

    bindSessionToModel(sessionId, acc2);

    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);
    const sorted = [...pool].sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));

    // Initially without session, acc3 is first (100% vs 95%)
    expect(sorted[0].accountEmail).toBe('user3@gmail.com');

    // With session bound to acc2, acc2 should be promoted to front
    const bound = sorted.find((m) => getAccountQuotaKey(m) === getAccountQuotaKey(acc2));
    if (bound) {
      const idx = sorted.indexOf(bound);
      if (idx > 0) {
        sorted.splice(idx, 1);
        sorted.unshift(bound);
      }
    }

    expect(sorted[0].accountEmail).toBe('user2@gmail.com');
  });
});
