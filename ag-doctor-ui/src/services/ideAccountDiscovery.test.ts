import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractTokensFromBuffer,
  getCandidateDbPaths,
  fetchGoogleAccountQuotas,
  refreshGoogleToken,
  ensureCloudCodeProject,
  warmupGoogleAccount,
  switchActiveIdeAccount,
} from './ideAccountDiscovery';

describe('ideAccountDiscovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractTokensFromBuffer', () => {
    it('extracts direct plaintext access and refresh tokens from buffer', () => {
      const payload = 'header\x00ya29.a0AdMD6EgvCV9KhcPWvC1JPfv_cUD5WosBb9kYJaV0gwazdLVfNA1qRW7aMdqoOP8VvINfr24U-EDI_UTlCKCyzxklhJ\x00middle\x00g1//03MxCaslwcb7SCgYIARAAGAMSNwF-L9IruEhWX4ST7lbTBH9hcRjxJA1mFaDx2C_g4gOEVFlChkuRp2vFs3otJPDN2-wI09qu4xk\x00';
      const buf = Buffer.from(payload, 'latin1');
      const res = extractTokensFromBuffer(buf);

      expect(res.accessToken).toBe('ya29.a0AdMD6EgvCV9KhcPWvC1JPfv_cUD5WosBb9kYJaV0gwazdLVfNA1qRW7aMdqoOP8VvINfr24U-EDI_UTlCKCyzxklhJ');
      expect(res.refreshToken).toBe('g1//03MxCaslwcb7SCgYIARAAGAMSNwF-L9IruEhWX4ST7lbTBH9hcRjxJA1mFaDx2C_g4gOEVFlChkuRp2vFs3otJPDN2-wI09qu4xk');
    });

    it('extracts tokens from embedded base64 protobuf payload', () => {
      const innerRaw = 'prefix\x00ya29.testAccessToken12345\x00mid\x001//testRefreshToken67890\x00suffix';
      const b64 = Buffer.from(innerRaw).toString('base64');
      const outer = `topic-sentinel-key-${b64}-extra-metadata`;
      const buf = Buffer.from(outer, 'latin1');
      const res = extractTokensFromBuffer(buf);

      expect(res.accessToken).toBe('ya29.testAccessToken12345');
      expect(res.refreshToken).toBe('1//testRefreshToken67890');
    });

    it('returns nulls when buffer contains no Google tokens', () => {
      const buf = Buffer.from('hello-world-random-non-token-data-1234567890');
      const res = extractTokensFromBuffer(buf);
      expect(res.accessToken).toBeNull();
      expect(res.refreshToken).toBeNull();
    });
  });

  describe('getCandidateDbPaths', () => {
    it('returns list containing candidate state.vscdb files', () => {
      const paths = getCandidateDbPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((p) => p.includes('state.vscdb'))).toBe(true);
    });
  });

  describe('fetchGoogleAccountQuotas', () => {
    it('parses Google Cloud Code retrieveUserQuotaSummary response correctly', async () => {
      const mockQuotaResponse = {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remainingFraction: 0.82,
                resetTime: '2026-09-14T16:11:33Z',
              },
              {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                remainingFraction: 0.75,
                resetTime: '2026-09-19T06:22:27Z',
              },
            ],
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              {
                bucketId: '3p-5h',
                window: '5h',
                remainingFraction: 1.0,
                resetTime: '2026-09-14T16:55:00Z',
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuotaResponse,
      } as any);

      const quotas = await fetchGoogleAccountQuotas('ya29.mock-token');
      expect(quotas).not.toBeNull();
      expect(quotas!.fiveHourPercentage).toBe(82);
      expect(quotas!.fiveHourResetTime).toBe('2026-09-14T16:11:33Z');
      expect(quotas!.weeklyPercentage).toBe(75);
      expect(quotas!.geminiFiveHourPct).toBe(82);
      expect(quotas!.geminiWeeklyPct).toBe(75);
      expect(quotas!.claudeFiveHourPct).toBe(100);
      expect(quotas!.claudeFiveHourReset).toBe('2026-09-14T16:55:00Z');
      expect(quotas!.groups.length).toBe(2);
    });

    it('handles non-200 responses gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any);

      const quotas = await fetchGoogleAccountQuotas('ya29.bad-token');
      expect(quotas).toBeNull();
    });
  });

  describe('refreshGoogleToken deduplication', () => {
    it('deduplicates concurrent refresh requests for the same token', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          json: async () => ({ access_token: 'ya29.fresh-token-xyz', expires_in: 3600 }),
        } as any;
      });

      // Launch 3 simultaneous refreshes
      const [res1, res2, res3] = await Promise.all([
        refreshGoogleToken('g1//test-concurrent-refresh'),
        refreshGoogleToken('g1//test-concurrent-refresh'),
        refreshGoogleToken('g1//test-concurrent-refresh'),
      ]);

      expect(res1?.accessToken).toBe('ya29.fresh-token-xyz');
      expect(res2?.accessToken).toBe('ya29.fresh-token-xyz');
      expect(res3?.accessToken).toBe('ya29.fresh-token-xyz');
      // Must only call fetch ONCE despite 3 callers!
      expect(callCount).toBe(1);
    });
  });

  describe('ensureCloudCodeProject', () => {
    it('returns existing project and tier when present in loadCodeAssist', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cloudaicompanionProject: 'projects/my-companion-12345',
          allowedTiers: [{ id: 'free-tier', isDefault: true }],
          manageSubscriptionUri: 'https://admin.google.com/?Email=dev%40example.com',
        }),
      } as any);

      const project = await ensureCloudCodeProject('ya29.valid-token');
      expect(project).not.toBeNull();
      expect(project!.projectId).toBe('projects/my-companion-12345');
      expect(project!.tierId).toBe('free-tier');
      expect(project!.accountEmail).toBe('dev@example.com');
    });

    it('triggers onboardUser when no existing project is returned', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            allowedTiers: [{ id: 'free-tier', isDefault: true }],
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            done: true,
            response: {
              cloudaicompanionProject: { id: 'projects/onboarded-project-67890' },
            },
          }),
        } as any);

      const project = await ensureCloudCodeProject('ya29.new-account-token');
      expect(project).not.toBeNull();
      expect(project!.projectId).toBe('projects/onboarded-project-67890');
    });
  });

  describe('warmupGoogleAccount', () => {
    it('returns true when Google Cloud Code responds with 200 to warmup ping', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'OK' }),
      } as any);

      const result = await warmupGoogleAccount('ya29.test-warmup-token');
      expect(result).toBe(true);
    });

    it('returns false when Google Cloud Code responds with non-200 or network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as any);

      const result = await warmupGoogleAccount('ya29.test-warmup-fail');
      expect(result).toBe(false);
    });
  });

  describe('switchActiveIdeAccount', () => {
    it('gracefully handles absence of state.vscdb when switching active account', () => {
      const res = switchActiveIdeAccount({
        accessToken: 'ya29.mock-switch-token-12345',
        refreshToken: 'g1//mock-refresh-token',
        email: 'test-switch@gmail.com',
      });
      // Returns boolean success status (false when running in isolated test env with no Antigravity state.vscdb, or true if local DB exists)
      expect(typeof res.success).toBe('boolean');
    });
  });
});


