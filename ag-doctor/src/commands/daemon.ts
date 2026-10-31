/**
 * `ag-doctor daemon` — long-running auto-recovery daemon.
 *
 * Runs the diagnostic loop in the background and triggers recovery
 * actions when problems are detected.
 *
 * Usage:
 *   ag-doctor daemon start [--auto] [--interval <ms>] [--once]
 *   ag-doctor daemon stop
 *   ag-doctor daemon status
 *   ag-doctor daemon run [--auto] [--interval <ms>]   # foreground
 *   ag-doctor daemon log [-n N]
 *
 * The daemon writes its PID to:
 *   ~/.gemini/antigravity/daemon.pid
 *
 * And logs to:
 *   ~/.gemini/antigravity/daemon.log
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import type { CommandContext } from '../types';
import {
  loadRecoveryConfig,
  saveRecoveryConfig,
  resetRecoveryConfig,
  setRuleEnabled,
  getRecoveryRule,
  runRecovery,
  runRecoveryAction,
  findApplicableRules,
  resetCooldowns,
  type RecoveryRule,
  type RecoveryActionResult,
} from '../core/recovery';
import { checkEnvironment } from '../checks/environment';
import { checkInstallation } from '../checks/installation';
import { checkPatch } from '../checks/patch';
import { checkProxy } from '../checks/proxy';
import { checkModels } from '../checks/models';
import { checkEncryption } from '../checks/encryption';
import { checkConnectivity } from '../checks/connectivity';
import { checkMitm } from '../checks/mitm';
import { loadPlugins, runPlugin } from '../core/plugins';
import { ok, info, warn, error, header, c } from '../cli/output';
import { getAntigravityDataDir } from '../core/paths';
import { getProfilePath } from '../core/profile';

const PID_FILE = 'daemon.pid';
const LOG_FILE = 'daemon.log';

function getDaemonDir(): string {
  return getAntigravityDataDir();
}

function getPidFile(): string {
  return path.join(getDaemonDir(), PID_FILE);
}

function getLogFile(): string {
  return path.join(getDaemonDir(), LOG_FILE);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  const f = getPidFile();
  if (!fs.existsSync(f)) return null;
  try {
    const pid = parseInt(fs.readFileSync(f, 'utf-8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) return pid;
    // Stale PID file
    fs.unlinkSync(f);
    return null;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  fs.mkdirSync(getDaemonDir(), { recursive: true });
  fs.writeFileSync(getPidFile(), String(pid) + '\n', 'utf-8');
}

function clearPid(): void {
  const f = getPidFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function appendLog(line: string, level: LogLevel = 'INFO'): void {
  const f = getLogFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  
  try {
    const stats = fs.statSync(f);
    if (stats.size > 10 * 1024 * 1024) { // 10MB
      fs.renameSync(f, f + '.1');
    }
  } catch {
    // ignore
  }

  const ts = new Date().toISOString();
  fs.appendFileSync(f, `[${ts}] [${level}] ${line}\n`, 'utf-8');
}

// ─── Diagnostic runner ────────────────────────────────────────────────────

async function runDiagnostic(): Promise<any[]> {
  const builtIn = await Promise.all([
    Promise.resolve(checkEnvironment()),
    Promise.resolve(checkInstallation()),
    Promise.resolve(checkPatch()),
    checkProxy(),
    Promise.resolve(checkModels()),
    Promise.resolve(checkEncryption()),
    checkConnectivity(),
    checkMitm(),
  ]);

  const { plugins, errors } = loadPlugins();
  if (errors.length > 0) {
    for (const e of errors) {
      builtIn.push({
        id: `plugin-error-${e}`,
        title: `Plugin load error: ${e}`,
        status: 'warn',
        message: 'Plugin file failed validation',
        fixable: false,
        source: 'plugin',
      });
    }
  }

  const pluginResults = await Promise.all(plugins.map(runPlugin));
  return [...builtIn, ...pluginResults];
}

function summarize(results: any[]): { ok: number; warn: number; error: number } {
  return {
    ok: results.filter((r) => r.status === 'ok').length,
    warn: results.filter((r) => r.status === 'warn').length,
    error: results.filter((r) => r.status === 'error').length,
  };
}

// ─── Daemon loop ──────────────────────────────────────────────────────────

interface DaemonOptions {
  autoMode: boolean;
  intervalMs: number;
  once: boolean;
  quiet: boolean;
}

async function daemonLoop(opts: DaemonOptions): Promise<number> {
  const cfg = loadRecoveryConfig();
  if (opts.autoMode) cfg.autoMode = true;
  saveRecoveryConfig(cfg);

  if (!opts.quiet) {
    header('ag-doctor — Auto-recovery daemon');
    info(`Mode: ${opts.autoMode ? 'AUTO (no confirmations)' : 'safe (confirming rules skipped)'}`);
    info(`Interval: ${opts.intervalMs}ms`);
    info(`PID: ${process.pid}`);
    info(`Log: ${getLogFile()}`);
    info(`Press Ctrl+C to stop.`);
  }

  appendLog(`Daemon started (pid=${process.pid}, interval=${opts.intervalMs}ms, auto=${opts.autoMode})`);

  let iteration = 0;
  const shutdown = (signal: string) => {
    appendLog(`Daemon stopped (${signal})`);
    clearPid();
    if (!opts.quiet) info(`\nReceived ${signal}, daemon stopped.`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (true) {
    iteration++;
    const iterStart = Date.now();
    try {
      const results = await runDiagnostic();
      const summary = summarize(results);
      const ts = new Date().toISOString().split('T')[1].slice(0, 12);

      appendLog(`[${ts}] iteration=${iteration} ok=${summary.ok} warn=${summary.warn} error=${summary.error}`);
      if (!opts.quiet) {
        const status = summary.error > 0 ? c.red(`${summary.error} ERR`) : summary.warn > 0 ? c.yellow(`${summary.warn} WARN`) : c.green('OK');
        console.log(`[${ts}] iter ${String(iteration).padStart(4, ' ')}  ${status}  (ok=${summary.ok} warn=${summary.warn} err=${summary.error})`);
      }

      // Find applicable rules
      const rules = findApplicableRules(results, cfg);
      if (rules.length > 0) {
        appendLog(`[${ts}] ${rules.length} recovery rule(s) triggered: ${rules.map((r) => r.id).join(', ')}`, 'WARN');
        if (!opts.quiet) {
          for (const rule of rules) {
            console.log(`  ${c.yellow('⚡')} Triggering recovery: ${rule.title} (${rule.id})`);
          }
        }

        const outcomes = await runRecovery(results, cfg);
        for (const outcome of outcomes) {
          const icon = outcome.ok ? c.green('✓') : c.red('✗');
          const msg = outcome.ok ? outcome.message : `${outcome.message}${outcome.details ? ` — ${outcome.details}` : ''}`;
          appendLog(`[${ts}]   ${outcome.ruleId}: ${outcome.ok ? 'OK' : 'FAIL'} (${outcome.durationMs}ms) — ${msg}`, outcome.ok ? 'INFO' : 'ERROR');
          if (!opts.quiet) {
            console.log(`    ${icon} ${outcome.ruleId}: ${msg} (${outcome.durationMs}ms)`);
          }
        }
      }
    } catch (e) {
      appendLog(`[ERROR] iteration=${iteration}: ${(e as Error).message}`, 'ERROR');
      if (!opts.quiet) error(`Daemon error: ${(e as Error).message}`);
    }

    if (opts.once) {
      appendLog('Daemon exiting after one iteration (--once)');
      clearPid();
      return 0;
    }

    const elapsed = Date.now() - iterStart;
    const sleepMs = Math.max(0, opts.intervalMs - elapsed);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

// ─── Subcommands ──────────────────────────────────────────────────────────

function printRuleTable(rules: RecoveryRule[]): void {
  const idW = Math.max(2, ...rules.map((r) => r.id.length));
  const checkW = Math.max(4, ...rules.map((r) => r.checkId.length));
  console.log(`${c.bold('ID'.padEnd(idW))}  ${c.bold('CHECK'.padEnd(checkW))}  ${c.bold('STATUS')}  ${c.bold('COOLDOWN')}  ${c.bold('CONFIRM')}  ${c.bold('ENABLED')}  ${c.bold('TITLE')}`);
  console.log(`${'-'.repeat(idW)}  ${'-'.repeat(checkW)}  ${'-'.repeat(6)}  ${'-'.repeat(10)}  ${'-'.repeat(8)}  ${'-'.repeat(7)}  ${'-'.repeat(20)}`);
  for (const r of rules) {
    const en = r.enabled ? c.green('yes') : c.gray('no');
    const cf = r.requiresConfirm ? c.yellow('yes') : c.gray('no');
    const cd = r.cooldownMs < 60_000 ? `${Math.round(r.cooldownMs / 1000)}s` : r.cooldownMs < 3_600_000 ? `${Math.round(r.cooldownMs / 60_000)}m` : `${Math.round(r.cooldownMs / 3_600_000)}h`;
    console.log(`${r.id.padEnd(idW)}  ${r.checkId.padEnd(checkW)}  ${r.status.padEnd(6)}  ${cd.padEnd(10)}  ${cf.padEnd(8)}  ${en.padEnd(7)}  ${r.title}`);
  }
}

export async function runDaemon(ctx: CommandContext, args: string[] = []): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(`ag-doctor daemon — Auto-recovery daemon

Usage:
  ag-doctor daemon start [--auto] [--interval <ms>]   Start daemon in background
  ag-doctor daemon stop                                Stop the running daemon
  ag-doctor daemon status                              Show daemon status
  ag-doctor daemon run [--auto] [--interval <ms>]      Run in foreground
  ag-doctor daemon run --once                          Run once and exit
  ag-doctor daemon rules                               List recovery rules
  ag-doctor daemon enable <id>                         Enable a rule
  ag-doctor daemon disable <id>                        Disable a rule
  ag-doctor daemon trigger <id>                        Manually trigger a rule
  ag-doctor daemon log [-n N]                          Show daemon log
  ag-doctor daemon reset                               Reset recovery config to defaults

Options:
  --auto              Enable auto-mode (runs confirming rules without prompt)
  --interval <ms>     Check interval (default: 30000ms)
  --once              Run one iteration and exit
  --quiet, -q         Suppress console output (log file still written)
`);
      return 0;

    case 'start': {
      const existing = readPid();
      if (existing) {
        error(`Daemon already running (pid=${existing})`);
        info(`Stop it with: ag-doctor daemon stop`);
        return 1;
      }

      const auto = rest.includes('--auto');
      const intervalIdx = rest.indexOf('--interval');
      const intervalMs = intervalIdx >= 0 ? parseInt(rest[intervalIdx + 1], 10) || 30_000 : 30_000;
      const quiet = rest.includes('--quiet') || rest.includes('-q');

      // Spawn detached child process with absolute paths
      const scriptPath = path.resolve(process.argv[1]);
      const cwd = path.dirname(path.dirname(scriptPath));
      const args = ['daemon', 'run'];
      if (auto) args.push('--auto');
      args.push('--interval', String(intervalMs));
      if (quiet) args.push('--quiet');

      const out = fs.openSync(getLogFile(), 'a');
      const err = fs.openSync(getLogFile(), 'a');
      appendLog(`Spawning daemon: node ${scriptPath} ${args.join(' ')} (cwd=${cwd})`);
      const child = spawn(process.execPath, [scriptPath, ...args], {
        detached: true,
        stdio: ['ignore', out, err],
        windowsHide: true,
        env: process.env,
        cwd,
      });
      child.unref();

      // Wait briefly for the child to write its PID
      await new Promise((r) => setTimeout(r, 800));
      const pid = readPid();
      if (pid) {
        ok(`Daemon started (pid=${pid})`);
        info(`Log: ${getLogFile()}`);
        info(`Stop with: ag-doctor daemon stop`);
      } else {
        warn(`Daemon spawned but PID file not yet written. Check log: ${getLogFile()}`);
      }
      return 0;
    }

    case 'stop': {
      const pid = readPid();
      if (!pid) {
        info('No daemon running.');
        return 0;
      }
      try {
        process.kill(pid, 'SIGTERM');
        ok(`Sent SIGTERM to daemon (pid=${pid})`);
      } catch (e) {
        error(`Failed to stop daemon: ${(e as Error).message}`);
        return 1;
      }
      // Wait for graceful shutdown
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (!isProcessAlive(pid)) {
          clearPid();
          ok('Daemon stopped.');
          return 0;
        }
      }
      // Force kill
      try {
        process.kill(pid, 'SIGKILL');
        clearPid();
        warn('Daemon force-killed.');
      } catch {
        error('Failed to force-kill daemon.');
        return 1;
      }
      return 0;
    }

    case 'status': {
      const pid = readPid();
      const cfg = loadRecoveryConfig();
      if (pid) {
        ok(`Daemon running (pid=${pid})`);
        info(`Auto-mode: ${cfg.autoMode ? 'yes' : 'no'}`);
        info(`Enabled rules: ${cfg.rules.filter((r) => r.enabled).length}/${cfg.rules.length}`);
        info(`Log: ${getLogFile()}`);
      } else {
        info('Daemon not running.');
        info(`Start with: ag-doctor daemon start [--auto]`);
      }
      return 0;
    }

    case 'run': {
      const auto = rest.includes('--auto');
      const intervalIdx = rest.indexOf('--interval');
      const intervalMs = intervalIdx >= 0 ? parseInt(rest[intervalIdx + 1], 10) || 30_000 : 30_000;
      const once = rest.includes('--once');
      const quiet = rest.includes('--quiet') || rest.includes('-q');

      writePid(process.pid);
      return await daemonLoop({ autoMode: auto, intervalMs, once, quiet });
    }

    case 'rules':
    case 'list': {
      const cfg = loadRecoveryConfig();
      if (ctx.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        header('ag-doctor — Recovery rules');
        info(`Enabled: ${cfg.enabled ? 'yes' : 'no'}`);
        info(`Auto-mode: ${cfg.autoMode ? 'yes' : 'no'}`);
        info(`Webhook: ${cfg.notifyWebhook ?? '(none)'}`);
        console.log('');
        printRuleTable(cfg.rules);
        console.log(`\nUse \`ag-doctor daemon enable <id>\` or \`disable <id>\` to toggle.`);
      }
      return 0;
    }

    case 'enable': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor daemon enable <id>'); return 2; }
      if (setRuleEnabled(id, true)) { ok(`Rule "${id}" enabled.`); return 0; }
      error(`Rule "${id}" not found.`); return 2;
    }

    case 'disable': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor daemon disable <id>'); return 2; }
      if (setRuleEnabled(id, false)) { ok(`Rule "${id}" disabled.`); return 0; }
      error(`Rule "${id}" not found.`); return 2;
    }

    case 'trigger': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor daemon trigger <id>'); return 2; }
      const rule = getRecoveryRule(id);
      if (!rule) { error(`Rule "${id}" not found.`); return 2; }
      info(`Manually triggering rule "${id}"…`);
      const outcome = await runRecoveryAction(id);
      if (!outcome) { error('No action handler.'); return 2; }
      const icon = outcome.ok ? c.green('✓') : c.red('✗');
      console.log(`${icon} ${outcome.message} (${outcome.durationMs}ms)`);
      if (outcome.details) console.log(c.gray(outcome.details));
      return outcome.ok ? 0 : 1;
    }

    case 'log': {
      const nIdx = rest.indexOf('-n');
      const n = nIdx >= 0 ? parseInt(rest[nIdx + 1], 10) || 50 : 50;
      const f = getLogFile();
      if (!fs.existsSync(f)) { info('No log file yet.'); return 0; }
      const lines = fs.readFileSync(f, 'utf-8').trim().split('\n');
      const tail = lines.slice(-n);
      console.log(tail.join('\n'));
      return 0;
    }

    case 'reset': {
      resetRecoveryConfig();
      resetCooldowns();
      ok('Recovery config reset to defaults.');
      return 0;
    }

    default:
      console.error(`Unknown daemon subcommand: ${sub}`);
      console.error('Run `ag-doctor daemon --help` for usage.');
      return 2;
  }
}
