#!/usr/bin/env node
/**
 * ag-doctor — entry point.
 * Routes argv to the right command module.
 */
import { parseArgs } from './cli/parser';
import type { CommandContext } from './types';
import { c } from './cli/output';

import { runDoctor } from './commands/doctor';
import { runCheck } from './commands/check';
import { runRepair } from './commands/repair';
import { runRepairAsar, runCheckAsar } from './commands/repair-asar';
import { runModelsList } from './commands/models/list';
import { runModelsAdd } from './commands/models/add';
import { runModelsRemove } from './commands/models/remove';
import { runModelsRekey } from './commands/models/rekey';
import { runModelsTest } from './commands/models/test';
import { runModelsFetch } from './commands/models/fetch';
import { runPatchStatus } from './commands/patch/status';
import { runPatchApply } from './commands/patch/apply';
import { runPatchRestore } from './commands/patch/restore';
import { runPatchSelect } from './commands/patch/select';
import { runLogs } from './commands/logs';
import { runUpdate } from './commands/update';
import { runInfo } from './commands/info';
import { runMitm } from './commands/mitm';
import { runProxy } from './commands/proxy';
import { runConfig } from './commands/config';
import { runSnapshot } from './commands/snapshot';
import { runHistory } from './commands/history';
import { runNet } from './commands/net';
import { runMonitor } from './commands/monitor';
import { runCrashes } from './commands/crashes';
import { runSelftest } from './commands/selftest';
import { runPlugins } from './commands/plugins';
import { runServe } from './commands/serve';
import { runProfile } from './commands/profile';
import { runDaemon } from './commands/daemon';
import { runAntigravity } from './commands/antigravity';
import { getActiveProfile, resolveActiveProfile } from './core/profile';

const USAGE = `ag-doctor — Antigravity diagnostic & management CLI

Usage:
  ag-doctor [command] [options]

Commands:
  (default)              Run full diagnostic (alias for 'doctor')
  doctor                 Full diagnostic with details
  doctor --watch         Re-run diagnostic periodically (Ctrl+C to stop)
  doctor --report <f>    Write a report (html/md/json) to <f>
  check                  Quick health check (exit code only)
  repair [--yes]         Auto-fix detected issues (snapshots first)
  repair-asar [--yes] [--from <path>] [--dry-run]
                         Detect & restore a corrupted app.asar
  check-asar             Read-only app.asar integrity report (JSON-friendly)
  models list            List configured custom models
  models add             Interactive model creation
  models remove <name>   Delete a model (snapshots first)
  models rekey           Re-enter API keys encrypted by the language server (v10)
  models test [name]     Test connectivity for one or all models
  models fetch           Query /v1/models for a provider and list available models
  patch status           Show binary patch state
  patch apply            Apply the binary patch (snapshots first)
  patch restore          Restore language_server from backup (snapshots first)
  patch select <range|auto>
                         Force a patch range or return to auto-detect
  logs [-f] [-n N] [--source S] [--level L] [--clear] [--clear-all] [--stats]
                         Show/follow/filter/clear logs (levels: error|warn|info|all)
  mitm {status|install|uninstall|proxy-on|proxy-off|export-ca}
                         Manage MITM CA cert and system proxy
  proxy {status|start|stop|stub}
                         Manage standalone local proxy
  config {list|get|set|reset|path}
                         Manage persistent settings
  snapshot {list|create|restore|delete|clean}
                         Manage timestamped backups
  history {list|show|diff|delete|clear}
                         View and manage past doctor runs
  net {dns|mx|ping|mtu|trace|port}
                         Network diagnostics
  monitor                Live resource monitoring for Antigravity
  crashes                Analyze Crashpad crash dumps
  selftest               Verify the CLI itself
  plugins {list|add|remove|enable|disable|show|path|init}
                         Manage user-defined check plugins
  serve [--port N] [--host H] [--token T]
                         Start Doctor-as-a-Service HTTP server
  profile {list|use|create|delete|show|path|copy|rename}
                         Manage isolated configuration profiles
  daemon {start|stop|status|run|rules|enable|disable|trigger|log|reset}
                         Auto-recovery daemon (continuous monitoring)
  antigravity {status|version|launch|kill|restart}
                         Manage the Antigravity install (version, launch, close)
  update                 Re-run the parent deploy script
  update --check         Check for newer release on GitHub (no deploy)
  info                   System & environment information
  help                   Show this help

Options:
  --json                 Machine-readable JSON output
  --verbose, -v          Verbose output
  --yes, -y              Auto-confirm prompts
  --auto-elevate, -E     Re-launch with admin/sudo if not already elevated
  --follow, -f           Follow log output (logs command)
  --lines N, -n N        Number of lines (logs command)
  --watch, -w            Re-run diagnostic periodically (doctor command)
  --interval <ms>        Watch interval in ms (doctor command)
  --report <file>        Write a report to <file> (doctor command)
  --format html|md|json  Report format (doctor command)
  --check                Check for update (update command)
  --profile <name>       Use a specific profile for this invocation

Exit codes:
  0  OK
  1  Warning(s)
  2  Error(s)
`;

function buildContext(parsed: ReturnType<typeof parseArgs>): CommandContext {
  return {
    json: Boolean(parsed.options.json),
    verbose: Boolean(parsed.options.verbose || parsed.options.v),
    yes: Boolean(parsed.options.yes || parsed.options.y),
    cwd: process.cwd(),
    options: parsed.options,
  };
}

/**
 * Check if we're running with admin privileges on Windows.
 * Returns true if admin, false otherwise.
 */
function isAdmin(): boolean {
  if (process.platform !== 'win32') {
    // On Unix, check if effective UID is 0
    return typeof process.getuid === 'function' && process.getuid() === 0;
  }
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('net', ['session'], { stdio: 'pipe', windowsHide: true });
    return out.toString().toLowerCase().includes('there are no entries');
  } catch {
    // net session fails with "Access is denied" if not admin
    return false;
  }
}

/**
 * Re-launch the current process with admin privileges (Windows) or sudo (Unix).
 * Returns true if re-launch was initiated (caller should exit).
 * Returns false if already admin or re-launch failed.
 */
function tryAutoElevate(): boolean {
  const platform = process.platform;
  const args = process.argv.slice(1);
  const exe = process.execPath;
  const script = process.argv[1] || '';

  try {
    if (platform === 'win32') {
      // Use PowerShell Start-Process -Verb RunAs to trigger UAC
      const { execFileSync } = require('child_process');
      const psArgs = [
        '-NoProfile',
        '-Command',
        `Start-Process -FilePath "${exe}" -ArgumentList '${script.replace(/'/g, "''")} ${args.join(' ')}' -Verb RunAs -Wait`,
      ];
      execFileSync('powershell', psArgs, { stdio: 'inherit', windowsHide: true });
      return true;
    }
    // Unix: try sudo -n (non-interactive)
    const { execFileSync } = require('child_process');
    execFileSync('sudo', ['-n', exe, script, ...args], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// In worker mode (called from the Electron UI's worker pool), we must NOT
// call process.exit() — the host keeps the process alive for subsequent calls.
const isWorker = process.env.AG_WORKER_ID !== undefined;

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const ctx = buildContext(parsed);
  const [cmd, sub, ...rest] = parsed.command;

  // `--help` / `-h` are parsed as option flags (parser.ts), so they never
  // reach the `case 'help'` branch below. Handle them before anything else —
  // otherwise `ag-doctor --help` runs the full doctor.
  if (parsed.options.help || parsed.options.h) {
    console.log(USAGE);
    return 0;
  }

  // Auto-elevate: if --auto-elevate is set and we're not admin, re-launch
  const wantElevate = Boolean(parsed.options['auto-elevate'] || parsed.options.E);
  if (wantElevate && !isAdmin()) {
    if (process.env.AG_ELEVATED === '1') {
      // Already tried once — don't loop
      console.error(c.yellow('Warning: not running as admin, some operations may fail'));
    } else {
      console.error(c.cyan('Requesting admin privileges...'));
      const relaunched = tryAutoElevate();
      if (relaunched) {
        return 0; // Exit cleanly after re-launch
      }
      console.error(c.yellow('Auto-elevation failed or cancelled. Continuing without admin.'));
    }
  }

  try {
    switch (cmd) {
      case undefined:
      case 'doctor':
        return await runDoctor(ctx);
      case 'check':
        return await runCheck(ctx);
      case 'repair':
        return await runRepair(ctx);
      case 'repair-asar':
        return await runRepairAsar(ctx);
      case 'check-asar':
        return await runCheckAsar(ctx);
      case 'models':
        if (sub === 'list' || sub === 'ls') return runModelsList(ctx);
        if (sub === 'add') return await runModelsAdd(ctx);
        if (sub === 'remove' || sub === 'rm') return await runModelsRemove(ctx, rest[0]);
        if (sub === 'rekey') return await runModelsRekey(ctx);
        if (sub === 'test') return await runModelsTest(ctx, rest[0]);
        if (sub === 'fetch') return await runModelsFetch(ctx);
        console.error(`Unknown models subcommand: ${sub}`);
        console.error(USAGE);
        return 2;
      case 'patch':
        if (sub === 'status') return runPatchStatus(ctx);
        if (sub === 'apply') return await runPatchApply(ctx);
        if (sub === 'restore') return await runPatchRestore(ctx);
        if (sub === 'select') return await runPatchSelect(ctx, rest[0]);
        console.error(`Unknown patch subcommand: ${sub}`);
        console.error(USAGE);
        return 2;
      case 'logs':
        return await runLogs(ctx, {
          follow: Boolean(parsed.options.follow || parsed.options.f),
          lines: Number(parsed.options.lines || parsed.options.n) || 50,
          source: String(parsed.options.source || 'language_server'),
          clear: Boolean(parsed.options.clear),
          clearAll: Boolean(parsed.options['clear-all']),
          level: String(parsed.options.level || 'all'),
          stats: Boolean(parsed.options.stats),
        });
      case 'mitm':
        return await runMitm(ctx, sub);
      case 'proxy':
        return await runProxy(ctx, sub);
      case 'config':
        return await runConfig(ctx, sub, rest);
      case 'snapshot':
        return await runSnapshot(ctx, sub, rest);
      case 'history':
        return await runHistory(ctx, sub, rest);
      case 'net':
        return await runNet(ctx, sub, rest);
      case 'monitor':
        return await runMonitor(ctx);
      case 'crashes':
        return await runCrashes(ctx);
      case 'selftest':
        return await runSelftest(ctx);
      case 'plugins':
        return await runPlugins(ctx, sub, rest);
      case 'serve': {
        // Re-parse args to get options after the 'serve' subcommand
        const serveIdx = process.argv.indexOf('serve');
        const serveArgs = serveIdx >= 0 ? process.argv.slice(serveIdx + 1) : rest;
        return await runServe(ctx, serveArgs);
      }
      case 'profile':
        return await runProfile(ctx, sub, rest);
      case 'daemon': {
        // Re-parse args to get options after the 'daemon' subcommand
        const daemonIdx = process.argv.indexOf('daemon');
        const daemonArgs = daemonIdx >= 0 ? process.argv.slice(daemonIdx + 1) : [sub, ...rest].filter(Boolean) as string[];
        return await runDaemon(ctx, daemonArgs);
      }
      case 'update':
        return await runUpdate(ctx);
      case 'info':
        return runInfo(ctx);
      case 'antigravity':
        return await runAntigravity(ctx, [sub, ...rest], rest);
      case 'help':
      case '--help':
      case '-h':
        console.log(USAGE);
        return 0;
      case 'version':
      case '--version':
      case '-v':
        const pkg = require('../package.json');
        console.log(`ag-doctor v${pkg.version}`);
        return 0;
      default:
        console.error(`Unknown command: ${cmd}`);
        console.error(USAGE);
        return 2;
    }
  } catch (e) {
    console.error(c.red(`ag-doctor: ${(e as Error).message}`));
    if (ctx.verbose) console.error((e as Error).stack);
    return 2;
  }
}

// Export `run` as an alias for the worker shim (and for direct programmatic use).
export const run = main;

// Auto-execute only when invoked as a script (not when imported as a module).
// The compiled `dist/index.js` is `require()`d by the worker shim, so we must
// not auto-run in that case. In CommonJS, `require.main === module` is true
// only when the file is the entry point of the process.
const isMainModule =
  typeof require !== 'undefined' && require.main === module;

if (isMainModule && !isWorker) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(c.red('Fatal:'), err);
      process.exit(2);
    },
  );
}
