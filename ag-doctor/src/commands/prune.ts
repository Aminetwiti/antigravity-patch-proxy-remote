/**
 * `ag-doctor db:prune` / `ag-doctor prune`
 * Safely prunes orphan trajectory records in Antigravity's conversation_summaries.db.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CommandContext } from '../types';
import { getAntigravityDataDir } from '../core/paths';
import { c, ok, error, info } from '../cli/output';

export interface PruneResult {
  totalSummaries: number;
  existingConversations: number;
  orphanCount: number;
  archivedCount?: number;
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
  const annotDir = path.join(dataDir, 'annotations');

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

  const archivedIds = new Set<string>();
  if (fs.existsSync(annotDir)) {
    try {
      const annotFiles = fs.readdirSync(annotDir);
      for (const af of annotFiles) {
        if (!af.endsWith('.pbtxt')) continue;
        const id = af.replace(/\.pbtxt$/, '');
        try {
          const content = fs.readFileSync(path.join(annotDir, af), 'utf8');
          if (/archived:\s*true/.test(content)) {
            archivedIds.add(id);
          }
        } catch (_) {}
      }
    } catch (_) {}
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
  const toDeleteIds = new Set<string>();
  let archivedCount = 0;

  for (const row of rows) {
    if (!filesOnDisk.has(row.conversation_id)) {
      orphanIds.push(row.conversation_id);
      toDeleteIds.add(row.conversation_id);
    } else if (archivedIds.has(row.conversation_id)) {
      toDeleteIds.add(row.conversation_id);
      archivedCount++;
    }
  }

  const dryRun = Boolean(options.dryRun);
  let backupPath: string | undefined;

  if (dryRun || toDeleteIds.size === 0) {
    return {
      totalSummaries: rows.length,
      existingConversations: filesOnDisk.size,
      orphanCount: orphanIds.length,
      archivedCount,
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

  // Backup and clean agyhub_summaries_proto.pb so Language Server reconciler rebuilds from pruned DB
  const protoPath = path.join(dataDir, 'agyhub_summaries_proto.pb');
  if (fs.existsSync(protoPath)) {
    const protoBackup = path.join(dataDir, `agyhub_summaries_proto.pb.bak_${timestamp}`);
    try { fs.copyFileSync(protoPath, protoBackup); } catch { /* ignore */ }
    try { fs.unlinkSync(protoPath); } catch { /* ignore */ }
  }

  // Scrub app_storage.json pinned conversations
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  const appStoragePath = path.join(appData, 'Antigravity', 'app_storage.json');
  if (fs.existsSync(appStoragePath)) {
    try {
      const storageRaw = fs.readFileSync(appStoragePath, 'utf8');
      const storage = JSON.parse(storageRaw);
      let storageModified = false;
      if (typeof storage.pinned_conversations_order === 'string') {
        try {
          const pinned = JSON.parse(storage.pinned_conversations_order);
          if (Array.isArray(pinned)) {
            const filteredPinned = pinned.filter((id: string) => !toDeleteIds.has(id));
            if (filteredPinned.length !== pinned.length) {
              storage.pinned_conversations_order = JSON.stringify(filteredPinned);
              storageModified = true;
            }
          }
        } catch (_) {}
      }
      if (storageModified) {
        fs.writeFileSync(appStoragePath, JSON.stringify(storage, null, 2), 'utf8');
      }
    } catch (_) {}
  }

  // 2. Open read-write and delete orphan & archived records
  const writeDb = new DatabaseSync(dbPath);
  let prunedCount = 0;
  try {
    const deleteStmt = writeDb.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?');
    writeDb.exec('BEGIN TRANSACTION;');
    for (const id of toDeleteIds) {
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
    archivedCount,
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
      if (res.archivedCount !== undefined && res.archivedCount > 0) {
        console.log(`  Archived summaries detected: ${c.yellow(String(res.archivedCount))}`);
      }
      if (res.orphanCount > 0 || (res.archivedCount && res.archivedCount > 0)) {
        console.log(`\nRun ${c.cyan('ag-doctor db:prune')} without --dry-run to purge orphans and vacuum.`);
      } else {
        ok('Database is clean. No orphan or archived summaries found.');
      }
      return 0;
    }

    if (res.prunedCount === 0) {
      ok('Database is already healthy. 0 orphan or archived summaries found.');
      return 0;
    }

    ok(`Successfully pruned ${c.bold(String(res.prunedCount))} orphan and archived summaries!`);
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
