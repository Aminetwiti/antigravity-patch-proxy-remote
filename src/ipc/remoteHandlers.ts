import { ipcMain } from 'electron';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import log from 'electron-log/main';
import { DEFAULT_REMOTE_HOST, DEFAULT_REMOTE_TOKEN } from '../constants';
import { atomicWriteJson, withWriteLock } from '../services/modelStore';
import { isPrivateOrLoopbackHost, isStrictLoopbackHost } from './connectionHandlers';
import { IPC_CHANNELS } from './channels';

export function registerRemoteHandlers(): void {
  // Test Remote daemon connectivity and authentication (bypasses browser CORS & TLS)
  ipcMain.handle(IPC_CHANNELS.REMOTE_TEST_HEALTH, async (_event, payload: { host: string; token?: string } | string) => {
    return new Promise<{ ok: boolean; status?: number; data?: Record<string, unknown>; error?: string }>((resolve) => {
      try {
        const rawHost = (typeof payload === 'string' ? payload : (payload && payload.host ? payload.host : '')).trim().replace(/\/+$/, '');
        const rawToken = (typeof payload === 'object' && payload && payload.token) ? payload.token.trim() : '';
        const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined') ? rawToken : DEFAULT_REMOTE_TOKEN;
        if (!rawHost) {
          resolve({ ok: false, error: 'URL ou hôte manquant' });
          return;
        }
        let raw = rawHost;
        if (!/^https?:\/\//i.test(raw)) {
          if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?$/i.test(raw) || (raw.includes(':') && !raw.endsWith(':443'))) {
            raw = `http://${raw}`;
          } else {
            raw = `https://${raw}`;
          }
        }
        const parsed = new URL(raw);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

        const healthReq = client.get(
          {
            hostname: parsed.hostname,
            port,
            path: '/health',
            timeout: 10000,
            rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
            headers: { 'User-Agent': 'Antigravity-Remote-Client/2.0' },
          },
          (healthRes: any) => {
            let healthBody = '';
            healthRes.on('data', (c: any) => { healthBody += c; });
            healthRes.on('end', () => {
              if (healthRes.statusCode < 200 || healthRes.statusCode >= 300) {
                resolve({ ok: false, status: healthRes.statusCode, error: `Erreur HTTP ${healthRes.statusCode}` });
                return;
              }
              let healthData: Record<string, unknown> = {};
              try {
                healthData = JSON.parse(healthBody);
              } catch (parseErr) {
                log.warn('[IPC:remote:check-health] Failed to parse health JSON response:', parseErr);
              }

              if (!token) {
                resolve({ ok: true, status: healthRes.statusCode, data: healthData });
                return;
              }

              // Probe /health/diagnostic first (validates token on Daemon)
              const authPath = `/health/diagnostic?token=${encodeURIComponent(token)}`;
              const authReq = client.get(
                {
                  hostname: parsed.hostname,
                  port,
                  path: authPath,
                  timeout: 10000,
                  rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
                  headers: {
                    'User-Agent': 'Antigravity-Remote-Client/2.0',
                    'Authorization': `Bearer ${token}`,
                  },
                },
                (authRes: any) => {
                  let authBody = '';
                  authRes.on('data', (c: any) => { authBody += c; });
                  authRes.on('end', () => {
                    if (authRes.statusCode === 401) {
                      resolve({ ok: false, status: 401, error: "Jeton d'authentification invalide (HTTP 401)" });
                    } else if (authRes.statusCode >= 200 && authRes.statusCode < 300) {
                      let authData: Record<string, unknown> = {};
                      try {
                        authData = JSON.parse(authBody);
                      } catch (parseErr) {
                        log.warn('[IPC:remote:check-health] Failed to parse auth diagnostic JSON:', parseErr);
                      }
                      resolve({ ok: true, status: 200, data: { ...healthData, ...authData, authenticated: true } });
                    } else {
                      // Fallback to /v2/sessions if diagnostic endpoint not found
                      resolve({ ok: true, status: 200, data: { ...healthData, authenticated: true } });
                    }
                  });
                }
              );
              authReq.on('error', (err: any) => {
                resolve({ ok: false, error: err.message || 'Échec vérification jeton' });
              });
              authReq.on('timeout', () => {
                authReq.destroy();
                resolve({ ok: false, error: "Délai d'attente dépassé (timeout vérification jeton)" });
              });
            });
          }
        );
        healthReq.on('error', (err: any) => {
          const isConnRefused = err.code === 'ECONNREFUSED';
          const msg = isConnRefused
            ? `Port ${port} fermé ou injoignable sur ${parsed.hostname}`
            : (err.message || 'Hôte injoignable');
          resolve({ ok: false, error: msg });
        });
        healthReq.on('timeout', () => {
          healthReq.destroy();
          resolve({ ok: false, error: 'Délai d\'attente dépassé (timeout)' });
        });
      } catch (err: any) {
        resolve({ ok: false, error: err.message || 'URL invalide' });
      }
    });
  });

  // Execute remote command on VPS daemon
  ipcMain.handle(IPC_CHANNELS.REMOTE_EXECUTE_COMMAND, async (_event, payload: { host?: string; token?: string; command: string; timeoutMs?: number }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<{ ok: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string }>((resolve) => {
      try {
        const rawHost = (payload?.host || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
        const rawToken = (payload?.token || '').trim();
        const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined') ? rawToken : DEFAULT_REMOTE_TOKEN;
        const command = (payload?.command || '').trim();
        const timeoutMs = payload?.timeoutMs || 15000;

        if (!command) {
          resolve({ ok: false, error: 'Commande manquante' });
          return;
        }

        const parsed = new URL(rawHost.startsWith('http') ? rawHost : `https://${rawHost}`);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

        const postData = JSON.stringify({ command, timeout_ms: timeoutMs });
        const req = client.request(
          {
            hostname: parsed.hostname,
            port,
            path: '/v2/terminal/exec',
            method: 'POST',
            timeout: timeoutMs,
            rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'Authorization': `Bearer ${token}`,
              'User-Agent': 'Antigravity-Remote-Client/2.0',
            },
          },
          (res: any) => {
            let body = '';
            res.on('data', (c: any) => { body += c; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const json = JSON.parse(body);
                  resolve({
                    ok: true,
                    stdout: json.stdout ?? '',
                    stderr: json.stderr ?? '',
                    exitCode: json.exit_code ?? 0,
                  });
                } catch {
                  resolve({ ok: false, error: 'Format de réponse invalide' });
                }
              } else {
                resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body}` });
              }
            });
          }
        );
        req.on('error', (err: any) => resolve({ ok: false, error: err.message || 'Erreur réseau' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
        req.write(postData);
        req.end();
      } catch (err: any) {
        resolve({ ok: false, error: err.message || 'Erreur exécution' });
      }
    });
  });

  // List sessions from remote VPS daemon (/v2/sessions)
  ipcMain.handle(IPC_CHANNELS.REMOTE_LIST_SESSIONS, async (_event, payload?: { host?: string; token?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<{ ok: boolean; sessions?: any[]; error?: string }>((resolve) => {
      try {
        const rawHost = (payload?.host || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
        const rawToken = (payload?.token || '').trim();
        const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined') ? rawToken : DEFAULT_REMOTE_TOKEN;
        const parsed = new URL(rawHost.startsWith('http') ? rawHost : `https://${rawHost}`);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

        const req = client.get(
          {
            hostname: parsed.hostname,
            port,
            path: `/v2/sessions?token=${encodeURIComponent(token)}`,
            timeout: 10000,
            rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
            headers: {
              'User-Agent': 'Antigravity-Remote-Client/2.0',
              'Authorization': `Bearer ${token}`,
            },
          },
          (res: any) => {
            let body = '';
            res.on('data', (c: any) => { body += c; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const json = JSON.parse(body);
                  resolve({ ok: true, sessions: json.sessions || (Array.isArray(json) ? json : []) });
                } catch {
                  resolve({ ok: false, error: 'JSON invalide' });
                }
              } else {
                resolve({ ok: false, error: `HTTP ${res.statusCode}` });
              }
            });
          }
        );
        req.on('error', (err: any) => resolve({ ok: false, error: err.message || 'Erreur réseau' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      } catch (e: any) {
        resolve({ ok: false, error: e.message || 'Erreur requête' });
      }
    });
  });

  // Create autonomous session on remote VPS daemon (POST /v2/sessions)
  ipcMain.handle(IPC_CHANNELS.REMOTE_CREATE_SESSION, async (_event, payload?: { host?: string; token?: string; title?: string; workspaceId?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<{ ok: boolean; session?: any; error?: string }>((resolve) => {
      try {
        const rawHost = (payload?.host || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
        const rawToken = (payload?.token || '').trim();
        const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined') ? rawToken : DEFAULT_REMOTE_TOKEN;
        const title = payload?.title || 'Nouvelle tâche distante';
        const workspaceId = payload?.workspaceId || '';
        const parsed = new URL(rawHost.startsWith('http') ? rawHost : `https://${rawHost}`);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

        const postData = JSON.stringify({ title, workspaceId });
        const req = client.request(
          {
            hostname: parsed.hostname,
            port,
            path: `/v2/sessions?token=${encodeURIComponent(token)}`,
            method: 'POST',
            timeout: 10000,
            rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'Authorization': `Bearer ${token}`,
              'User-Agent': 'Antigravity-Remote-Client/2.0',
            },
          },
          (res: any) => {
            let body = '';
            res.on('data', (c: any) => { body += c; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const json = JSON.parse(body);
                  resolve({ ok: true, session: json });
                } catch {
                  resolve({ ok: false, error: 'JSON invalide' });
                }
              } else {
                resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body}` });
              }
            });
          }
        );
        req.on('error', (err: any) => resolve({ ok: false, error: err.message || 'Erreur réseau' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
        req.write(postData);
        req.end();
      } catch (e: any) {
        resolve({ ok: false, error: e.message || 'Erreur requête' });
      }
    });
  });

  // Get remote workspaces on VPS daemon (GET /v2/workspaces)
  ipcMain.handle(IPC_CHANNELS.REMOTE_GET_WORKSPACES, async (_event, payload?: { host?: string; token?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<{ ok: boolean; workspaces?: any[]; error?: string }>((resolve) => {
      try {
        const rawHost = (payload?.host || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
        const rawToken = (payload?.token || '').trim();
        const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined') ? rawToken : DEFAULT_REMOTE_TOKEN;
        const parsed = new URL(rawHost.startsWith('http') ? rawHost : `https://${rawHost}`);
        const client = parsed.protocol === 'https:' ? https : http;
        const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);

        const req = client.get(
          {
            hostname: parsed.hostname,
            port,
            path: `/v2/workspaces?token=${encodeURIComponent(token)}`,
            timeout: 10000,
            rejectUnauthorized: ((payload as any)?.allowUnauthorized && isPrivateOrLoopbackHost(parsed.hostname)) || isStrictLoopbackHost(parsed.hostname) ? false : true,
            headers: {
              'User-Agent': 'Antigravity-Remote-Client/2.0',
              'Authorization': `Bearer ${token}`,
            },
          },
          (res: any) => {
            let body = '';
            res.on('data', (c: any) => { body += c; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const json = JSON.parse(body);
                  resolve({ ok: true, workspaces: json.workspaces || (Array.isArray(json) ? json : []) });
                } catch {
                  resolve({ ok: true, workspaces: [] });
                }
              } else {
                resolve({ ok: false, error: `HTTP ${res.statusCode}` });
              }
            });
          }
        );
        req.on('error', (err: any) => resolve({ ok: false, error: err.message || 'Erreur réseau' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      } catch (e: any) {
        resolve({ ok: false, error: e.message || 'Erreur requête' });
      }
    });
  });

  // Save / update remote VPS runtime state (active, host, token, remoteSessions)
  ipcMain.handle(IPC_CHANNELS.REMOTE_SET_STATE, async (_event, payload: { active?: boolean; host?: string; token?: string; remoteSessions?: Record<string, boolean> }) => {
    return withWriteLock(async () => {
      try {
        const os = require('os');
        const nodeFs = require('fs');
        const dir = path.join(os.homedir(), '.gemini', 'antigravity');
        if (!nodeFs.existsSync(dir)) {
          nodeFs.mkdirSync(dir, { recursive: true });
        }
        const p = path.join(dir, 'remote_vps_state.json');
        let current: Record<string, unknown> = {};
        if (nodeFs.existsSync(p)) {
          try {
            const raw = nodeFs.readFileSync(p, 'utf-8').trim();
            if (raw) current = JSON.parse(raw);
          } catch (err) {
            log.warn('[IPC] Failed to parse remote_vps_state.json:', err);
          }
        }
        const rawToken = payload.token ? String(payload.token).trim() : '';
        const finalToken = (rawToken && rawToken !== 'null' && rawToken !== 'undefined')
          ? rawToken
          : (current.token ? String(current.token) : DEFAULT_REMOTE_TOKEN);

        const updated = {
          ...current,
          ...(payload.active !== undefined ? { active: payload.active } : {}),
          ...(payload.host !== undefined ? { host: payload.host } : {}),
          token: finalToken,
          ...(payload.remoteSessions !== undefined ? { remoteSessions: { ...((current.remoteSessions as Record<string, boolean>) || {}), ...payload.remoteSessions } } : {}),
        };
        await atomicWriteJson(p, updated);
        log.info(`[IPC] remote:set-state updated: active=${updated.active}, host=${updated.host}, tokenSet=${!!updated.token}`);
        return { ok: true, state: updated };
      } catch (err: any) {
        log.warn('[IPC] remote:set-state error:', err);
        return { ok: false, error: err.message || 'Erreur sauvegarde' };
      }
    });
  });

  // Get current remote VPS runtime state
  ipcMain.handle(IPC_CHANNELS.REMOTE_GET_STATE, async () => {
    try {
      const os = require('os');
      const nodeFs = require('fs');
      const p = path.join(os.homedir(), '.gemini', 'antigravity', 'remote_vps_state.json');
      if (nodeFs.existsSync(p)) {
        const raw = nodeFs.readFileSync(p, 'utf-8').trim();
        if (raw) {
          const state = JSON.parse(raw);
          if (!state.token || state.token === 'null' || state.token === 'undefined') {
            state.token = DEFAULT_REMOTE_TOKEN;
          }
          return { ok: true, state };
        }
      }
      return { ok: true, state: { active: true, host: DEFAULT_REMOTE_HOST, token: DEFAULT_REMOTE_TOKEN, remoteSessions: {} } };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Erreur lecture' };
    }
  });
}
