import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import { DEFAULT_REMOTE_HOST, DEFAULT_REMOTE_TOKEN } from '../../../constants';

// ─── Remote State Types & State ──────────────────────────────────────────────

export interface TokenUsageEvent {
  id: string;
  timestamp: number;
  conversationId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  latencyMs?: number;
  status?: number;
  endpoint?: string;
}

export let isRemoteVpsActive = false;
export let remoteVpsHost = DEFAULT_REMOTE_HOST;
export let remoteVpsToken = DEFAULT_REMOTE_TOKEN;
export let remoteSessionsMap: Record<string, boolean> = {};

let tokenEventsPathCache: string | null = null;
let lastRemoteStateSummary = '';

export function getIsRemoteVpsActive(): boolean {
  return isRemoteVpsActive;
}

export function setIsRemoteVpsActive(val: boolean): void {
  isRemoteVpsActive = val;
}

export function getRemoteVpsHost(): string {
  return remoteVpsHost;
}

export function setRemoteVpsHost(val: string): void {
  remoteVpsHost = val;
}

export function getRemoteVpsToken(): string {
  return remoteVpsToken;
}

export function setRemoteVpsToken(val: string): void {
  remoteVpsToken = val;
}

export function getRemoteSessionsMap(): Record<string, boolean> {
  return remoteSessionsMap;
}

export function setRemoteSessionActive(sessionId: string, active: boolean): void {
  if (sessionId) {
    remoteSessionsMap[sessionId] = active;
  }
}

export function isSessionRemoteActive(sessionId?: string): boolean {
  if (!isRemoteVpsActive) return false;
  if (!sessionId) return false;
  return Boolean(remoteSessionsMap[sessionId]);
}

export function updateRemoteVpsConfig(updates: {
  active?: boolean;
  host?: string;
  token?: string;
  remoteSessions?: Record<string, boolean>;
}): void {
  if (updates.active !== undefined) isRemoteVpsActive = !!updates.active;
  if (updates.host) remoteVpsHost = String(updates.host);
  if (updates.token && updates.token !== 'null' && updates.token !== 'undefined' && String(updates.token).trim().length > 0) {
    remoteVpsToken = String(updates.token).trim();
  }
  if (updates.remoteSessions && typeof updates.remoteSessions === 'object') {
    remoteSessionsMap = { ...remoteSessionsMap, ...updates.remoteSessions };
  }
  saveRemoteState();
}

export const remoteVpsState = {
  get active() { return isRemoteVpsActive; },
  set active(val: boolean) { isRemoteVpsActive = val; },
  get host() { return remoteVpsHost; },
  set host(val: string) { remoteVpsHost = val; },
  get token() { return remoteVpsToken; },
  set token(val: string) { remoteVpsToken = val; },
  get remoteSessions() { return remoteSessionsMap; },
  set remoteSessions(val: Record<string, boolean>) { remoteSessionsMap = val; },
};

export function getRemoteStatePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      log.warn('[Proxy] Failed to create ~/.gemini/antigravity dir:', e);
    }
  }
  return path.join(dir, 'remote_vps_state.json');
}

export function getTokenEventsLogPath(): string {
  if (!tokenEventsPathCache) {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const dir = path.join(home, '.gemini', 'antigravity');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    tokenEventsPathCache = path.join(dir, 'token_usage_events.jsonl');
  }
  return tokenEventsPathCache;
}

export function logTokenUsageEvent(event: TokenUsageEvent): void {
  try {
    const logPath = getTokenEventsLogPath();
    const line = JSON.stringify(event) + '\n';
    fs.appendFile(logPath, line, (err) => {
      if (err) {
        log.debug('[Proxy] Could not append to token_usage_events.jsonl:', err.message);
      }
    });
  } catch (_err) {
    // Non-critical logging failure should never crash the proxy
  }
}

export function ensureRemoteExecScriptOnDisk(): void {
  try {
    const targetDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, 'remote-exec.js');
    const candidates = [
      path.resolve(__dirname, '../scripts/remote-exec.js'),
      path.resolve(__dirname, '../../scripts/remote-exec.js'),
      path.resolve(__dirname, '../../../scripts/remote-exec.js'),
      path.resolve(__dirname, 'scripts/remote-exec.js'),
    ];
    for (const src of candidates) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, targetPath);
        break;
      }
    }
  } catch (e) {
    log.warn('[Proxy] Could not sync remote-exec.js to ~/.gemini/antigravity/scripts:', e);
  }
}

export function loadRemoteState(): void {
  try {
    ensureRemoteExecScriptOnDisk();
    const p = getRemoteStatePath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8').trim();
      if (!raw) return;
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch (jsonErr) {
        // Self-heal: extract outermost JSON object if corrupted trailing characters were present
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            data = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
            log.info('[Proxy] Self-healed corrupted remote VPS state file.');
          } catch {
            log.warn('[Proxy] Unrecoverable remote VPS state file syntax:', jsonErr);
            return;
          }
        } else {
          return;
        }
      }

      if (typeof data.active === 'boolean') {
        isRemoteVpsActive = data.active;
      } else if (typeof data.isRemoteVpsActive === 'boolean') {
        isRemoteVpsActive = data.isRemoteVpsActive;
      }

      if (data.host) {
        remoteVpsHost = String(data.host);
      } else if (data.remoteVpsHost) {
        remoteVpsHost = String(data.remoteVpsHost);
      }

      const rawTok = data.token ?? data.remoteVpsToken;
      if (rawTok && rawTok !== 'null' && rawTok !== 'undefined' && String(rawTok).trim().length > 0) {
        remoteVpsToken = String(rawTok).trim();
      } else {
        remoteVpsToken = DEFAULT_REMOTE_TOKEN;
      }

      if (data.remoteSessions && typeof data.remoteSessions === 'object') {
        remoteSessionsMap = data.remoteSessions;
      } else if (data.remoteSessionsMap && typeof data.remoteSessionsMap === 'object') {
        remoteSessionsMap = data.remoteSessionsMap;
      }

      const remoteSummary = `active=${isRemoteVpsActive}, host=${remoteVpsHost}, tokenSet=${!!remoteVpsToken}, remoteSessionsCount=${Object.keys(remoteSessionsMap).length}`;
      if (remoteSummary !== lastRemoteStateSummary) {
        lastRemoteStateSummary = remoteSummary;
        log.debug(`[Proxy] Loaded Remote VPS state: ${remoteSummary}`);
      }
    }
  } catch (e) {
    log.warn('[Proxy] Failed to load remote VPS state from disk:', e);
  }
}

export function saveRemoteState(): void {
  try {
    const p = getRemoteStatePath();
    const tmpPath = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    const content = JSON.stringify({
      active: isRemoteVpsActive,
      host: remoteVpsHost,
      token: remoteVpsToken || DEFAULT_REMOTE_TOKEN,
      remoteSessions: remoteSessionsMap,
    }, null, 2);
    fs.writeFileSync(tmpPath, content, 'utf-8');
    try {
      fs.renameSync(tmpPath, p);
    } catch {
      // Fallback for Windows cross-device or temporary file-lock edge cases
      fs.copyFileSync(tmpPath, p);
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (e) {
    log.warn('[Proxy] Failed to save remote VPS state to disk:', e);
  }
}

export async function executeOnRemoteDaemon(
  rawHost: string,
  token: string,
  command: string,
  workspaceId?: string,
  sessionId?: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> {
  let cleanHost = (rawHost || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
  if (!cleanHost.startsWith('http://') && !cleanHost.startsWith('https://')) {
    cleanHost = 'https://' + cleanHost;
  }
  const url = new URL(cleanHost + '/v2/terminal/exec');
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const payload = JSON.stringify({
    command,
    workspaceId: (workspaceId && workspaceId !== 'default') ? workspaceId : 'antigravity-add-model-main',
    sessionId: sessionId || '',
    timeoutMs,
  });

  return new Promise((resolve) => {
    let settled = false;
    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token || DEFAULT_REMOTE_TOKEN}`,
          'User-Agent': 'AntigravityPatchProxy/3.8.2',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            const data = JSON.parse(raw);
            resolve(data);
          } catch (e) {
            const raw = Buffer.concat(chunks).toString('utf-8');
            resolve({
              ok: res.statusCode === 200,
              stdout: raw,
              stderr: '',
              exitCode: res.statusCode === 200 ? 0 : 1,
            });
          }
        });
      },
    );

    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({
        ok: false,
        stdout: '',
        stderr: `Remote daemon exec timed out after ${timeoutMs}ms`,
        exitCode: 124,
        error: 'timeout',
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        stdout: '',
        stderr: `Remote daemon network error: ${err.message}`,
        exitCode: -1,
        error: err.message,
      });
    });

    req.write(payload);
    req.end();
  });
}
