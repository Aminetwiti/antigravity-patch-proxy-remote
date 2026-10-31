/**
 * `ag-doctor repair-asar` — detect & restore a corrupted app.asar.
 *
 * Background:
 *   When the add-model patcher is interrupted or the disk fills up, the
 *   live app.asar can end up truncated (e.g. only the /dist subtree remains
 *   and package.json is missing). Electron then refuses to launch the GUI
 *   because the entry point (dist/main.js) cannot resolve its imports.
 *
 *   This command inspects app.asar, enumerates the backup candidates left
 *   behind in the resources folder, picks the best one (preferring patched
 *   backups that match the installed version), quarantines the broken file,
 *   and copies the chosen backup into place.
 *
 * Flags:
 *   --json            Emit a JSON report (for the Electron UI).
 *   --yes, -y         Skip the confirmation prompt.
 *   --from <path>     Restore from a specific backup instead of auto-selecting.
 *   --dry-run         Print the report and exit without modifying anything.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info, dim } from '../cli/output';
import { confirm } from '../cli/prompts';
import { Spinner } from '../cli/spinner';
import { findAntigravityInstallDir } from '../core/paths';
import {
  checkAsarIntegrity,
  repairAsar,
  listAsarBackups,
  type AsarIntegrityReport,
} from '../core/asar-integrity';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function printReport(report: AsarIntegrityReport): void {
  console.log('');
  console.log(`${c.bold('Live app.asar')}`);
  if (!report.asarPath) {
    console.log(`  ${c.red('✗')} ${c.red('Not found — Antigravity installation missing?')}`);
  } else {
    const state = report.healthy ? c.green('✓ healthy') : c.red(`✗ ${report.reason ?? 'corrupted'}`);
    console.log(`  ${dim(report.asarPath)}`);
    console.log(`  ${state}   ${dim(fmtBytes(report.sizeBytes))}`);
  }

  console.log('');
  console.log(`${c.bold('Backup candidates')} ${dim('(best first)')}`);
  if (report.candidates.length === 0) {
    console.log(`  ${dim('(none found next to app.asar)')}`);
  } else {
    for (const c0 of report.candidates) {
      const tag = c0.healthy ? c.green('✓') : c.red('✗');
      const patched = c0.patched ? c.cyan(' [patched]') : '';
      console.log(`  ${tag} ${dim(fmtBytes(c0.sizeBytes).padStart(10))}  ${c0.path.split(/[\\/]/).pop()}${patched}`);
      console.log(`      ${dim(c0.label)} — ${dim(new Date(c0.modified).toLocaleString())}`);
      if (!c0.healthy && c0.reason) console.log(`      ${c.yellow(c0.reason)}`);
    }
  }

  console.log('');
  if (report.recommended) {
    const r = report.recommended;
    const tag = r.patched ? c.cyan('recommended (patched)') : c.cyan('recommended');
    console.log(`${tag}: ${r.path}`);
    console.log(`  ${r.label} • ${fmtBytes(r.sizeBytes)} • ${new Date(r.modified).toLocaleString()}`);
  } else if (!report.healthy) {
    console.log(c.red('No healthy backup available — reinstall Antigravity or supply a known-good app.asar manually.'));
  }
}

export async function runRepairAsar(ctx: CommandContext): Promise<number> {
  header('ag-doctor — repair-asar');

  const dryRun = Boolean(ctx.options['dry-run']);
  const fromArg = typeof ctx.options.from === 'string' ? ctx.options.from : undefined;

  const report = await checkAsarIntegrity();

  if (ctx.json) {
    console.log(JSON.stringify({ ok: report.healthy, report }, null, 2));
    return report.healthy ? 0 : 1;
  }

  printReport(report);

  if (report.healthy) {
    ok('app.asar is healthy — nothing to do');
    return 0;
  }

  if (dryRun) {
    warn('Dry run — no changes made');
    return 1;
  }

  if (!report.recommended && !fromArg) {
    error('No healthy backup found. Cannot auto-repair.');
    info('Reinstall Antigravity, or copy a known-good app.asar into the resources folder manually.');
    return 2;
  }

  if (!ctx.yes) {
    console.log('');
    const proceed = await confirm(
      `Restore app.asar from ${fromArg ? 'the specified backup' : 'the recommended backup'}?`,
      false,
    );
    if (!proceed) {
      warn('Aborted by user');
      return 1;
    }
  }

  const sp = new Spinner('Restoring app.asar');
  sp.start();
  let result;
  try {
    result = await repairAsar(fromArg);
  } catch (e) {
    sp.fail(`Unexpected error: ${(e as Error).message}`);
    return 2;
  }

  if (!result.ok) {
    sp.fail(result.message);
    if (result.actions.length > 0) {
      info('Actions attempted:');
      for (const a of result.actions) console.log(`  ${c.cyan('•')} ${a}`);
    }
    return 2;
  }

  sp.succeed(result.message);
  for (const a of result.actions) console.log(`  ${c.cyan('•')} ${dim(a)}`);
  ok('app.asar is now healthy. Try launching Antigravity again.');
  return 0;
}

/**
 * `ag-doctor antigravity check-asar` — read-only integrity report (no repair).
 * Used by the Electron UI dashboard.
 */
export async function runCheckAsar(ctx: CommandContext): Promise<number> {
  const report = await checkAsarIntegrity();
  if (ctx.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.healthy ? 0 : 1;
  }
  printReport(report);
  return report.healthy ? 0 : 1;
}

/**
 * Programmatic entry point used by the Electron UI's IPC layer
 * (`ag:asar:check`, `ag:asar:repair`).
 *
 * Returns a serializable object suitable for direct return across IPC.
 */
export async function checkAsarForIpc(): Promise<{
  ok: boolean;
  report: AsarIntegrityReport;
}> {
  const report = await checkAsarIntegrity();
  return { ok: report.healthy, report };
}

export async function repairAsarForIpc(opts: { from?: string; yes?: boolean } = {}): Promise<{
  ok: boolean;
  message: string;
  actions: string[];
  report: AsarIntegrityReport | null;
}> {
  const result = await repairAsar(opts.from);
  return result;
}

/**
 * Subset of `listAsarBackups` exposed for the UI without leaking internal types.
 */
export async function listAsarBackupsForIpc(): Promise<{
  ok: boolean;
  candidates: ReturnType<typeof listAsarBackups>;
}> {
  const installDir = findAntigravityInstallDir();
  if (!installDir) return { ok: false, candidates: [] };
  return {
    ok: true,
    candidates: listAsarBackups(path.join(installDir, 'resources')),
  };
}

// Re-export for downstream consumers
export { checkAsarIntegrity, repairAsar, listAsarBackups };

// Suppress unused-import warning for fs (kept for future parity with other commands)
void fs;
