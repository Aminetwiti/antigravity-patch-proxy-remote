/**
 * Process management: find / kill / spawn Antigravity.
 *
 * Improvements over the original:
 *   - `isPortInUse` now has a hard timeout so it never hangs on firewalled hosts.
 *   - `killAntigravityProcesses` escalates to SIGKILL after a grace period on
 *     non-Windows platforms (Windows has no equivalent graceful signal).
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { getPlatform, isWsl } from './platform';
import { DEFAULT_BIND_HOST } from './config';

const execFileAsync = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  command: string;
}

/**
 * Known Antigravity process image names (Windows).
 * The classic desktop app runs as Antigravity.exe; the newer VS Code-based
 * "Antigravity IDE" runs as Antigravity IDE.exe. Both count as "running".
 */
const WINDOWS_IMAGE_NAMES = ['Antigravity.exe', 'Antigravity IDE.exe'];

/** Find running Antigravity processes. */
export async function findAntigravityProcesses(): Promise<ProcessInfo[]> {
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const results: ProcessInfo[] = [];
      for (const name of WINDOWS_IMAGE_NAMES) {
        const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']);
        results.push(...parseWindowsTasklist(stdout));
      }
      return results;
    }
    if (isWsl()) {
      // WSL can see Windows processes through tasklist.exe
      try {
        const results: ProcessInfo[] = [];
        for (const name of WINDOWS_IMAGE_NAMES) {
          const { stdout } = await execFileAsync('/mnt/c/Windows/System32/tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']);
          results.push(...parseWindowsTasklist(stdout));
        }
        return results;
      } catch {
        // fall through to pgrep
      }
    }
    if (platform === 'darwin' || platform === 'linux') {
      const { stdout } = await execFileAsync('pgrep', ['-af', 'Antigravity']);
      return parsePgrep(stdout);
    }
  } catch {
    // pgrep/tasklist exit 1 when nothing matches
  }
  return [];
}

function parseWindowsTasklist(stdout: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^"([^"]+\.exe)","(\d+)"/);
    if (m) out.push({ pid: parseInt(m[2], 10), command: m[1] });
  }
  return out;
}

function parsePgrep(stdout: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(.*)$/);
    if (m) out.push({ pid: parseInt(m[1], 10), command: m[2] });
  }
  return out;
}

/**
 * Kill all Antigravity processes.
 *
 * On non-Windows: send SIGTERM, wait briefly, then SIGKILL anything still alive.
 * On Windows: taskkill /T /F (tree + force) to ensure child processes die too.
 */
export async function killAntigravityProcesses(): Promise<{ killed: number }> {
  const procs = await findAntigravityProcesses();
  const platform = getPlatform();
  if (platform === 'win32' || isWsl()) {
    const taskkill = platform === 'win32' ? 'taskkill' : '/mnt/c/Windows/System32/taskkill.exe';
    for (const p of procs) {
      try {
        await execFileAsync(taskkill, ['/PID', String(p.pid), '/T', '/F'], platform === 'win32' ? { windowsHide: true } : undefined);
      } catch {
        // ignore — process may have already exited
      }
    }
    return { killed: procs.length };
  }
  for (const p of procs) {
    try {
      process.kill(p.pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
  // Grace period, then escalate.
  await new Promise((r) => setTimeout(r, 1500));
  const stillAlive = await findAntigravityProcesses();
  for (const p of stillAlive) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  return { killed: procs.length };
}

/**
 * Check if a TCP port is in use.
 *
 * Has a hard timeout (default 1500ms) so callers never hang on firewalled hosts.
 */
export async function isPortInUse(port: number, host = DEFAULT_BIND_HOST, timeoutMs = 1500): Promise<boolean> {
  const net = await import('net');
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host });
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/** Spawn a child process, inheriting stdio. */
export function spawnInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', reject);
  });
}

/**
 * Resolve the best runtime for the standalone proxy.
 *
 * Prefers a real Electron binary (bundled with ag-doctor-ui) so Electron's
 * safeStorage is available and DPAPI-encrypted API keys (`enc:`) can be
 * decrypted. Falls back to plain node, where the proxy runs with a mocked
 * safeStorage (only `fallback:`-style keys decrypt).
 */
export function resolveProxyRuntime(): { bin: string; args: string[]; isElectron: boolean } {
  const platform = getPlatform();
  if (platform === 'win32' || platform === 'linux' || platform === 'darwin') {
    const exeName = platform === 'win32' ? 'electron.exe' : 'electron';
    const candidates = [
      path.resolve(__dirname, '..', '..', '..', 'ag-doctor-ui', 'node_modules', 'electron', 'dist', exeName),
      path.resolve(__dirname, '..', '..', '..', 'node_modules', 'electron', 'dist', exeName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { bin: c, args: [], isElectron: true };
    }
  }
  return { bin: process.execPath, args: [], isElectron: false };
}

/**
 * Environment for a spawned proxy process. When running under Electron,
 * ELECTRON_RUN_AS_NODE must be cleared: some shells/agents set it globally,
 * and with it set, electron.exe behaves as plain node (no `electron` builtin,
 * no safeStorage) and the proxy cannot decrypt `enc:` keys.
 */
export function proxySpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
