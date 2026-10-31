/**
 * `ag-doctor history` — view and manage past doctor runs.
 *
 * Subcommands:
 *   list                 List all runs (newest first)
 *   show <id>            Show full results for a run
 *   diff <id1> <id2>     Compare two runs side by side
 *   delete <id>          Delete a single run
 *   clear                Delete all history
 */
import type { CommandContext } from '../types';
import { listHistory, loadHistory, deleteHistory, clearHistory, getHistoryDir, type HistoryEntry } from '../core/history';
import { c, header, ok, warn, error, info, table } from '../cli/output';
import { confirm } from '../cli/prompts';

const USAGE = `ag-doctor history — view and manage past doctor runs

Usage:
  ag-doctor history list                 List all runs
  ag-doctor history show <id>            Show full results for a run
  ag-doctor history diff <id1> <id2>     Compare two runs side by side
  ag-doctor history delete <id>          Delete a single run
  ag-doctor history clear                Delete all history
`;

export async function runHistory(ctx: CommandContext, sub: string | undefined, rest: string[]): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case 'list':
    case 'ls':
      return runList(ctx);
    case 'show':
      return runShow(ctx, rest[0]);
    case 'diff':
      return runDiff(ctx, rest[0], rest[1]);
    case 'delete':
    case 'rm':
      return runDelete(ctx, rest[0]);
    case 'clear':
      return runClear(ctx);
    default:
      error(`Unknown history subcommand: ${sub}`);
      console.log(USAGE);
      return 2;
  }
}

function summarize(entry: HistoryEntry): string {
  const s = entry.summary ?? { ok: 0, warn: 0, error: 0, info: 0 };
  const { ok: o, warn: w, error: e } = s;
  return `${c.green(`${o} ok`)} · ${c.yellow(`${w} warn`)} · ${c.red(`${e} err`)}`;
}

function runList(ctx: CommandContext): number {
  if (!ctx.json) header('History');
  const entries = listHistory();
  if (ctx.json) {
    console.log(JSON.stringify({ dir: getHistoryDir(), entries }, null, 2));
    return 0;
  }
  info(`Directory: ${getHistoryDir()}`);
  if (entries.length === 0) {
    info('No history yet.');
    return 0;
  }
  console.log('');
  for (const e of entries) {
    const duration = e.durationMs ? `  ${c.gray(`${e.durationMs}ms`)}` : '';
    console.log(
      `  ${c.bold(e.id)}  ${c.gray(e.ranAt)}  ${summarize(e)}${duration}`,
    );
  }
  console.log('');
  ok(`${entries.length} run(s)`);
  return 0;
}

function runShow(ctx: CommandContext, id: string | undefined): number {
  if (!id) {
    error('Usage: ag-doctor history show <id>');
    return 2;
  }
  const entry = loadHistory(id);
  if (!entry) {
    error(`History entry ${id} not found`);
    return 1;
  }
  if (ctx.json) {
    console.log(JSON.stringify(entry, null, 2));
    return 0;
  }
  header(`History — ${entry.id}`);
  info(`Ran at: ${entry.ranAt}`);
  if (entry.durationMs) info(`Duration: ${entry.durationMs}ms`);
  console.log('');
  for (const r of entry.results ?? []) {
    const icon = r.status === 'ok' ? c.green('✔') : r.status === 'warn' ? c.yellow('⚠') : r.status === 'error' ? c.red('✖') : c.blue('ℹ');
    console.log(`${icon} ${c.bold(r.title)} — ${r.status}`);
    console.log(`    ${r.message}`);
    if (r.details) console.log(c.gray(r.details.split('\n').join('\n    ')));
  }
  console.log('');
  console.log(`  ${summarize(entry)}`);
  return 0;
}

function runDiff(ctx: CommandContext, id1: string | undefined, id2: string | undefined): number {
  if (!id1 || !id2) {
    error('Usage: ag-doctor history diff <id1> <id2>');
    return 2;
  }
  const a = loadHistory(id1);
  const b = loadHistory(id2);
  if (!a) {
    error(`History entry ${id1} not found`);
    return 1;
  }
  if (!b) {
    error(`History entry ${id2} not found`);
    return 1;
  }

  const mapA = new Map((a.results ?? []).map((r) => [r.id, r]));
  const mapB = new Map((b.results ?? []).map((r) => [r.id, r]));
  const ids = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();

  if (ctx.json) {
    const rows = ids.map((id) => ({
      id,
      before: mapA.get(id)?.status ?? null,
      after: mapB.get(id)?.status ?? null,
      changed: (mapA.get(id)?.status ?? null) !== (mapB.get(id)?.status ?? null),
    }));
    console.log(JSON.stringify({ a: id1, b: id2, rows }, null, 2));
    return 0;
  }

  header(`Diff — ${id1} → ${id2}`);
  console.log(`${c.gray(a.ranAt)} → ${c.gray(b.ranAt)}`);
  console.log('');
  const rows: string[][] = [];
  for (const id of ids) {
    const ra = mapA.get(id);
    const rb = mapB.get(id);
    const sa = ra?.status ?? c.gray('—');
    const sb = rb?.status ?? c.gray('—');
    const changed = (ra?.status ?? null) !== (rb?.status ?? null);
    rows.push([id, sa, sb, changed ? c.yellow('changed') : c.gray('same')]);
  }
  table(rows);
  return 0;
}

async function runDelete(ctx: CommandContext, id: string | undefined): Promise<number> {
  if (!id) {
    error('Usage: ag-doctor history delete <id>');
    return 2;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Delete history entry ${id}?`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const removed = deleteHistory(id);
  if (!removed) {
    warn(`History entry ${id} not found`);
    return 1;
  }
  ok(`Deleted history entry ${id}`);
  return 0;
}

async function runClear(ctx: CommandContext): Promise<number> {
  const entries = listHistory();
  if (entries.length === 0) {
    info('No history to clear.');
    return 0;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Delete ALL ${entries.length} history entries?`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const n = clearHistory();
  ok(`Deleted ${n} history entries`);
  return 0;
}
