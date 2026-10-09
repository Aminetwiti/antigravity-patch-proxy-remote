import { describe, expect, it } from 'vitest';
import {
  calculatePoolRunway,
  getUpcomingResetsTimeline,
  formatCompactDuration,
  formatLiveCountdown,
  calculatePoolVelocity,
  getPoolStrategicAdvice,
  calculatePoolResilienceScore,
  getPoolFallbackChain,
  calculateBurnProjection,
} from './google-accounts-telemetry';

describe('google-accounts-telemetry', () => {
  describe('calculatePoolRunway', () => {
    it('returns critical 0h for empty or disabled accounts', () => {
      const res1 = calculatePoolRunway([]);
      expect(res1.totalAvailableTokens).toBe(0);
      expect(res1.formattedRunway).toBe('0h 00m');
      expect(res1.burnState).toBe('critical');

      const res2 = calculatePoolRunway([{ id: 'g1', enabled: false, quotas: { fiveHourPercentage: 100 } }]);
      expect(res2.totalAvailableTokens).toBe(0);
      expect(res2.burnState).toBe('critical');
    });

    it('estimates runway accurately for standard PRO accounts at 120k tokens/hour', () => {
      // 1 PRO account with 100% quota = 350,000 tokens
      // 350,000 / 120,000 = 2.91 hours -> 2h 55m -> 'moderate'
      const accounts = [
        { id: 'acc1', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100 } },
      ];
      const res = calculatePoolRunway(accounts, 120_000);
      expect(res.totalAvailableTokens).toBe(350_000);
      expect(res.runwayHours).toBe(2);
      expect(res.runwayMinutes).toBe(55);
      expect(res.formattedRunway).toBe('2h 55m');
      expect(res.burnState).toBe('moderate');
    });

    it('identifies healthy runway when multiple accounts yield > 3h', () => {
      // 2 PRO accounts at 100% = 700,000 tokens. 700,000 / 120,000 = 5h 50m
      const accounts = [
        { id: 'acc1', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100 } },
        { id: 'acc2', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100 } },
      ];
      const res = calculatePoolRunway(accounts, 120_000);
      expect(res.totalAvailableTokens).toBe(700_000);
      expect(res.runwayHours).toBe(5);
      expect(res.burnState).toBe('healthy');
    });

    it('skips AI Studio and Gemini CLI accounts from pooled Antigravity runway', () => {
      const accounts = [
        { id: 'studio-key', provider: 'google-gemini', apiKey: 'AQ.xyz', enabled: true },
        { id: 'gemini-cli-1', provider: 'gemini-cli', enabled: true },
        { id: 'real-pro', provider: 'google', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 50 } },
      ];
      // 50% of 350k = 175k tokens. 175,000 / 120,000 = 1h 27m
      const res = calculatePoolRunway(accounts, 120_000);
      expect(res.totalAvailableTokens).toBe(175_000);
      expect(res.runwayHours).toBe(1);
      expect(res.runwayMinutes).toBe(27);
    });
  });

  describe('getUpcomingResetsTimeline', () => {
    const fixedNow = new Date('2026-10-07T12:00:00Z').getTime();

    it('sorts upcoming resets chronologically and formats countdowns', () => {
      const accounts = [
        {
          id: 'acc1',
          name: 'Pro Account',
          quotas: {
            fiveHourResetTime: new Date('2026-10-07T14:30:00Z').toISOString(), // in 2h 30m
            weeklyResetTime: new Date('2026-10-10T12:00:00Z').toISOString(),   // in 3d
          },
        },
        {
          id: 'acc2',
          name: 'Cooldown Account',
          cooldown: {
            until: new Date('2026-10-07T12:15:00Z').toISOString(), // in 15m
          },
          quotas: {
            fiveHourResetTime: new Date('2026-10-07T13:00:00Z').toISOString(), // in 1h
          },
        },
      ];

      const timeline = getUpcomingResetsTimeline(accounts, fixedNow, 4);
      expect(timeline.length).toBe(4);
      // 1st item should be Cooldown (15m)
      expect(timeline[0].type).toBe('cooldown');
      expect(timeline[0].accountName).toBe('Cooldown Account');
      expect(timeline[0].formattedCountdown).toBe('15m');

      // 2nd item should be acc2 5h (1h 00m)
      expect(timeline[1].type).toBe('5h');
      expect(timeline[1].accountName).toBe('Cooldown Account');
      expect(timeline[1].formattedCountdown).toBe('1h 0m');

      // 3rd item should be acc1 5h (2h 30m)
      expect(timeline[2].type).toBe('5h');
      expect(timeline[2].accountName).toBe('Pro Account');
      expect(timeline[2].formattedCountdown).toBe('2h 30m');

      // 4th item should be acc1 weekly (3j 0h)
      expect(timeline[3].type).toBe('weekly');
      expect(timeline[3].accountName).toBe('Pro Account');
      expect(timeline[3].formattedCountdown).toBe('3j 0h');
    });

    it('ignores expired reset times in the past', () => {
      const accounts = [
        {
          id: 'acc-past',
          quotas: {
            fiveHourResetTime: new Date('2026-10-07T11:00:00Z').toISOString(), // in the past
          },
        },
      ];
      const timeline = getUpcomingResetsTimeline(accounts, fixedNow);
      expect(timeline.length).toBe(0);
    });
  });

  describe('formatLiveCountdown', () => {
    it('returns "Prêt" for 0 or negative time', () => {
      expect(formatLiveCountdown(0)).toBe('Prêt');
      expect(formatLiveCountdown(-5000)).toBe('Prêt');
    });

    it('formats seconds only when under 60 seconds', () => {
      expect(formatLiveCountdown(45_000)).toBe('45s');
      expect(formatLiveCountdown(5_000)).toBe('5s');
    });

    it('formats minutes and seconds when between 1m and 60m', () => {
      expect(formatLiveCountdown(75_000)).toBe('1m 15s');
      expect(formatLiveCountdown(600_000)).toBe('10m 00s');
      expect(formatLiveCountdown(125_000)).toBe('2m 05s');
    });

    it('formats hours and minutes when over 60m', () => {
      expect(formatLiveCountdown(3_660_000)).toBe('1h 1m');
      expect(formatLiveCountdown(7_200_000)).toBe('2h 0m');
    });
  });

  describe('calculatePoolVelocity', () => {
    it('returns calm 0 rpm when no sessions provided', () => {
      const v = calculatePoolVelocity([]);
      expect(v.rpm).toBe(0);
      expect(v.status).toBe('calm');
    });

    it('accurately calculates RPM from recent sessions within the 5m window', () => {
      const now = 10000000;
      const sessions = [
        { timestamp: now - 30000 },
        { timestamp: now - 60000 },
        { timestamp: now - 90000 },
        { timestamp: now - 120000 },
        { timestamp: now - 150000 },
      ];
      const v = calculatePoolVelocity(sessions, now, 5 * 60 * 1000);
      expect(v.rpm).toBe(1); // 5 req in 5 min = 1 RPM
      expect(v.status).toBe('calm');
    });

    it('detects high charge warning when RPM >= 10', () => {
      const now = 10000000;
      const sessions = Array.from({ length: 55 }, (_, i) => ({ timestamp: now - i * 3000 }));
      const v = calculatePoolVelocity(sessions, now, 5 * 60 * 1000);
      expect(v.rpm).toBe(11);
      expect(v.status).toBe('warning');
      expect(v.label).toContain('15 RPM');
    });
  });

  describe('getPoolStrategicAdvice', () => {
    it('returns empty notice when no accounts exist', () => {
      const adv = getPoolStrategicAdvice([]);
      expect(adv.icon).toBe('ℹ️');
    });

    it('recommends wake action when expired cooldowns exist', () => {
      const now = 10000000;
      const cooldowns = {
        'google:a1:gemini': { until: now - 1000 },
      };
      const adv = getPoolStrategicAdvice([{ id: 'a1', enabled: true }], cooldowns, now);
      expect(adv.actionType).toBe('wake');
      expect(adv.text).toContain('cooldown expiré');
    });

    it('recommends soft-stow when accounts have < 3% 5h quota', () => {
      const accounts = [
        { id: 'crit', enabled: true, quotas: { geminiFiveHourPct: 2, claudeFiveHourPct: 2 } },
      ];
      const adv = getPoolStrategicAdvice(accounts, {}, 1000);
      expect(adv.actionType).toBe('soft-stow');
      expect(adv.text).toContain('réserve critique');
    });

    it('recommends switching to Gemini when Claude is exhausted but Gemini healthy', () => {
      const accounts = [
        { id: 'a1', enabled: true, quotas: { geminiFiveHourPct: 90, claudeFiveHourPct: 0 } },
        { id: 'a2', enabled: true, quotas: { geminiFiveHourPct: 80, claudeFiveHourPct: 0 } },
      ];
      const adv = getPoolStrategicAdvice(accounts, {}, 1000);
      expect(adv.actionType).toBe('switch-gemini');
      expect(adv.text).toContain('Gemini 3.8 Flash');
    });

    it('reports nominal state when pool is balanced', () => {
      const accounts = [
        { id: 'a1', enabled: true, quotas: { geminiFiveHourPct: 90, claudeFiveHourPct: 90 } },
        { id: 'a2', enabled: true, quotas: { geminiFiveHourPct: 80, claudeFiveHourPct: 80 } },
      ];
      const adv = getPoolStrategicAdvice(accounts, {}, 1000);
      expect(adv.icon).toBe('🟢');
      expect(adv.text).toContain('nominal');
    });
  });

  describe('calculatePoolResilienceScore', () => {
    it('returns score 0 and critical grade for empty accounts', () => {
      const res = calculatePoolResilienceScore([]);
      expect(res.score).toBe(0);
      expect(res.grade).toBe('critical');
      expect(res.color).toBe('#ef4444');
    });

    it('calculates optimal score (>=80) when fleet has redundancy and runway', () => {
      const accounts = [
        { id: 'a1', enabled: true, tier: 'PRO', quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
        { id: 'a2', enabled: true, tier: 'PRO', quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
        { id: 'studio', provider: 'google-gemini', apiKey: 'AQ.key', enabled: true },
      ];
      const res = calculatePoolResilienceScore(accounts, {}, 1000);
      expect(res.score).toBeGreaterThanOrEqual(80);
      expect(res.grade).toBe('optimal');
      expect(res.color).toBe('#10b981');
      expect(res.label).toBe('Ultra-Résilient');
    });

    it('penalizes score when accounts are in cooldown or depleted', () => {
      const accounts = [
        { id: 'a1', enabled: true, tier: 'PRO', quotas: { geminiFiveHourPct: 0, claudeFiveHourPct: 0 } },
      ];
      const res = calculatePoolResilienceScore(accounts, {}, 1000);
      expect(res.score).toBeLessThan(40);
      expect(res.grade).toMatch(/tense|critical/);
    });
  });

  describe('getPoolFallbackChain', () => {
    it('builds a 4-tier chain and detects active levels', () => {
      const accounts = [
        { id: 'a1', enabled: true, quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
        { id: 'a2', enabled: true, quotas: { geminiFiveHourPct: 80, claudeFiveHourPct: 0 } },
        { id: 'studio', provider: 'google-gemini', apiKey: 'AQ.key', enabled: true },
      ];
      const chain = getPoolFallbackChain(accounts, {}, 1000);
      expect(chain.length).toBe(4);
      expect(chain[0].id).toBe('gemini-pool');
      expect(chain[0].status).toBe('ready'); // 2 ready
      expect(chain[1].id).toBe('gemini-flash');
      expect(chain[1].status).toBe('ready');
      expect(chain[2].id).toBe('claude-bridge');
      expect(chain[2].status).toBe('ready'); // 1 ready
      expect(chain[3].id).toBe('ai-studio');
      expect(chain[3].status).toBe('ready'); // studio present
    });

    it('marks blocked levels when quotas or cooldowns prevent usage', () => {
      const accounts = [
        { id: 'a1', enabled: true, quotas: { geminiFiveHourPct: 0, claudeFiveHourPct: 0 } },
      ];
      const chain = getPoolFallbackChain(accounts, {}, 1000);
      expect(chain[0].status).toBe('blocked');
      expect(chain[1].status).toBe('blocked');
      expect(chain[2].status).toBe('blocked');
      expect(chain[3].status).toBe('degraded');
    });
  });

  describe('calculateBurnProjection', () => {
    it('scales runway accurately between eco, normal, and burst profiles', () => {
      const accounts = [
        { id: 'a1', enabled: true, tier: 'PRO', quotas: { fiveHourPercentage: 100 } }, // 350k
      ];
      const eco = calculateBurnProjection(accounts, 'eco'); // 60k/h -> 5h 50m
      const normal = calculateBurnProjection(accounts, 'normal'); // 120k/h -> 2h 55m
      const burst = calculateBurnProjection(accounts, 'burst'); // 250k/h -> 1h 24m

      expect(eco.runwayHours).toBeGreaterThan(normal.runwayHours);
      expect(normal.runwayHours).toBeGreaterThan(burst.runwayHours);
      expect(eco.formattedRunway).toBe('5h 50m');
      expect(burst.formattedRunway).toBe('1h 24m');
    });
  });
});
