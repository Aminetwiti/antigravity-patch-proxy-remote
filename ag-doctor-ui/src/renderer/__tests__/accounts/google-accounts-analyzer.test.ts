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
