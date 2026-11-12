/**
 * Remote VPS Agent session state persistence module.
 * Provides non-blocking atomic file persistence to prevent event-loop latency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

export interface RemoteState {
  active: boolean;
  host: string;
  token: string;
  remoteSessions: Record<string, boolean>;
}

export function getDefaultRemoteStatePath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.gemini', 'antigravity', 'remote_state.json');
}

/**
 * Persists remote state asynchronously with atomic rename to avoid blocking the event loop.
 */
export async function saveRemoteStateAsync(state: RemoteState, customPath?: string): Promise<void> {
  const p = customPath || getDefaultRemoteStatePath();
  const dir = path.dirname(p);
  const tmpPath = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  const content = JSON.stringify(state, null, 2);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    try {
      await fs.promises.rename(tmpPath, p);
    } catch {
      // Fallback for Windows cross-device or temporary file-lock edge cases
      await fs.promises.copyFile(tmpPath, p);
      try { await fs.promises.unlink(tmpPath); } catch (_) {}
    }
  } catch (e) {
    log.warn('[Proxy] Failed to save remote VPS state to disk asynchronously:', e);
    try { await fs.promises.unlink(tmpPath); } catch (_) {}
  }
}

/**
 * Synchronous version for startup or process exit where async event loop cannot run.
 */
export function saveRemoteStateSync(state: RemoteState, customPath?: string): void {
  const p = customPath || getDefaultRemoteStatePath();
  const dir = path.dirname(p);
  const tmpPath = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  const content = JSON.stringify(state, null, 2);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, content, 'utf-8');
    try {
      fs.renameSync(tmpPath, p);
    } catch {
      fs.copyFileSync(tmpPath, p);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } catch (e) {
    log.warn('[Proxy] Failed to save remote VPS state to disk synchronously:', e);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}
