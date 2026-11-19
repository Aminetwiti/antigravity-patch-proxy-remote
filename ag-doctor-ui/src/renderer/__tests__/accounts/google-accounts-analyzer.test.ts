import { describe, expect, it } from 'vitest';
import {
  getAccountTier,
  isAiStudioAccount,
  isGeminiCliAccount,
  isAccountValidationRequired,
  isAccountUnlicensed,
  hasAccountErrorOrValidation,
  getQuotaColor,
  formatQuotaPercent,
  getAccountEffectiveQuotas,
  estimateAccountTokens,
  calculatePoolTokenSummary,
} from '../../services/accounts/google-accounts-analyzer';

describe('SOLID Architecture — Google Accounts Pure Analyzer (SRP)', () => {
  describe('Account Tier & Classification', () => {
    it('classifies Google AI Studio accounts', () => {
      expect(isAiStudioAccount({ provider: 'google-gemini' })).toBe(true);
      expect(isAiStudioAccount({ name: 'Studio Key 1', apiKey: 'AQ.xyz' })).toBe(true);
      expect(isAiStudioAccount({ apiKey: 'AIzaSy12345' })).toBe(true);
      expect(isAiStudioAccount({ provider: 'google', refreshToken: '1//abc' })).toBe(false);
      expect(getAccountTier({ provider: 'google-gemini' })).toBe('STUDIO');
    });

    it('classifies Gemini CLI accounts', () => {
      expect(isGeminiCliAccount({ provider: 'gemini-cli' })).toBe(true);
      expect(isGeminiCliAccount({ id: 'gemini-cli:primary' })).toBe(true);
      expect(isGeminiCliAccount({ name: 'User Gemini CLI' })).toBe(true);
      expect(isGeminiCliAccount({ provider: 'google' })).toBe(false);
      expect(getAccountTier({ provider: 'gemini-cli' })).toBe('CLI');
    });

    it('classifies Antigravity tiers: PRO, ULTRA, FREE, PARTAGE', () => {
      expect(getAccountTier({ tier: 'PRO' })).toBe('PRO');
      expect(getAccountTier({ tier: 'ULTRA' })).toBe('ULTRA');
      expect(getAccountTier({ isUnlicensed: true })).toBe('FREE');
      expect(getAccountTier({ isFamilyShared: true })).toBe('PARTAGE');
      expect(getAccountTier({ name: 'My Ultra Account' })).toBe('ULTRA');
    });
  });

  describe('Validation & Error Detection', () => {
    it('detects security validation requirements', () => {
      expect(isAccountValidationRequired(null)).toBe(false);
      expect(isAccountValidationRequired({ status: 'validation_required' })).toBe(true);
      expect(isAccountValidationRequired({ isValidationRequired: true })).toBe(true);
      expect(isAccountValidationRequired({ errorDetails: { status: 'VALIDATION_REQUIRED' } })).toBe(true);
      expect(isAccountValidationRequired({ lastError: '403: Verify your account challenge' })).toBe(true);
      expect(isAccountValidationRequired({ status: 'ok' })).toBe(false);
    });

    it('detects unlicensed accounts', () => {
      expect(isAccountUnlicensed({ isUnlicensed: true })).toBe(true);
      expect(isAccountUnlicensed({ quotas: { isUnlicensed: true } })).toBe(true);
      expect(isAccountUnlicensed({ isUnlicensed: false })).toBe(false);
    });

    it('aggregates all blocking error states', () => {
      expect(hasAccountErrorOrValidation({ status: 'blocked' })).toBe(true);
      expect(hasAccountErrorOrValidation({ status: 'unhealthy', lastError: '403 Forbidden' })).toBe(true);
      expect(hasAccountErrorOrValidation({ enabled: true, status: 'ok' })).toBe(false);
    });
  });

  describe('Quota & Token Estimations', () => {
    it('computes quota color codes according to thresholds', () => {
      expect(getQuotaColor(80)).toBe('#10b981'); // > 50%
      expect(getQuotaColor(35)).toBe('#f59e0b'); // 20-50%
      expect(getQuotaColor(10)).toBe('#f43f5e'); // < 20%
    });

    it('formats quota percentages with bounds', () => {
      expect(formatQuotaPercent(75.4)).toBe('75%');
      expect(formatQuotaPercent(120)).toBe('100%');
      expect(formatQuotaPercent(-10)).toBe('0%');
      expect(formatQuotaPercent(null)).toBe('—');
    });

    it('calculates effective quotas cleanly with fallbacks', () => {
      const acc = {
        quotas: {
          geminiFiveHourPct: 85,
          geminiWeeklyPct: 92,
          claudeFiveHourPct: 40,
          claudeWeeklyPct: 60,
        },
      };
      const eff = getAccountEffectiveQuotas(acc);
      expect(eff.gemini5hPct).toBe(85);
      expect(eff.geminiWkPct).toBe(92);
      expect(eff.claude5hPct).toBe(40);
      expect(eff.claudeWkPct).toBe(60);
    });

    it('aligns gemini weekly with real 5h quota when weekly is omitted or defaults to 100 while 5h is lower', () => {
      const acc = {
        quotas: {
          geminiFiveHourPct: 52,
          geminiFiveHourReset: '2026-11-18T16:40:00Z',
          claudeFiveHourPct: 0,
          claudeWeeklyPct: 77,
          claudeWeeklyReset: '2026-11-20T13:00:00Z',
        },
      };
      const eff = getAccountEffectiveQuotas(acc);
      expect(eff.gemini5hPct).toBe(52);
      expect(eff.geminiWkPct).toBe(52);
      expect(eff.geminiWkReset).toBe('2026-11-18T16:40:00Z');
      expect(eff.claude5hPct).toBe(0);
      expect(eff.claudeWkPct).toBe(77);
      expect(eff.claudeWkReset).toBe('2026-11-20T13:00:00Z');
    });

    it('overrides static gemini-weekly bucket at 100% in groups with real 5h quota (REV-001 regression)', () => {
      // Exact structure from quota_cache.json / custom_models.json: bucket gemini-weekly exists at 100%
      // while geminiFiveHourPct has dropped to 52%. Weekly must NOT stay stuck at 100%.
      const acc = {
        quotas: {
          geminiFiveHourPct: 52,
          geminiWeeklyPct: 100,
          geminiFiveHourReset: '2026-11-18T16:40:00Z',
          geminiWeeklyReset: '2026-11-18T16:40:00Z',
          claudeFiveHourPct: 0,
          claudeWeeklyPct: 77,
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-5h', window: '5h', percentage: 52, resetTime: '2026-11-18T16:40:00Z' },
                { bucketId: 'gemini-weekly', window: 'weekly', percentage: 100, resetTime: '2026-11-18T16:40:00Z' },
              ],
            },
            {
              displayName: 'Claude and GPT models',
              buckets: [
                { bucketId: '3p-weekly', window: 'weekly', percentage: 77, resetTime: '2026-11-20T13:00:00Z' },
                { bucketId: '3p-5h', window: '5h', percentage: 0 },
              ],
            },
          ],
        },
      };
      const eff = getAccountEffectiveQuotas(acc);
      // Weekly must reflect the real 5h quota, NOT the static 100% from the bucket
      expect(eff.gemini5hPct).toBe(52);
      expect(eff.geminiWkPct).toBe(52);
      expect(eff.claude5hPct).toBe(0);
      expect(eff.claudeWkPct).toBe(77);
    });

    it('preserves real weekly value when genuinely below 100 (true 429 weekly exhaustion)', () => {
      const acc = {
        quotas: {
          geminiFiveHourPct: 0,
          geminiWeeklyPct: 0,
          claudeFiveHourPct: 0,
          claudeWeeklyPct: 0,
        },
      };
      const eff = getAccountEffectiveQuotas(acc);
      expect(eff.gemini5hPct).toBe(0);
      expect(eff.geminiWkPct).toBe(0);
      expect(eff.claude5hPct).toBe(0);
      expect(eff.claudeWkPct).toBe(0);
    });

    it('shows 100% for both when account is fully healthy', () => {
      const acc = {
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 100,
          claudeFiveHourPct: 100,
          claudeWeeklyPct: 100,
        },
      };
      const eff = getAccountEffectiveQuotas(acc);
      expect(eff.gemini5hPct).toBe(100);
      expect(eff.geminiWkPct).toBe(100);
    });

    it('estimates tokens according to account tier', () => {
      const proAcc = {
        tier: 'PRO',
        quotas: { geminiFiveHourPct: 50, geminiWeeklyPct: 100, claudeFiveHourPct: 100, claudeWeeklyPct: 100 },
      };
      const est = estimateAccountTokens(proAcc);
      expect(est.geminiCapacity5h).toBe(250_000_000);
      expect(est.geminiAvailable5h).toBe(125_000_000);
      expect(est.geminiConsumed5h).toBe(125_000_000);

      const studioAcc = { provider: 'google-gemini' };
      const studioEst = estimateAccountTokens(studioAcc);
      expect(studioEst.accountCapacity5h).toBe(0);
    });

    it('calculates pool token summary', () => {
      const pool = [
        { tier: 'PRO', enabled: true, quotas: { geminiFiveHourPct: 50, geminiWeeklyPct: 50, claudeFiveHourPct: 50, claudeWeeklyPct: 50 } },
        { tier: 'PRO', enabled: false, quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100, claudeFiveHourPct: 100, claudeWeeklyPct: 100 } },
      ];
      const summary = calculatePoolTokenSummary(pool, false);
      expect(summary.antigravityTotal).toBe(2);
      expect(summary.activeCount).toBe(1);
      expect(summary.totalCap).toBe(250_000_000);
      expect(summary.availableTokens).toBe(125_000_000);
      expect(summary.pct).toBe(50);
    });
  });
});
