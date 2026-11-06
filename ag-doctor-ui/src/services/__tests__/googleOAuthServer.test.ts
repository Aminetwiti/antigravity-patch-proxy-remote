import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import https from 'https';
import os from 'os';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../discovery/ideAccountDiscovery', () => ({
  fetchGoogleUserInfo: vi.fn().mockResolvedValue({ email: 'test@example.com', name: 'Test User' }),
  ensureCloudCodeProject: vi.fn().mockResolvedValue({ projectId: 'test-proj', tierId: 'PRO' }),
  fetchGoogleAccountQuotas: vi.fn().mockResolvedValue({ fiveHourPercentage: 100 }),
}));

import { startGoogleOAuthLogin, writeAdcCredentialsFile } from '../runtime/googleOAuthServer';

describe('googleOAuthServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeAdcCredentialsFile', () => {
    it('creates standard Application Default Credentials JSON file', () => {
      const tmpGcloud = fs.mkdtempSync(path.join(os.tmpdir(), 'adc-test-'));
      const origAppData = process.env.APPDATA;
      process.env.APPDATA = tmpGcloud;

      try {
        writeAdcCredentialsFile('user@example.com', '1//mock_refresh_token', 'mock_client_id', 'mock_client_secret');

        const adcPath = path.join(tmpGcloud, 'gcloud', 'application_default_credentials.json');
        expect(fs.existsSync(adcPath)).toBe(true);

        const data = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
        expect(data.account).toBe('user@example.com');
        expect(data.refresh_token).toBe('1//mock_refresh_token');
        expect(data.client_id).toBe('mock_client_id');
        expect(data.type).toBe('authorized_user');
      } finally {
        process.env.APPDATA = origAppData;
        try { fs.rmSync(tmpGcloud, { recursive: true, force: true }); } catch {}
      }
    });
  });

  describe('startGoogleOAuthLogin', () => {
    it('rejects with CSRF error when state parameter does not match', async () => {
      const flowPromise = startGoogleOAuthLogin('antigravity', 'test@example.com');
      await new Promise((r) => setTimeout(r, 60));

      let responded = false;
      for (const port of [8086, 8087, 8088, 8089, 8090]) {
        try {
          const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}/oauth2callback?code=mock_code&state=bad_state_value`, (res) => {
              resolve({ statusCode: res.statusCode });
            });
            req.on('error', reject);
          });

          if (res.statusCode === 403) {
            responded = true;
            break;
          }
        } catch {
          // Port not bound, continue
        }
      }

      expect(responded).toBe(true);
      const result = await flowPromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('CSRF');
    });

    it('rejects with error when Google query string provides error parameter', async () => {
      const flowPromise = startGoogleOAuthLogin('antigravity');
      await new Promise((r) => setTimeout(r, 60));

      const { shell } = await import('electron');
      expect(shell.openExternal).toHaveBeenCalled();
      const authUrl = (shell.openExternal as any).mock.calls[0][0];
      const parsedUrl = new URL(authUrl);
      const stateToken = parsedUrl.searchParams.get('state')!;
      const redirectUri = parsedUrl.searchParams.get('redirect_uri')!;
      const port = new URL(redirectUri).port;

      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/oauth2callback?error=access_denied&state=${stateToken}`, (res) => {
          resolve(res.statusCode);
        });
        req.on('error', reject);
      });

      const result = await flowPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('access_denied');
    });

    it('completes nominal authentication flow and returns account details (Happy Path)', async () => {
      // Mock HTTPS token exchange request to Google
      vi.spyOn(https, 'request').mockImplementation((_url: any, _options: any, callback: any) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;

        const req = new EventEmitter() as any;
        req.write = vi.fn();
        req.end = vi.fn(() => {
          callback(res);
          res.emit('data', JSON.stringify({
            access_token: 'ya29.valid-mock-token',
            refresh_token: '1//valid-refresh-token',
            expires_in: 3600,
          }));
          res.emit('end');
        });
        req.destroy = vi.fn();
        return req;
      });

      const flowPromise = startGoogleOAuthLogin('antigravity');
      await new Promise((r) => setTimeout(r, 60));

      const { shell } = await import('electron');
      const authUrl = (shell.openExternal as any).mock.calls[(shell.openExternal as any).mock.calls.length - 1][0];
      const parsedUrl = new URL(authUrl);
      const stateToken = parsedUrl.searchParams.get('state')!;
      const redirectUri = parsedUrl.searchParams.get('redirect_uri')!;
      const port = new URL(redirectUri).port;

      // Simulate browser returning authorization code
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/oauth2callback?code=mock_valid_code&state=${stateToken}`, (res) => {
          resolve(res.statusCode);
        });
        req.on('error', reject);
      });

      const result = await flowPromise;
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.account.email).toBe('google-user@gmail.com');
        expect(result.account.accessToken).toBe('ya29.valid-mock-token');
        expect(result.account.refreshToken).toBe('1//valid-refresh-token');
        expect(result.account.id).toBe('google-google-user-gmail-com');
      }
    });
  });
});
