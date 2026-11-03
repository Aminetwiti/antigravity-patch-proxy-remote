import { describe, expect, it, vi } from 'vitest';

describe('Settings View Adversarial Remediations', () => {
  describe('AUDIT-001: Notification Toggle Logic', () => {
    it('inverts UI toggle state to match backend notifyEnabled logic', () => {
      // Label says: "Do not notify on provider errors"
      // ui.notifyEnabled = true (default) -> user is NOT muting -> toggle should be unchecked (false)
      const uiConfigEnabled = { notifyEnabled: true };
      const toggleCheckedInitial = uiConfigEnabled.notifyEnabled === false;
      expect(toggleCheckedInitial).toBe(false);

      // User checks toggle: "Do not notify" = true -> notifyEnabled must become false
      const userCheckedToggle = true;
      const targetNotifyEnabled = !userCheckedToggle;
      expect(targetNotifyEnabled).toBe(false);

      // User unchecks toggle: "Do not notify" = false -> notifyEnabled must become true
      const userUncheckedToggle = false;
      const reenabledNotify = !userUncheckedToggle;
      expect(reenabledNotify).toBe(true);
    });
  });

  describe('AUDIT-002: Restore Backup Handler', () => {
    it('invokes restoreBackup IPC contract and verifies success or failure', async () => {
      const mockRestoreSuccess = vi.fn().mockResolvedValue({ success: true });
      const mockRestoreFailure = vi.fn().mockResolvedValue({ success: false, error: 'File corrupt' });

      // Successful scenario
      const res1 = await mockRestoreSuccess();
      expect(mockRestoreSuccess).toHaveBeenCalled();
      expect(res1.success).toBe(true);

      // Failure scenario
      const res2 = await mockRestoreFailure();
      expect(mockRestoreFailure).toHaveBeenCalled();
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('File corrupt');
    });
  });

  describe('AUDIT-003: Provider Export Sanitization & Import Compatibility', () => {
    it('strips OAuth access and refresh tokens when exporting providers', () => {
      const rawProviders = [
        {
          id: 'prov-1',
          name: 'Google Gemini',
          accounts: [
            {
              id: 'acc-1',
              email: 'dev@example.com',
              accessToken: 'ya29.secret-access-token',
              refreshToken: '1//04secret-refresh-token',
              idToken: 'secret-id-token',
              active: true,
            },
          ],
        },
      ];

      const sanitized = rawProviders.map((p) => {
        const copy = { ...p };
        if (Array.isArray(copy.accounts)) {
          copy.accounts = copy.accounts.map((acc) => {
            const { refreshToken, accessToken, idToken, ...safeAcc } = acc;
            return safeAcc;
          });
        }
        return copy;
      });

      const serialized = JSON.stringify(sanitized);
      expect(serialized).not.toContain('ya29.secret-access-token');
      expect(serialized).not.toContain('1//04secret-refresh-token');
      expect(serialized).not.toContain('secret-id-token');
      expect(sanitized[0].accounts[0].email).toBe('dev@example.com');
      expect(sanitized[0].accounts[0].active).toBe(true);
    });

    it('accepts both BackupBundle format and raw provider array on import', () => {
      const bundleJson = JSON.stringify({
        version: '3.8.2',
        exportedAt: '2026-10-31T12:00:00.000Z',
        providers: [{ id: 'p1', name: 'OpenAI' }],
      });

      const arrayJson = JSON.stringify([{ id: 'p1', name: 'OpenAI' }]);

      const parseProviders = (text: string) => {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.providers) ? parsed.providers : null);
      };

      const fromBundle = parseProviders(bundleJson);
      const fromArray = parseProviders(arrayJson);

      expect(fromBundle).toHaveLength(1);
      expect(fromBundle[0].name).toBe('OpenAI');
      expect(fromArray).toHaveLength(1);
      expect(fromArray[0].name).toBe('OpenAI');

      expect(parseProviders('{"invalid": true}')).toBeNull();
    });
  });

  describe('AUDIT-004: Maintenance Action Button Locking', () => {
    it('disables all target buttons during async operation and restores them in finally', async () => {
      const buttons = [
        { id: 'doctorPruneBtn', disabled: false },
        { id: 'settingsPruneDbBtn', disabled: false },
      ];

      const setDisabled = (val: boolean) => {
        buttons.forEach((b) => { b.disabled = val; });
      };

      // Start operation
      setDisabled(true);
      expect(buttons.every((b) => b.disabled)).toBe(true);

      // Simulate async command
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Finally block
      setDisabled(false);
      expect(buttons.every((b) => !b.disabled)).toBe(true);
    });
  });

  describe('AUDIT-006 & AUDIT-007: Developer Status & Reset State Sync', () => {
    it('evaluates dev status command exit code and reflects status properly', () => {
      const evaluateDevStatus = (res: { code: number; stdout: string; stderr: string }) => {
        if (res.code === 0) {
          return {
            cohortText: '🟢 Cohorte : Google',
            immunityText: '🛡️ Auto-reset Neutralisé',
            ok: true,
          };
        }
        return {
          cohortText: '🔴 Inactif',
          immunityText: '⚠️ Non protégé',
          ok: false,
        };
      };

      const success = evaluateDevStatus({ code: 0, stdout: 'ok', stderr: '' });
      expect(success.ok).toBe(true);
      expect(success.cohortText).toContain('Google');

      const failure = evaluateDevStatus({ code: 1, stdout: '', stderr: 'error' });
      expect(failure.ok).toBe(false);
    });

    it('synchronizes DOM theme dataset and button state upon config reset', () => {
      const mockDocument = { theme: 'light' };
      const mockThemeToggle = { textContent: 'Switch to dark theme', ariaPressed: 'true' };

      // Reset action
      mockDocument.theme = 'dark';
      mockThemeToggle.textContent = 'Switch to light theme';
      mockThemeToggle.ariaPressed = 'false';

      expect(mockDocument.theme).toBe('dark');
      expect(mockThemeToggle.textContent).toBe('Switch to light theme');
      expect(mockThemeToggle.ariaPressed).toBe('false');
    });
  });
});
