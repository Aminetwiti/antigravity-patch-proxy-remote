/**
 * `ag-doctor db:prune` / `ag-doctor prune`
 * Safely prunes orphan trajectory records in Antigravity's conversation_summaries.db.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import { getAntigravityDataDir } from '../core/paths';
import { c, ok, error, info } from '../cli/output';

export interface PruneResult {
  totalSummaries: number;
  existingConversations: number;
  orphanCount: number;
  prunedCount: number;
  dryRun: boolean;
  bytesBefore: number;
  bytesAfter: number;
  bytesReclaimed: number;
  backupPath?: string;
}

function getDatabaseSync() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite');
    return sqlite.DatabaseSync;
  } catch (err) {
    throw new Error(`node:sqlite is required for database pruning (Node >= 22.5.0 required). ${(err as Error).message}`);
  }
}

export function pruneConversationSummaries(options: { dryRun?: boolean; dataDir?: string } = {}): PruneResult {
  const DatabaseSync = getDatabaseSync();
  const dataDir = options.dataDir || getAntigravityDataDir();
  const dbPath = path.join(dataDir, 'conversation_summaries.db');
  const convDir = path.join(dataDir, 'conversations');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }

  const initialStats = fs.statSync(dbPath);
  const bytesBefore = initialStats.size;

  const filesOnDisk = new Set<string>();
  if (fs.existsSync(convDir)) {
    const entries = fs.readdirSync(convDir);
    for (const file of entries) {
      const id = file.replace(/\.db(-wal|-shm)?$/, '');
      if (id) filesOnDisk.add(id);
    }
  }

  // Open DB read-only first to scan
  const readDb = new DatabaseSync(dbPath, { readOnly: true });
  let rows: Array<{ conversation_id: string }> = [];
  try {
    rows = readDb.prepare('SELECT conversation_id FROM conversation_summaries').all() as Array<{ conversation_id: string }>;
  } finally {
    readDb.close();
  }

  const orphanIds: string[] = [];
  for (const row of rows) {
    if (!filesOnDisk.has(row.conversation_id)) {
      orphanIds.push(row.conversation_id);
    }
  }

  const dryRun = Boolean(options.dryRun);
  let backupPath: string | undefined;

  if (dryRun || orphanIds.length === 0) {
    return {
      totalSummaries: rows.length,
      existingConversations: filesOnDisk.size,
      orphanCount: orphanIds.length,
      prunedCount: 0,
      dryRun,
      bytesBefore,
      bytesAfter: bytesBefore,
      bytesReclaimed: 0,
    };
  }

  // 1. Create a timestamped backup before touching anything
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  backupPath = path.join(dataDir, `conversation_summaries.db.bak_${timestamp}`);
  fs.copyFileSync(dbPath, backupPath);

  if (fs.existsSync(dbPath + '-wal')) {
    try { fs.copyFileSync(dbPath + '-wal', backupPath + '-wal'); } catch { /* ignore */ }
  }
  if (fs.existsSync(dbPath + '-shm')) {
    try { fs.copyFileSync(dbPath + '-shm', backupPath + '-shm'); } catch { /* ignore */ }
  }

  // 2. Open read-write and delete orphan records
  const writeDb = new DatabaseSync(dbPath);
  let prunedCount = 0;
  try {
    const deleteStmt = writeDb.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?');
    writeDb.exec('BEGIN TRANSACTION;');
    for (const id of orphanIds) {
      deleteStmt.run(id);
      prunedCount++;
    }
    writeDb.exec('COMMIT;');

    // Checkpoint WAL and VACUUM to reclaim space
    try {
      writeDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      writeDb.exec('VACUUM;');
    } catch {
      // Non-critical if vacuum fails due to concurrent handle
    }
  } catch (err) {
    try { writeDb.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw err;
  } finally {
    writeDb.close();
  }

  const afterStats = fs.statSync(dbPath);
  const bytesAfter = afterStats.size;
  const bytesReclaimed = Math.max(0, bytesBefore - bytesAfter);

  return {
    totalSummaries: rows.length,
    existingConversations: filesOnDisk.size,
    orphanCount: orphanIds.length,
    prunedCount,
    dryRun: false,
    bytesBefore,
    bytesAfter,
    bytesReclaimed,
    backupPath,
  };
}

export async function runPrune(ctx: CommandContext, sub?: string, rest: string[] = []): Promise<number> {
  const isDryRun = sub === '--dry-run' || rest.includes('--dry-run') || ctx.options['dry-run'] === true;

  try {
    const res = pruneConversationSummaries({ dryRun: isDryRun });

    if (ctx.json) {
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }

    if (res.dryRun) {
      info('Dry-run scan of conversation summaries:');
      console.log(`  Total summaries in DB     : ${c.bold(String(res.totalSummaries))}`);
      console.log(`  Active conversation files : ${c.bold(String(res.existingConversations))}`);
      console.log(`  Orphan summaries detected : ${c.yellow(String(res.orphanCount))}`);
      if (res.orphanCount > 0) {
        console.log(`\nRun ${c.cyan('ag-doctor db:prune')} without --dry-run to purge orphans and vacuum.`);
      } else {
        ok('Database is clean. No orphan summaries found.');
      }
      return 0;
    }

    if (res.orphanCount === 0) {
      ok('Database is already healthy. 0 orphan summaries found.');
      return 0;
    }

    ok(`Successfully pruned ${c.bold(String(res.prunedCount))} orphan summaries!`);
    console.log(`  Database size before : ${(res.bytesBefore / 1024).toFixed(1)} KB`);
    console.log(`  Database size after  : ${(res.bytesAfter / 1024).toFixed(1)} KB (reclaimed ${(res.bytesReclaimed / 1024).toFixed(1)} KB)`);
    if (res.backupPath) {
      info(`Safety backup saved to: ${res.backupPath}`);
    }
    return 0;
  } catch (e) {
    error(`Failed to prune database: ${(e as Error).message}`);
    if (ctx.verbose) console.error((e as Error).stack);
    return 2;
  }
}
