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
  calculateAccountTokens,
  calculatePoolConsumedTokens,
  isAccountInCooldownTelemetry,
  isAccountValidationRequiredTelemetry,
  isAccountBlockedTelemetry,
  GEMINI_5H_QUOTA_TOKENS,
  GEMINI_WEEKLY_RATIO,
  CLAUDE_5H_TO_WEEKLY_RATIO,
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

    it('estimates runway accurately for standard Gemini accounts with 250M quota at 50M tokens/hour', () => {
      // 1 account with 100% quota = 250,000,000 tokens
      // 250,000,000 / 50,000,000 = 5 hours -> 'healthy'
      const accounts = [
        { id: 'acc1', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100, weeklyPercentage: 100 } },
      ];
      const res = calculatePoolRunway(accounts, 50_000_000);
      expect(res.totalAvailableTokens).toBe(250_000_000);
      expect(res.totalConsumedTokens5h).toBe(0);
      expect(res.totalConsumedTokensWeekly).toBe(0);
      expect(res.runwayHours).toBe(5);
      expect(res.runwayMinutes).toBe(0);
      expect(res.formattedRunway).toBe('5h 00m');
      expect(res.burnState).toBe('healthy');
    });

    it('identifies healthy runway when multiple accounts yield > 3h', () => {
      // 2 accounts at 100% = 500,000,000 tokens. 500M / 50M = 10h
      const accounts = [
        { id: 'acc1', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100 } },
        { id: 'acc2', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 100 } },
      ];
      const res = calculatePoolRunway(accounts, 50_000_000);
      expect(res.totalAvailableTokens).toBe(500_000_000);
      expect(res.runwayHours).toBe(10);
      expect(res.burnState).toBe('healthy');
    });

    it('skips AI Studio and Gemini CLI accounts from pooled Antigravity runway', () => {
      const accounts = [
        { id: 'studio-key', provider: 'google-gemini', apiKey: 'AQ.xyz', enabled: true },
        { id: 'gemini-cli-1', provider: 'gemini-cli', enabled: true },
        { id: 'real-pro', provider: 'google', tier: 'PRO', enabled: true, quotas: { fiveHourPercentage: 50, weeklyPercentage: 80 } },
      ];
      // 50% of 250M = 125M tokens. 125,000,000 / 50,000,000 = 2h 30m -> 'moderate'
      const res = calculatePoolRunway(accounts, 50_000_000);
      expect(res.totalAvailableTokens).toBe(125_000_000);
      expect(res.totalConsumedTokens5h).toBe(125_000_000);
      expect(res.runwayHours).toBe(2);
      expect(res.runwayMinutes).toBe(30);
      expect(res.burnState).toBe('moderate');
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
        { id: 'a1', enabled: true, tier: 'PRO', quotas: { fiveHourPercentage: 100 } }, // 250M
      ];
      const eco = calculateBurnProjection(accounts, 'eco'); // 25M/h -> 10h 00m
      const normal = calculateBurnProjection(accounts, 'normal'); // 50M/h -> 5h 00m
      const burst = calculateBurnProjection(accounts, 'burst'); // 100M/h -> 2h 30m

      expect(eco.runwayHours).toBeGreaterThan(normal.runwayHours);
      expect(normal.runwayHours).toBeGreaterThan(burst.runwayHours);
      expect(eco.formattedRunway).toBe('10h 00m');
      expect(burst.formattedRunway).toBe('2h 30m');
    });
  });

  describe('Real Quota & Token Model (Gemini 250M 5h / 13% weekly, Claude 50%)', () => {
    it('accurately calculates tokens consumed and available for Gemini accounts', () => {
      const acc = {
        id: 'gemini-acc-1',
        enabled: true,
        quotas: {
          geminiFiveHourPct: 70, // 30% consumed in 5h
          geminiWeeklyPct: 76,   // 24% consumed in weekly
        },
      };

      const metrics = calculateAccountTokens(acc);
      // 5H: 250M * 70% = 175M available, 250M * 30% = 75M consumed
      expect(metrics.availableTokens5h).toBe(175_000_000);
      expect(metrics.consumedTokens5h).toBe(75_000_000);

      // Weekly: ~1,923,076,923 total -> 76% available, 24% consumed (~461.5M)
      expect(metrics.availableTokensWeekly).toBeGreaterThan(1_400_000_000);
      expect(metrics.consumedTokensWeekly).toBeGreaterThan(450_000_000);
    });

    it('aggregates total pool consumed and available tokens correctly', () => {
      const accounts = [
        { id: 'a1', enabled: true, quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 90 } },
        { id: 'a2', enabled: true, quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 80 } },
      ];
      const pool = calculatePoolConsumedTokens(accounts);
      // a1 consumed 5h: 20% of 250M = 50M. a2 consumed 5h: 40% of 250M = 100M. Total 5h consumed = 150M
      expect(pool.totalConsumed5h).toBe(150_000_000);
      // a1 available 5h: 200M. a2 available 5h: 150M. Total = 350M
      expect(pool.totalAvailable5h).toBe(350_000_000);
      expect(pool.totalConsumedWeekly).toBeGreaterThan(0);
      expect(pool.totalAvailableWeekly).toBeGreaterThan(0);
    });

    it('extracts quotas from Google groups buckets when present', () => {
      const acc = {
        id: 'google-groups-account',
        enabled: true,
        quotas: {
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-5h', remainingFraction: 0.85 },
                { bucketId: 'gemini-weekly', remainingFraction: 0.92 },
              ],
            },
          ],
        },
      };
      const metrics = calculateAccountTokens(acc);
      expect(metrics.pct5h).toBe(85);
      expect(metrics.pctWeekly).toBe(92);
      expect(metrics.availableTokens5h).toBe(Math.round(250_000_000 * 0.85));
    });

    it('includes active cooldowns and groups reset times in upcoming resets timeline', () => {
      const now = Date.now();
      const accounts = [
        {
          id: 'acc-cd',
          name: 'cooldown-test',
          email: 'test@example.com',
          quotas: {
            gemini5hReset: new Date(now + 120_000).toISOString(),
          },
        },
      ];
      const cooldownCache = {
        'google:test@example.com:gemini': {
          until: now + 60_000,
          remainingMin: 1,
        },
      };
      const timeline = getUpcomingResetsTimeline(accounts, now, 4, cooldownCache);
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0].type).toBe('cooldown');
      expect(timeline[0].accountName).toBe('cooldown-test');
    });
  });

  describe('isAccountInCooldownTelemetry & Cooldown Integration', () => {
    const fixedNow = 1000000;

    it('correctly matches account by email, id, or name with prefixes stripped', () => {
      const cooldowns = {
        'google:alice@gmail.com:gemini': { until: fixedNow + 300000 },
        'gemini-cli:acc-bob:claude': { until: fixedNow + 600000 },
      };

      const alice = { email: 'alice@gmail.com', name: 'Alice Pro' };
      const bob = { id: 'acc-bob', name: 'Bob Pro' };

      expect(isAccountInCooldownTelemetry(alice, 'gemini', cooldowns, fixedNow)).toBe(true);
      expect(isAccountInCooldownTelemetry(alice, 'claude', cooldowns, fixedNow)).toBe(false);

      expect(isAccountInCooldownTelemetry(bob, 'claude', cooldowns, fixedNow)).toBe(true);
      expect(isAccountInCooldownTelemetry(bob, 'gemini', cooldowns, fixedNow)).toBe(false);
    });

    it('ignores expired cooldowns where until <= nowMs', () => {
      const cooldowns = {
        'google:charlie@gmail.com:gemini': { until: fixedNow - 1000 },
      };
      const charlie = { email: 'charlie@gmail.com' };
      expect(isAccountInCooldownTelemetry(charlie, 'gemini', cooldowns, fixedNow)).toBe(false);
    });

    it('performs case-insensitive matching across IDs and emails', () => {
      const cooldowns = {
        'google:Alice.Upper@Gmail.COM:gemini': { until: fixedNow + 300000 },
      };
      const alice = { email: 'alice.upper@gmail.com' };
      expect(isAccountInCooldownTelemetry(alice, 'gemini', cooldowns, fixedNow)).toBe(true);
    });

    it('blocks gemini-pool in fallback chain when account has active cooldown despite 100% quota', () => {
      const accounts = [
        { id: 'cd-acc', email: 'cd@gmail.com', enabled: true, quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
      ];
      const cooldowns = {
        'google:cd@gmail.com:gemini': { until: fixedNow + 500000 },
      };

      const chain = getPoolFallbackChain(accounts, cooldowns, fixedNow);
      // Level 0 (gemini-pool) and Level 1 (gemini-flash) should be blocked because Gemini is in cooldown
      expect(chain[0].status).toBe('blocked');
      expect(chain[1].status).toBe('blocked');
      // Level 2 (claude-bridge) should remain ready
      expect(chain[2].status).toBe('ready');
    });

    it('penalizes pool resilience score when account is in cooldown even if raw quota is 100%', () => {
      const accounts = [
        { id: 'acc-1', email: 'a1@gmail.com', enabled: true, tier: 'PRO', quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
      ];
      const resWithoutCd = calculatePoolResilienceScore(accounts, {}, fixedNow);
      const resWithCd = calculatePoolResilienceScore(accounts, { 'google:a1@gmail.com:gemini': { until: fixedNow + 60000 } }, fixedNow);

      expect(resWithCd.score).toBeLessThan(resWithoutCd.score);
    });

    it('identifies accounts requiring validation or blocked', () => {
      const valAcc = { id: 'v1', status: 'validation_required' };
      const errAcc = { id: 'e1', errorDetails: { message: 'TOS violation' } };
      const normalAcc = { id: 'n1', enabled: true };

      expect(isAccountValidationRequiredTelemetry(valAcc)).toBe(true);
      expect(isAccountBlockedTelemetry(valAcc)).toBe(false);

      expect(isAccountValidationRequiredTelemetry(errAcc)).toBe(false);
      expect(isAccountBlockedTelemetry(errAcc)).toBe(true);

      expect(isAccountValidationRequiredTelemetry(normalAcc)).toBe(false);
      expect(isAccountBlockedTelemetry(normalAcc)).toBe(false);
    });

    it('excludes validation required and blocked accounts from ready Gemini count in strategic advice and fallback chain', () => {
      const accounts = [
        { id: 'ok-1', enabled: true, quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
        { id: 'ok-2', enabled: true, quotas: { geminiFiveHourPct: 100, claudeFiveHourPct: 100 } },
        { id: 'val-1', enabled: true, status: 'validation_required', quotas: { geminiFiveHourPct: 100 } },
        { id: 'blocked-1', enabled: true, isUnlicensed: true, quotas: { geminiFiveHourPct: 100 } },
      ];

      const chain = getPoolFallbackChain(accounts, {}, fixedNow);
      expect(chain[0].badgeText).toBe('2 prêts'); // only ok-1 and ok-2, not val-1 or blocked-1

      const advice = getPoolStrategicAdvice(accounts, {}, fixedNow);
      expect(advice.text).toContain('2/4 prêts');
    });

    it('deduplicates identical timestamps between weekly reset and cooldown in timeline', () => {
      const resetTime = new Date('2026-10-08T16:00:00Z').toISOString();
      const accounts = [
        {
          id: 'sneakers',
          name: 'sneakers',
          quotas: { weeklyResetTime: resetTime },
          cooldown: { until: resetTime }, // exactly matches weekly reset
        },
      ];

      const timeline = getUpcomingResetsTimeline(accounts, fixedNow, 4);
      // Should not have two entries for sneakers at the exact same time
      expect(timeline.length).toBe(1);
      expect(timeline[0].accountName).toBe('sneakers');
    });
  });
});

