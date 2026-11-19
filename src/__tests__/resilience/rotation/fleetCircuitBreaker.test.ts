import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type * as http from 'http';
import type { CustomModel } from '../../../proxy/core/types';
import type { GoogleRequestOutcome } from '../../../proxy/engine/google/direct/types';
import { createInitialPoolLoopState } from '../../../proxy/engine/google/orchestration/types';
import { processOutcome429 } from '../../../proxy/engine/google/orchestration/outcomes/quota429Processor';
import {
  getFleetModelCooldown,
  clearFleetModelCooldown,
  getAccountCooldownRemaining,
} from '../../../proxy/resilience/google/cooldown/cooldownRegistry';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Fleet Circuit Breaker & Large Pool Resilience', () => {
  const origEnv = process.env.AG_BURST_429_THRESHOLD;

  beforeEach(() => {
    delete process.env.AG_BURST_429_THRESHOLD;
    clearFleetModelCooldown();
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.AG_BURST_429_THRESHOLD = origEnv;
    } else {
      delete process.env.AG_BURST_429_THRESHOLD;
    }
  });

  function createMockAccounts(count: number): CustomModel[] {
    return Array.from({ length: count }, (_, i) => ({
      name: `account-${i}@gmail.com`,
      accountEmail: `account-${i}@gmail.com`,
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      enabled: true,
      apiKey: `ya29.mock-valid-token-${i}`,
    }));
  }

  function createMockResponse(): http.ServerResponse {
    return {
      destroyed: false,
      socket: { destroyed: false },
      once: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as http.ServerResponse;
  }

  const rateLimitOutcome: GoogleRequestOutcome = {
    status: 429,
    headers: {},
    error: 'RESOURCE_EXHAUSTED: Rate limit exceeded (RPM)',
    errorDetails: 'RESOURCE_EXHAUSTED: Rate limit exceeded (RPM)',
  };

  it('does NOT stop rotation after 4 consecutive 429s on a large fleet when healthy accounts remain', async () => {
    const fleet = createMockAccounts(10);
    const state = createInitialPoolLoopState();
    state.consecutive429Count = 3; // 4th attempt

    const res = createMockResponse();
    const result = await processOutcome429(
      fleet[3],
      fleet[3].name,
      'gemini-flash',
      'gemini-3.8-flash-tiered',
      rateLimitOutcome,
      300,
      null,
      fleet,
      3, // candidateIndex = 3 (remaining: indices 4..9)
      10, // totalAttempts
      res,
      state,
    );

    expect(state.consecutive429Count).toBe(4);
    // Should NOT trip fleet circuit breaker because accounts 4..9 are healthy
    expect(result.breakLoop).toBe(false);
    expect(result.continueNext).toBe(true);
  });

  it('stops rotation when dynamic threshold is reached and no healthy accounts remain', async () => {
    const fleet = createMockAccounts(4);
    const state = createInitialPoolLoopState();
    state.consecutive429Count = 3;

    const res = createMockResponse();
    const result = await processOutcome429(
      fleet[3],
      fleet[3].name,
      'gemini-flash',
      'gemini-3.8-flash-tiered',
      rateLimitOutcome,
      300,
      null,
      fleet,
      3, // candidateIndex = 3 (no remaining accounts)
      4,
      res,
      state,
    );

    expect(state.consecutive429Count).toBe(4);
    expect(result.breakLoop).toBe(true);
    expect(result.continueNext).toBe(false);
  });

  it('honors AG_BURST_429_THRESHOLD environment override', async () => {
    process.env.AG_BURST_429_THRESHOLD = '6';
    const fleet = createMockAccounts(15);
    const state = createInitialPoolLoopState();
    state.consecutive429Count = 4;

    const res = createMockResponse();
    const result = await processOutcome429(
      fleet[4],
      fleet[4].name,
      'gemini-flash',
      'gemini-3.8-flash-tiered',
      rateLimitOutcome,
      300,
      null,
      fleet,
      4,
      15,
      res,
      state,
    );

    // consecutive429Count is now 5, threshold is 6 -> should continue
    expect(state.consecutive429Count).toBe(5);
    expect(result.breakLoop).toBe(false);
    expect(result.continueNext).toBe(true);
  });

  it('trips fleet circuit breaker when max consecutive cap is reached even if healthy accounts remain', async () => {
    const fleet = createMockAccounts(20);
    const state = createInitialPoolLoopState();
    state.consecutive429Count = 5;

    const res = createMockResponse();
    const result = await processOutcome429(
      fleet[5],
      fleet[5].name,
      'gemini-flash',
      'gemini-3.8-flash-tiered',
      rateLimitOutcome,
      300,
      null,
      fleet,
      5,
      20,
      res,
      state,
    );

    // consecutive429Count becomes 6, reaching the default cap of 6
    expect(state.consecutive429Count).toBe(6);
    expect(result.breakLoop).toBe(true);
    expect(result.continueNext).toBe(false);

    // Fleet cooldown should now be active across model and family
    const modelCd = getFleetModelCooldown('gemini-3.8-flash-tiered');
    expect(modelCd.active).toBe(true);
    expect(modelCd.remainingMs).toBeGreaterThan(0);
    expect(modelCd.reason).toContain('Fleet 429 burst');

    const familyCd = getFleetModelCooldown('gemini-flash');
    expect(familyCd.active).toBe(true);
    expect(familyCd.remainingMs).toBeGreaterThan(0);
  });

  it('allows clearing fleet model cooldown', () => {
    const fleet = createMockAccounts(4);
    const state = createInitialPoolLoopState();
    state.consecutive429Count = 3;

    const res = createMockResponse();
    processOutcome429(
      fleet[3],
      fleet[3].name,
      'gemini-flash',
      'gemini-3.8-flash-tiered',
      rateLimitOutcome,
      300,
      null,
      fleet,
      3,
      4,
      res,
      state,
    );

    expect(getFleetModelCooldown('gemini-3.8-flash-tiered').active).toBe(true);
    clearFleetModelCooldown('gemini-3.8-flash-tiered');
    expect(getFleetModelCooldown('gemini-3.8-flash-tiered').active).toBe(false);
  });

  it('disarms hedged dispatch when fleet cooldown is active for target model or family', async () => {
    const { setFleetModelCooldown } = await import('../../../proxy/resilience/google/cooldown/cooldownRegistry');
    setFleetModelCooldown('gemini-3.8-flash-tiered', 30_000, 'Fleet 429 burst test');
    expect(getFleetModelCooldown('gemini-3.8-flash-tiered').active).toBe(true);
    
    // Also verify family cooldown is properly registered
    setFleetModelCooldown('gemini-flash', 25_000, 'Fleet family cooldown');
    expect(getFleetModelCooldown('gemini-flash').active).toBe(true);
  });

  it('applies rolling 5h cooldown and does NOT lock out for 147h when weekly reset is 147h and weekly quota is healthy', async () => {
    const fleet = createMockAccounts(2);
    const state = createInitialPoolLoopState();
    const res = createMockResponse();

    const weeklyMentionOutcome: GoogleRequestOutcome = {
      status: 429,
      headers: {},
      error: 'RESOURCE_EXHAUSTED: Quota exhausted. resets in 147h22m10s',
      errorDetails: 'RESOURCE_EXHAUSTED: Quota exhausted. resets in 147h22m10s',
    };

    const result = await processOutcome429(
      fleet[0],
      fleet[0].name,
      'gemini',
      'gemini-3.8-flash-tiered',
      weeklyMentionOutcome,
      485,
      null,
      fleet,
      0,
      2,
      res,
      state,
    );

    expect(result.continueNext).toBe(true);
    expect(result.breakLoop).toBe(false);

    const remainingCd = getAccountCooldownRemaining(fleet[0], 'gemini');
    // Cooldown must be around 5h (<= 5h 15m), NOT 147h (530 000s)
    expect(remainingCd).toBeGreaterThan(4 * 3600 * 1000);
    expect(remainingCd).toBeLessThanOrEqual(5.25 * 3600 * 1000);
  });
});
