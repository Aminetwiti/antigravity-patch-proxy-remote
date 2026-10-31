/**
 * `ag-doctor snapshot` — manage timestamped backups of mutable state.
 *
 * Subcommands:
 *   list                 List all snapshots (newest first)
 *   create [reason]      Create a snapshot now
 *   restore <id>         Restore files from a snapshot
 *   delete <id>          Delete a single snapshot
 *   clean                Delete all snapshots
 */
import type { CommandContext } from '../types';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  getSnapshotsDir,
} from '../core/snapshot';
import { c, header, ok, warn, error, info, table } from '../cli/output';
import { confirm } from '../cli/prompts';

const USAGE = `ag-doctor snapshot — manage timestamped backups

Usage:
  ag-doctor snapshot list                 List all snapshots
  ag-doctor snapshot create [reason]      Create a snapshot now
  ag-doctor snapshot restore <id>         Restore files from a snapshot
  ag-doctor snapshot delete <id>          Delete a single snapshot
  ag-doctor snapshot clean                Delete ALL snapshots

Snapshots are stored in:
  ~/.gemini/antigravity/snapshots/<timestamp>/
`;

export async function runSnapshot(ctx: CommandContext, sub: string | undefined, rest: string[]): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case 'list':
    case 'ls':
      return runList(ctx);
    case 'create':
      return runCreate(ctx, rest.join(' ') || 'manual');
    case 'restore':
      return runRestore(ctx, rest[0]);
    case 'delete':
    case 'rm':
      return runDelete(ctx, rest[0]);
    case 'clean':
      return runClean(ctx);
    default:
      error(`Unknown snapshot subcommand: ${sub}`);
      console.log(USAGE);
      return 2;
  }
}

function runList(ctx: CommandContext): number {
  if (!ctx.json) header('Snapshots');
  const snaps = listSnapshots();
  if (ctx.json) {
    console.log(JSON.stringify({ dir: getSnapshotsDir(), snapshots: snaps }, null, 2));
    return 0;
  }
  info(`Directory: ${getSnapshotsDir()}`);
  if (snaps.length === 0) {
    info('No snapshots yet.');
    return 0;
  }
  console.log('');
  for (const s of snaps) {
    const sizeKb = (s.sizeBytes / 1024).toFixed(1);
    console.log(
      `  ${c.bold(s.id)}  ${c.gray(s.createdAt)}  ${c.cyan(`[${s.reason}]`)}  ${c.gray(`${s.files.length} files · ${sizeKb} KB`)}`,
    );
  }
  console.log('');
  ok(`${snaps.length} snapshot(s)`);
  return 0;
}

function runCreate(ctx: CommandContext, reason: string): number {
  const m = createSnapshot(reason);
  if (ctx.json) {
    console.log(JSON.stringify(m, null, 2));
  } else {
    ok(`Snapshot ${m.id} created (${m.files.length} files, ${m.sizeBytes} bytes)`);
  }
  return 0;
}

async function runRestore(ctx: CommandContext, id: string | undefined): Promise<number> {
  if (!id) {
    error('Usage: ag-doctor snapshot restore <id>');
    return 2;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Restore files from snapshot ${id}? This will overwrite current state.`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const r = restoreSnapshot(id);
  if (!r.ok) {
    error(r.message);
    return 2;
  }
  ok(r.message);
  return 0;
}

async function runDelete(ctx: CommandContext, id: string | undefined): Promise<number> {
  if (!id) {
    error('Usage: ag-doctor snapshot delete <id>');
    return 2;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Delete snapshot ${id}?`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const removed = deleteSnapshot(id);
  if (!removed) {
    warn(`Snapshot ${id} not found`);
    return 1;
  }
  ok(`Deleted snapshot ${id}`);
  return 0;
}

async function runClean(ctx: CommandContext): Promise<number> {
  const snaps = listSnapshots();
  if (snaps.length === 0) {
    info('No snapshots to clean.');
    return 0;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Delete ALL ${snaps.length} snapshot(s)?`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  for (const s of snaps) deleteSnapshot(s.id);
  ok(`Deleted ${snaps.length} snapshot(s)`);
  return 0;
}
