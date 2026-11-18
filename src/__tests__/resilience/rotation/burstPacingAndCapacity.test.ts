import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as http from 'http';
import type { CustomModel } from '../../../proxy/core/types';
import { computeCandidateHeaderTimeout } from '../../../proxy/engine/google/preparation/timeoutCalculator';
import { processOutcomeCapacityOrTimeout } from '../../../proxy/engine/google/orchestration/outcomes/capacityTimeoutProcessor';
import { createInitialPoolLoopState } from '../../../proxy/engine/google/orchestration/types';

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

describe('Burst Pacing, 503 Capacity Threshold & Flash Thinking Timeout Calibration', () => {
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

  describe('computeCandidateHeaderTimeout calibration', () => {
    it('caps Flash Thinking large payload timeout to 60s when healthy sibling accounts exist', () => {
      const largePayload = Buffer.alloc(200_000); // 200 KB
      const result = computeCandidateHeaderTimeout({
        targetModel: 'gemini-3.8-flash-tiered',
        updatedBody: largePayload,
        reqJson: { requestedModel: 'gemini-3.8-flash-tiered' },
        targetRaw: 'gemini-3.8-flash-tiered',
        hasOtherCandidates: true,
        healthySiblingAccountsCount: 3,
        consecutive504TimeoutCount: 0,
        poolLoopStartTime: Date.now(),
        initialHealthyCount: 4,
        attemptIndex: 0,
      });

      expect(result.isFlashModel).toBe(true);
      expect(result.isThinkingModel).toBe(true);
      expect(result.isLargePayload).toBe(true);
      // Large timeout for Flash Thinking with healthy siblings is capped at 60s
      expect(result.poolHeaderTimeout).toBeLessThanOrEqual(60_000);
      expect(result.poolHeaderTimeout).toBeGreaterThanOrEqual(50_000);
    });

    it('caps Flash Thinking timeout to 70s when no other candidate exists (avoiding 80s/85s hang)', () => {
      const massivePayload = Buffer.alloc(250_000); // 250 KB
      const result = computeCandidateHeaderTimeout({
        targetModel: 'gemini-3.8-flash-tiered',
        updatedBody: massivePayload,
        reqJson: { requestedModel: 'gemini-3.8-flash-tiered' },
        targetRaw: 'gemini-3.8-flash-tiered',
        hasOtherCandidates: false,
        healthySiblingAccountsCount: 0,
        consecutive504TimeoutCount: 0,
        poolLoopStartTime: Date.now(),
        initialHealthyCount: 1,
        attemptIndex: 0,
      });

      expect(result.isFlashModel).toBe(true);
      expect(result.poolHeaderTimeout).toBeLessThanOrEqual(70_000);
    });
  });

  describe('processOutcomeCapacityOrTimeout calibration', () => {
    it('triggers global cascade at threshold 7 on a 20-account pool instead of waiting for 10', async () => {
      const fleet = createMockAccounts(20);
      const state = createInitialPoolLoopState();
      state.lastStatus = 503;
      state.lastErrorText = 'MODEL_CAPACITY_EXHAUSTED';

      // 6 consecutive 503s should NOT yet trigger breakLoop
      for (let i = 0; i < 6; i++) {
        const res = await processOutcomeCapacityOrTimeout(
          fleet[i],
          fleet[i].name,
          'gemini-flash',
          'gemini-3.8-flash-tiered',
          500,
          null,
          fleet,
          i,
          false,
          true,
          true,
          60_000,
          60_000,
          undefined,
          {},
          state,
        );
        expect(res.breakLoop).toBe(false);
      }

      expect(state.consecutive503CapacityCount).toBe(6);

      // The 7th 503 triggers the cascade!
      const finalRes = await processOutcomeCapacityOrTimeout(
        fleet[6],
        fleet[6].name,
        'gemini-flash',
        'gemini-3.8-flash-tiered',
        500,
        null,
        fleet,
        6,
        false,
        true,
        true,
        60_000,
        60_000,
        undefined,
        {},
        state,
      );

      expect(state.consecutive503CapacityCount).toBe(7);
      expect(finalRes.breakLoop).toBe(true);
      expect(state.lastStatus).toBe(503);
      expect(state.lastErrorText).toContain('Google Cloud Code API capacity unavailable across 7 consecutive accounts');
    });
  });
});
