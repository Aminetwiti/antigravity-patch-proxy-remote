import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { CheckResult } from '../types';
import { probe } from '../core/probe';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST } from '../core/config';

/**
 * Locate the standalone proxy stub shipped with this repo.
 * The stub lives at ag-doctor/scripts/proxy/proxy-stub.js (same location
 * `ag-doctor proxy start` uses). The old repo-root and cwd candidates never
 * matched, so the doctor's stub self-heal silently always failed — keep them
 * only as legacy fallbacks.
 */
export function findProxyStubScript(): string | null {
  const candidates = [
    // ag-doctor/dist/checks → up 2 → ag-doctor/scripts/proxy/proxy-stub.js
    path.resolve(__dirname, '..', '..', 'scripts', 'proxy', 'proxy-stub.js'),
    path.resolve(__dirname, '..', '..', '..', 'proxy-stub.js'),
    path.resolve(process.cwd(), 'proxy-stub.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Start the emergency proxy stub (proxy-stub.js) as a detached process.
 * This is the documented fallback when Antigravity is not running — it makes
 * the configured proxy port answer so the patched language server can initialise. The real
 * proxy (inside the repacked app.asar) takes over when Antigravity launches.
 *
 * Returns true only if the stub process was spawned AND the health endpoint
 * responds within the timeout. A spawn success alone is not enough — the
 * stub can crash immediately (port in use, bad args, etc.).
 */
async function startProxyStub(port: number): Promise<boolean> {
  try {
    const script = findProxyStubScript();
    if (!script) return false;
    const child = spawn(process.execPath, [script, String(port)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 1500));
    const health = `http://${DEFAULT_BIND_HOST}:${port}/health`;
    const result = await probe(health, 2000);
    return result.ok;
  } catch {
    return false;
  }
}

function isRefusedError(error: string | undefined): boolean {
  const e = (error ?? '').toLowerCase();
  return e.includes('econnrefused') || e.includes('actively refused') || e.includes('connection refused');
}

export async function checkProxy(port = DEFAULT_MITM_PORT): Promise<CheckResult> {
  const health = `http://${DEFAULT_BIND_HOST}:${port}/health`;
  const result = await probe(health, 2000);

  if (!result.ok) {
    // Self-heal: when nothing is listening, bring up the emergency stub so the
    // port answers, then re-probe. This keeps the diagnostic green while
    // Antigravity is closed, without requiring the user to run the stub
    // manually (the check itself used to instruct them to do exactly that).
    if (isRefusedError(result.error)) {
      const started = await startProxyStub(port);
      if (started) {
        return {
          id: 'proxy',
          title: 'Local proxy',
          status: 'ok',
          message: `Reachable on http://${DEFAULT_BIND_HOST}:${port} — stub auto-started by ag-doctor`,
          details: [
            'Antigravity is not running, so ag-doctor started the emergency proxy stub.',
            `The stub keeps port ${DEFAULT_MITM_PORT} answering so the patched language server can initialise.`,
            `NOTE: the stub does not inject custom models, and it will block the real proxy`,
            `from binding ${DEFAULT_MITM_PORT}. Before launching Antigravity, replace it with the real proxy:`,
            '  ag-doctor proxy start   (kills the stub and starts the real proxy)',
          ].join('\n'),
          fixable: false,
        };
      }
    }

    return {
      id: 'proxy',
      title: 'Local proxy',
      status: 'warn',
      message: `Not reachable on port ${port}: ${result.error ?? 'unknown'}`,
      details: isRefusedError(result.error)
        ? 'Port is closed — Antigravity may not be running and the proxy stub could not be started. Launch Antigravity or run `ag-doctor proxy stub` as a temporary workaround.'
        : 'The proxy starts automatically when Antigravity launches.',
      fixable: false,
      data: result,
    };
  }

  // Check if this is the stub proxy (emergency fallback) rather than the real one
  const isStub = result.headers?.['x-proxy-stub'] === '1';

  if (isStub) {
    return {
      id: 'proxy',
      title: 'Local proxy',
      status: 'ok',
          message: `Reachable on http://${DEFAULT_BIND_HOST}:${port} (${result.latencyMs}ms) — stub fallback active`,
      details: [
        `The proxy stub is serving on port ${DEFAULT_MITM_PORT} (emergency fallback; no model injection).`,
        'To enable full proxy support, run repack.ps1 to update the bundled app.asar:',
        '  .\\repack.ps1',
        'Then restart Antigravity. The stub can remain running as a fallback.',
      ].join('\n'),
      fixable: false,
      data: result,
    };
  }

  return {
    id: 'proxy',
    title: 'Local proxy',
    status: 'ok',
    message: `Reachable on http://${DEFAULT_BIND_HOST}:${port} (${result.latencyMs}ms)`,
    data: result,
  };
}
