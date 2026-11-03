import { describe, it, expect } from 'vitest';
import {
  calculatePoolVelocity,
  calculatePoolRunway,
  getPoolFallbackChain,
  isAccountInCooldownTelemetry,
} from './google-accounts-telemetry';

describe('Audit Remediation (AUDIT-001 through AUDIT-004)', () => {
  describe('AUDIT-001: Model Family Cooldown Isolation in Telemetry', () => {
    it('guarantees that an account in Claude cooldown is NOT treated as in Gemini cooldown', () => {
      const acc = { id: 'test-acc', email: 'test@example.com', name: 'Test' };
      const now = Date.now();
      const activeCooldowns = {
        'google:test-acc:claude': { until: now + 3600_000 },
      };

      const inGeminiCd = isAccountInCooldownTelemetry(acc, 'gemini', activeCooldowns, now);
      const inClaudeCd = isAccountInCooldownTelemetry(acc, 'claude', activeCooldowns, now);

      expect(inGeminiCd).toBe(false);
      expect(inClaudeCd).toBe(true);
    });
  });

  describe('AUDIT-002: Cooldown-Aware Runway Calculation', () => {
    it('excludes accounts under active cooldown from immediate available tokens', () => {
      const now = Date.now();
      const accounts = [
        {
          id: 'acc-ready',
          enabled: true,
          quotas: { fiveHourPercentage: 100, geminiFiveHourPct: 100 },
        },
        {
          id: 'acc-cooldown',
          enabled: true,
          quotas: { fiveHourPercentage: 100, geminiFiveHourPct: 100 },
        },
      ];
      const activeCooldowns = {
        'google:acc-cooldown:gemini': { until: now + 5 * 3600_000 },
      };

      const runwayWithCooldowns = calculatePoolRunway(accounts, 50_000_000, activeCooldowns, now);
      const runwayWithoutCooldowns = calculatePoolRunway(accounts, 50_000_000, {}, now);

      // Account in cooldown should be excluded from available tokens
      expect(runwayWithCooldowns.totalAvailableTokens).toBeLessThan(runwayWithoutCooldowns.totalAvailableTokens);
      expect(runwayWithCooldowns.totalAvailableTokens).toBe(250_000_000); // Only acc-ready (250M)
      expect(runwayWithoutCooldowns.totalAvailableTokens).toBe(500_000_000); // Both accounts (500M)
    });
  });

  describe('AUDIT-003: Dynamic RPM Velocity Thresholds & Critical Overheat Warning', () => {
    it('returns critical overheat warning at 67.4 RPM instead of static "Proche 15 RPM"', () => {
      const now = 10000000;
      // 337 requests in 5 minutes = 67.4 RPM
      const sessions = Array.from({ length: 337 }, (_, i) => ({
        timestamp: now - i * 800,
      }));

      const v = calculatePoolVelocity(sessions, now, 5 * 60 * 1000);
      expect(v.rpm).toBe(67.4);
      expect(v.status).toBe('warning');
      expect(v.label).toContain('Surchauffe Critique');
      expect(v.label).toContain('67.4 RPM');
      expect(v.label).not.toContain('Proche 15 RPM');
    });

    it('returns severe charge warning for 25 RPM', () => {
      const now = 10000000;
      const sessions = Array.from({ length: 125 }, (_, i) => ({
        timestamp: now - i * 2000,
      }));

      const v = calculatePoolVelocity(sessions, now, 5 * 60 * 1000);
      expect(v.rpm).toBe(25);
      expect(v.label).toContain('Charge Sévère');
      expect(v.label).toContain('25 RPM');
    });

    it('preserves "Proche 15 RPM" for 11 RPM', () => {
      const now = 10000000;
      const sessions = Array.from({ length: 55 }, (_, i) => ({
        timestamp: now - i * 5000,
      }));

      const v = calculatePoolVelocity(sessions, now, 5 * 60 * 1000);
      expect(v.rpm).toBe(11);
      expect(v.label).toContain('Proche 15 RPM');
    });
  });

  describe('AUDIT-004: Cascade Fallback Proactive Alert for Missing AI Studio', () => {
    it('flags AI Studio fallback as critical when Gemini pool is critically low (<= 5)', () => {
      const accounts = [
        { id: 'g1', enabled: true, quotas: { geminiFiveHourPct: 100 } },
        { id: 'g2', enabled: true, quotas: { geminiFiveHourPct: 100 } },
      ]; // only 2 accounts ready <= 5, no studio

      const steps = getPoolFallbackChain(accounts, {});
      const aiStudioStep = steps.find((s) => s.id === 'ai-studio');

      expect(aiStudioStep).toBeDefined();
      expect(aiStudioStep?.status).toBe('critical');
      expect(aiStudioStep?.badgeText).toBe('Non configuré');
    });

    it('reports AI Studio fallback as ready when AI Studio account exists', () => {
      const accounts = [
        { id: 'g1', enabled: true, quotas: { geminiFiveHourPct: 100 } },
        { id: 'studio', enabled: true, provider: 'google-gemini', apiKey: 'AIzaSyFakeKey' },
      ];

      const steps = getPoolFallbackChain(accounts, {});
      const aiStudioStep = steps.find((s) => s.id === 'ai-studio');

      expect(aiStudioStep).toBeDefined();
      expect(aiStudioStep?.status).toBe('ready');
      expect(aiStudioStep?.badgeText).toBe('Actif');
    });
  });
});
