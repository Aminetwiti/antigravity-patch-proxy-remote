/**
 * `ag-doctor doctor` — full diagnostic.
 *
 * Flags:
 *   --watch, -w           Re-run periodically (Ctrl+C to stop)
 *   --interval <ms>       Watch interval in ms (default: from config, 5000)
 *   --report <file>       Write a report to <file> and exit
 *   --format html|md|json Report format (default: html)
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { CommandContext } from '../types';
import { checkEnvironment } from '../checks/environment';
import { checkInstallation } from '../checks/installation';
import { checkPatch } from '../checks/patch';
import { checkProxy } from '../checks/proxy';
import { checkModels } from '../checks/models';
import { checkEncryption } from '../checks/encryption';
import { checkConnectivity } from '../checks/connectivity';
import { checkMitm } from '../checks/mitm';
import { checkAntigravity } from '../checks/antigravity';
import { c, header, ICONS, ok, warn, error, info } from '../cli/output';
import { loadConfig } from '../core/config';
import { saveHistory } from '../core/history';
import { renderHtmlReport, renderMarkdownReport, renderJsonReport, type ReportFormat } from '../core/report-template';
import { loadPlugins, runPlugin, type PluginCheckResult } from '../core/plugins';

async function runAllChecks(): Promise<Array<ReturnType<typeof checkEnvironment> | PluginCheckResult>> {
  const builtIn = await Promise.all([
    Promise.resolve(checkEnvironment()),
    Promise.resolve(checkInstallation()),
    Promise.resolve(checkPatch()),
    checkProxy(),
    Promise.resolve(checkModels()),
    Promise.resolve(checkEncryption()),
    checkConnectivity(),
    checkMitm(),
    checkAntigravity(),
  ]);

  // Load and execute user plugins
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
      } as PluginCheckResult);
    }
  }

  const pluginResults = await Promise.all(plugins.map(runPlugin));
  return [...builtIn, ...pluginResults];
}

type CheckResult = ReturnType<typeof checkEnvironment> | PluginCheckResult;

function printResults(results: CheckResult[], ctx: CommandContext): void {
  for (const r of results) {
    const icon =
      r.status === 'ok'
        ? c.green(ICONS.ok)
        : r.status === 'warn'
          ? c.yellow(ICONS.warn)
          : r.status === 'error'
            ? c.red(ICONS.err)
            : c.blue(ICONS.info);
    console.log(`${icon} ${c.bold(r.title)}`);
    console.log(`    ${r.message}`);
    if (r.details && (ctx.verbose || r.status !== 'ok')) {
      console.log(c.gray(r.details.split('\n').join('\n    ')));
    }
    if (r.fixable) {
      const hint = typeof r.fixable === 'string' ? r.fixable : 'run `ag-doctor repair`';
      console.log(`    ${c.cyan('→ fixable:')} ${hint}`);
    }
  }
}

function summarize(results: CheckResult[]): { ok: number; warns: number; errors: number; code: number } {
  const errors = results.filter((r) => r.status === 'error').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const okCount = results.filter((r) => r.status === 'ok').length;
  return { ok: okCount, warns, errors, code: errors > 0 ? 2 : warns > 0 ? 1 : 0 };
}

function persistHistory(results: CheckResult[], durationMs?: number): void {
  try {
    const s = summarize(results);
    saveHistory({
      results: results as ReturnType<typeof checkEnvironment>[],
      durationMs,
      summary: { ok: s.ok, warn: s.warns, error: s.errors, info: results.filter((r) => r.status === 'info').length },
    });
  } catch {
    // never fail the doctor because history could not be saved
  }
}

function formatFromPath(p: string): ReportFormat {
  const ext = path.extname(p).toLowerCase().replace('.', '');
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'json') return 'json';
  return 'html';
}

async function writeReport(results: CheckResult[], outPath: string, fmt: ReportFormat, ctx: CommandContext): Promise<void> {
  const pkg = require('../../package.json') as { version: string };
  const input = {
    results,
    generatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    agDoctorVersion: pkg.version,
  };
  const body =
    fmt === 'md'
      ? renderMarkdownReport(input)
      : fmt === 'json'
        ? renderJsonReport(input)
        : renderHtmlReport(input);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf-8');
  if (!ctx.json) ok(`Report written to ${outPath} (${fmt.toUpperCase()}, ${body.length} bytes)`);
}

export async function runDoctor(ctx: CommandContext): Promise<number> {
  const opts = ctx.options ?? {};
  const watch = Boolean(opts.watch || opts.w);
  const reportPath = (opts.report as string | undefined) ?? (opts['report-path'] as string | undefined);
  const formatOpt = (opts.format as string | undefined)?.toLowerCase() as ReportFormat | undefined;

  // --report short-circuits: run once, write file, exit
  if (reportPath) {
    const fmt = formatOpt ?? formatFromPath(reportPath);
    if (!ctx.json) header('ag-doctor — Antigravity diagnostic');
    const results = await runAllChecks();
    if (ctx.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printResults(results, ctx);
      const s = summarize(results);
      console.log('');
      console.log(`  ${c.green(`${s.ok} ok`)} · ${c.yellow(`${s.warns} warnings`)} · ${c.red(`${s.errors} errors`)}`);
      console.log('');
    }
    await writeReport(results, reportPath, fmt, ctx);
    persistHistory(results);
    return summarize(results).code;
  }

  // --watch: loop until SIGINT
  if (watch) {
    const cfg = loadConfig();
    const interval = Number(opts.interval) || cfg.doctorInterval;
    if (!ctx.json) {
      info(`Watch mode — refreshing every ${interval}ms (Ctrl+C to stop)`);
    }
    let lastCode = 0;
    // Initial run
    if (!ctx.json) header('ag-doctor — Antigravity diagnostic');
    let results = await runAllChecks();
    printResults(results, ctx);
    lastCode = summarize(results).code;
    persistHistory(results);
    const s0 = summarize(results);
    if (!ctx.json) {
      console.log('');
      console.log(`  ${c.green(`${s0.ok} ok`)} · ${c.yellow(`${s0.warns} warnings`)} · ${c.red(`${s0.errors} errors`)}`);
      console.log('');
    }

    const tick = async () => {
      if (!ctx.json) {
        console.clear();
        header('ag-doctor — Antigravity diagnostic');
      }
      results = await runAllChecks();
      printResults(results, ctx);
      lastCode = summarize(results).code;
      persistHistory(results);
      const s = summarize(results);
      if (!ctx.json) {
        console.log('');
        console.log(`  ${c.green(`${s.ok} ok`)} · ${c.yellow(`${s.warns} warnings`)} · ${c.red(`${s.errors} errors`)}`);
        console.log('');
        info(`Next refresh in ${interval}ms — Ctrl+C to stop`);
      }
    };

    await new Promise<void>((resolve) => {
      const handle = setInterval(() => {
        tick().catch((e) => {
          if (!ctx.json) error(`Tick failed: ${(e as Error).message}`);
        });
      }, interval);
      process.on('SIGINT', () => {
        clearInterval(handle);
        resolve();
      });
      process.on('SIGTERM', () => {
        clearInterval(handle);
        resolve();
      });
    });
    return lastCode;
  }

  // Default: single run
  if (!ctx.json) header('ag-doctor — Antigravity diagnostic');
  const results = await runAllChecks();
  persistHistory(results);
  if (ctx.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printResults(results, ctx);
    const s = summarize(results);
    console.log('');
    console.log(`  ${c.green(`${s.ok} ok`)} · ${c.yellow(`${s.warns} warnings`)} · ${c.red(`${s.errors} errors`)}`);
    console.log('');
    if (s.errors > 0) error(`${s.errors} check(s) failed`);
    else if (s.warns > 0) warn(`${s.warns} warning(s)`);
    else ok('All checks passed');
  }
  return summarize(results).code;
}
