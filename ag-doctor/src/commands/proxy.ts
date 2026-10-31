/**
 * `ag-doctor proxy` — manage the standalone local proxy.
 *
 * Subcommands:
 *   status      Show proxy status (real or stub, with PID)
 *   start       Start the proxy in standalone mode (auto-fallback to stub)
 *   stop        Stop the standalone proxy
 *   stub        Force-start the proxy stub (emergency fallback)
 *   restart     Stop + start
 *
 * Fixes scenarios:
 *   - #15: Port refused (real proxy crashes silently)
 *   - #14: Port already in use (kill stale instance)
 *   - #21: IPv4/IPv6 mismatch (forced IPv4 in stub)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info } from '../cli/output';
import { loadConfig, DEFAULT_BIND_HOST } from '../core/config';
import { isPortInUse, killAntigravityProcesses, resolveProxyRuntime, proxySpawnEnv } from '../core/process';
import { probe } from '../core/probe';
import { Spinner } from '../cli/spinner';

const execFileAsync = promisify(execFile);

const USAGE = `ag-doctor proxy — manage the standalone local proxy

Usage:
  ag-doctor proxy status          Show standalone proxy status
  ag-doctor proxy start           Start the real proxy (auto-fallback to stub)
  ag-doctor proxy stub            Start the proxy stub (emergency fallback)
  ag-doctor proxy stop            Stop the standalone proxy
  ag-doctor proxy restart         Stop + start
  ag-doctor proxy --help          Show this help

Options:
  --port <N>     Override the proxy port (default: from config)
  --no-stub      Disable stub fallback (start will fail if real proxy fails)
`;

export interface ProxyStatus {
  port: number;
  reachable: boolean;
  isStub: boolean;
  pid: number | null;
  error: string | null;
}

export async function runProxy(ctx: CommandContext, sub: string | undefined): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(USAGE);
    return 0;
  }

  const opts = ctx.options ?? {};
  const port = Number(opts.port) || loadConfig().mitmPort;
  const noStub = Boolean(opts['no-stub']);

  switch (sub) {
    case 'status':
      return await runStatus(ctx, port);
    case 'start':
      return await runStart(ctx, 'standalone-proxy-runner.js', port, noStub);
    case 'stub':
      return await runStart(ctx, 'proxy-stub.js', port, true);
    case 'stop':
      return await runStop(ctx, port);
    case 'restart':
      return (await runStop(ctx, port)) || (await runStart(ctx, 'standalone-proxy-runner.js', port, noStub));
    default:
      error(`Unknown proxy subcommand: ${sub}`);
      console.log(USAGE);
      return 2;
  }
}

async function runStatus(ctx: CommandContext, port: number): Promise<number> {
  if (!ctx.json) header('Proxy status');
  const status = await getProxyStatus(port);

  if (ctx.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(`  Port:           ${status.port}`);
    console.log(`  Reachable:      ${status.reachable ? c.green('yes') : c.red('no')}`);
    console.log(`  Type:           ${status.isStub ? c.yellow('stub (fallback)') : c.green('real proxy')}`);
    console.log(`  PID:            ${status.pid ?? c.gray('—')}`);
    if (status.error) console.log(`  Error:          ${c.red(status.error)}`);
  }
  return status.reachable ? 0 : 1;
}

async function runStart(ctx: CommandContext, scriptName: string, port: number, noStub = false): Promise<number> {
  if (!ctx.json) header(`Proxy — start (${scriptName})`);
  const status = await getProxyStatus(port);

  if (status.reachable) {
    if (status.isStub) {
      // A leftover stub holds the port (e.g. auto-started by `ag-doctor doctor`).
      // If we returned here, the real proxy would hit EADDRINUSE and fall back to
      // another port while the patched language server still dials the default proxy port —
      // silently losing model injection. Kill the stub and start the real proxy.
      if (!ctx.json) warn('Port is held by a proxy stub — replacing it with the real proxy');
      const killed = await killPid(status.pid);
      if (!killed) {
        if (!ctx.json) error('Could not kill the stub holding the port; run `ag-doctor proxy stop` first');
        return 2;
      }
      // Give the port a moment to be released before binding.
      await new Promise((r) => setTimeout(r, 500));
    } else {
      if (!ctx.json) info(`Port ${port} already in use by the real proxy (pid=${status.pid ?? '?'})`);
      return 0;
    }
  }

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'proxy', scriptName);
  if (!fs.existsSync(scriptPath)) {
    // Try fallback: ag-doctor/bin/stub-proxy.js
    const altPath = path.join(__dirname, '..', '..', 'bin', 'stub-proxy.js');
    if (fs.existsSync(altPath)) {
      return await spawnDetached(altPath, [String(port)], port, ctx, noStub);
    }
    error(`Script not found: ${scriptPath}`);
    return 2;
  }

  return await spawnDetached(scriptPath, [], port, ctx, noStub);
}

/** Best-effort kill of a single PID (taskkill on Windows, signal elsewhere). */
async function killPid(pid: number | null): Promise<boolean> {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/** Spawn a detached proxy process and wait for the port to become reachable. */
async function spawnDetached(scriptPath: string, args: string[], port: number, ctx: CommandContext, noStub: boolean): Promise<number> {
  if (!ctx.json) info(`Spawning detached proxy process: ${scriptPath}`);

  const sp = ctx.json ? null : new Spinner('Starting proxy');
  if (sp) sp.start();

  try {
    const runtime = resolveProxyRuntime();
    const proc = spawn(runtime.bin, [...runtime.args, scriptPath, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...proxySpawnEnv(),
        AG_PROXY_PORT: String(port),
        AG_STUB_PORT: String(port),
      },
    });
    proc.unref();

    // Wait up to 5s for the port to become reachable
    const reachable = await waitForPort(port, 5000);
    if (reachable) {
      if (sp) sp.succeed(`Proxy started on port ${port} (pid=${proc.pid})`);
      else ok(`Proxy started (pid=${proc.pid})`);
      return 0;
    }

    if (sp) sp.fail(`Proxy did not start within 5s (pid=${proc.pid})`);
    if (noStub) return 2;

    // Auto-fallback: try the stub if real proxy failed
    if (!scriptPath.endsWith('stub-proxy.js') && !scriptPath.endsWith('proxy-stub.js')) {
      warn('Real proxy failed to start — falling back to stub');
      return await runStart(ctx, 'proxy-stub.js', port, true);
    }
    return 2;
  } catch (err) {
    if (sp) sp.fail(`Spawn error: ${(err as Error).message}`);
    else error(`Spawn error: ${(err as Error).message}`);
    return 1;
  }
}

export async function runStop(ctx: CommandContext, port: number): Promise<number> {
  if (!ctx.json) header('Proxy — stop');
  const status = await getProxyStatus(port);

  if (!status.reachable) {
    if (!ctx.json) info(`Port ${port} is already free.`);
    return 0;
  }

  if (!ctx.json) info(`Port ${port} is in use (pid=${status.pid ?? '?'}). Killing...`);

  // Try PID-based kill first
  if (status.pid) {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/F', '/PID', String(status.pid)], { windowsHide: true });
      } else {
        process.kill(status.pid, 'SIGTERM');
      }
      ok(`Killed pid=${status.pid}`);
      return 0;
    } catch (e) {
      warn(`PID kill failed: ${(e as Error).message}`);
    }
  }

  // Fallback: kill by port
  const r = await killAntigravityProcesses();
  if (r.killed > 0) {
    ok(`Killed ${r.killed} process(es). Proxy should be stopped.`);
  } else {
    warn('Could not cleanly kill processes holding the port. You may need to kill node.exe manually.');
  }

  return 0;
}

/** Check what's listening on the proxy port. */
export async function getProxyStatus(port: number): Promise<ProxyStatus> {
  const result: ProxyStatus = {
    port,
    reachable: false,
    isStub: false,
    pid: null,
    error: null,
  };

  // Probe the port (use /health to detect stub via header)
  const r = await probe(`http://${DEFAULT_BIND_HOST}:${port}/health`, 1500);
  result.reachable = r.ok;
  result.error = r.error ?? null;

  // Detect stub via X-Proxy-Stub header
  if (r.headers && r.headers['x-proxy-stub'] === '1') {
    result.isStub = true;
  }

  // Try to get PID via platform-specific method
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`,
      ], { windowsHide: true });
      const pid = parseInt(stdout.trim(), 10);
      if (Number.isFinite(pid)) result.pid = pid;
    } else {
      const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN']);
      const pid = parseInt(stdout.trim().split('\n')[0] ?? '', 10);
      if (Number.isFinite(pid)) result.pid = pid;
    }
  } catch {
    // PID lookup is best-effort
  }

  return result;
}

/** Poll the port until it's reachable or timeout. */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await probe(`http://${DEFAULT_BIND_HOST}:${port}/health`, 500);
    if (r.ok) return true;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return false;
}
