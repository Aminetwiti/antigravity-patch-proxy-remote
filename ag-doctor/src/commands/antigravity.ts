/**
 * `ag-doctor antigravity <subcommand>` — manage the Antigravity install.
 *
 * Subcommands:
 *   status   — show install path, version, running PIDs, proxy reachability
 *   version  — print the detected version only
 *   launch   — start Antigravity (idempotent)
 *   kill     — terminate all Antigravity processes
 *   restart  — kill then launch
 */
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info, json as jsonOut } from '../cli/output';
import {
  detectAntigravityVersion,
  getAntigravityStatus,
  launchAntigravity,
  closeAntigravity,
  restartAntigravity,
} from '../core/antigravity';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST } from '../core/config';
import { runLogs } from './logs';

export async function runAntigravity(ctx: CommandContext, sub: string[], rest: string[]): Promise<number> {
  const subCmd = sub[0] ?? 'status';

  switch (subCmd) {
    case 'status':
      return await cmdStatus(ctx);
    case 'version':
      return await cmdVersion(ctx);
    case 'launch':
    case 'start':
      return await cmdLaunch(ctx);
    case 'kill':
    case 'stop':
    case 'close':
      return await cmdKill(ctx);
    case 'restart':
      return await cmdRestart(ctx);
    case 'launch-logs':
    case 'start-logs':
      return await cmdLaunchLogs(ctx);
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      return 0;
    default:
      error(`Unknown subcommand: ${subCmd}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`
${c.bold('ag-doctor antigravity')} — manage the Antigravity install

${c.cyan('Subcommands:')}
  ${c.green('status')}    Show install path, version, running PIDs, proxy reachability
  ${c.green('version')}   Print the detected Antigravity version
  ${c.green('launch')}    Start Antigravity (no-op if already running)
  ${c.green('kill')}          Terminate all Antigravity processes
  ${c.green('restart')}       Kill then launch
  ${c.green('launch-logs')}   Launch Antigravity and follow language_server logs

${c.cyan('Options:')}
  --json    Output machine-readable JSON
`);
}

async function cmdStatus(ctx: CommandContext): Promise<number> {
  const status = await getAntigravityStatus();
  if (ctx.json) {
    jsonOut(status);
    return status.installed ? 0 : 1;
  }

  header('ag-doctor — antigravity status');

  if (!status.installed) {
    error('Antigravity is not installed on this system');
    return 1;
  }

  ok(`Installed at ${c.cyan(status.installDir ?? '')}`);
  if (status.appAsar) info(`app.asar: ${status.appAsar}`);

  if (status.versionInfo) {
    ok(`Version: ${c.bold(status.versionInfo.version)} ${c.gray(`(source: ${status.versionInfo.source})`)}`);
    if (status.versionInfo.channel) info(`Channel/productName: ${status.versionInfo.channel}`);
  } else {
    warn('Version: unknown');
  }

  if (status.running) {
    ok(`Running: yes ${c.gray(`(pids: ${status.pids.join(', ')})`)}`);
  } else {
    warn('Running: no');
  }

  if (status.languageServerRunning) {
    ok(`language_server: running ${c.gray(`(pids: ${status.languageServerPids.join(', ')})`)}`);
  } else {
    info('language_server: not running');
  }

  if (status.proxyReachable) {
    ok(`Proxy: reachable on ${DEFAULT_BIND_HOST}:${status.proxyPort}`);
  } else {
    warn(`Proxy: NOT reachable on ${DEFAULT_BIND_HOST}:${status.proxyPort}`);
  }

  return 0;
}

async function cmdVersion(ctx: CommandContext): Promise<number> {
  const v = detectAntigravityVersion();
  if (!v) {
    error('Antigravity is not installed');
    return 1;
  }
  if (ctx.json) {
    jsonOut(v);
  } else {
    console.log(v.version);
  }
  return 0;
}

async function cmdLaunch(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('ag-doctor — launch antigravity');
  const r = await launchAntigravity();
  if (ctx.json) {
    jsonOut(r);
  } else if (r.ok) {
    ok(r.message);
  } else {
    error(r.message);
  }
  return r.ok ? 0 : 2;
}

async function cmdKill(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('ag-doctor — close antigravity');
  const r = await closeAntigravity();
  if (ctx.json) {
    jsonOut(r);
  } else if (r.killed === 0) {
    info(r.message);
  } else {
    ok(r.message);
  }
  return 0;
}

async function cmdRestart(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('ag-doctor — restart antigravity');
  const r = await restartAntigravity();
  if (ctx.json) {
    jsonOut(r);
  } else if (r.ok) {
    ok(r.message);
  } else {
    error(r.message);
  }
  return r.ok ? 0 : 2;
}

async function cmdLaunchLogs(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('ag-doctor — launch antigravity + follow logs');
  const launchRes = await launchAntigravity();
  if (ctx.json) {
    jsonOut({ launch: launchRes });
  } else if (launchRes.ok) {
    ok(launchRes.message);
  } else {
    error(launchRes.message);
  }
  if (!launchRes.ok) return 2;

  // Give the language_server a moment to create/rotate its log file
  await new Promise((r) => setTimeout(r, 1000));
  return await runLogs(ctx, { follow: true, lines: 50, source: 'language_server' });
}
