/**
 * vscdb.ts — Access and update Antigravity's state.vscdb (VS Code Global Storage SQLite).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isWsl } from './platform';

export interface VscdbTarget {
  appName: string;
  dbPath: string;
}

function getDatabaseSync() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite');
    return sqlite.DatabaseSync;
  } catch (err) {
    throw new Error(`node:sqlite is required (Node >= 22.5.0 required). ${(err as Error).message}`);
  }
}

/**
 * Locate all existing state.vscdb files across known Antigravity folder variations.
 */
export function findVscdbPaths(): VscdbTarget[] {
  const targets: VscdbTarget[] = [];
  const names = ['Antigravity IDE', 'antigravity', 'Antigravity'];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    for (const name of names) {
      const dbPath = path.join(appData, name, 'User', 'globalStorage', 'state.vscdb');
      if (fs.existsSync(dbPath)) {
        targets.push({ appName: name, dbPath });
      }
    }
  } else if (isWsl()) {
    // WSL: search Windows AppData via /mnt/c
    const userProfile = process.env.USERPROFILE;
    const candidates: string[] = [];
    if (userProfile && fs.existsSync(userProfile)) {
      candidates.push(path.join(userProfile, 'AppData', 'Roaming'));
    }
    if (fs.existsSync('/mnt/c/Users')) {
      try {
        const users = fs.readdirSync('/mnt/c/Users');
        for (const u of users) {
          if (['Default', 'Default User', 'All Users', 'Public'].includes(u)) continue;
          const p = path.join('/mnt/c/Users', u, 'AppData', 'Roaming');
          if (fs.existsSync(p)) candidates.push(p);
        }
      } catch {
        // ignore
      }
    }
    for (const base of candidates) {
      for (const name of names) {
        const dbPath = path.join(base, name, 'User', 'globalStorage', 'state.vscdb');
        if (fs.existsSync(dbPath) && !targets.some(t => t.dbPath === dbPath)) {
          targets.push({ appName: name, dbPath });
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const support = path.join(os.homedir(), 'Library', 'Application Support');
    for (const name of names) {
      const dbPath = path.join(support, name, 'User', 'globalStorage', 'state.vscdb');
      if (fs.existsSync(dbPath)) {
        targets.push({ appName: name, dbPath });
      }
    }
  } else {
    // Linux / other POSIX
    const config = path.join(os.homedir(), '.config');
    for (const name of names) {
      const dbPath = path.join(config, name, 'User', 'globalStorage', 'state.vscdb');
      if (fs.existsSync(dbPath)) {
        targets.push({ appName: name, dbPath });
      }
    }
  }

  return targets;
}

/**
 * Retrieve the current base64 string for trajectorySummaries.
 */
export function getTrajectorySummariesRaw(dbPath: string): string | null {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'");
    const row = stmt.get() as { value?: string } | undefined;
    return row && row.value ? row.value : null;
  } finally {
    db.close();
  }
}

/**
 * Back up existing trajectorySummaries value to a file before rewriting.
 */
export function backupTrajectorySummaries(dbPath: string, rawValue: string): string | null {
  if (!rawValue) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = path.dirname(dbPath);
  const backupPath = path.join(baseDir, `trajectorySummaries_backup_${stamp}.txt`);
  try {
    fs.writeFileSync(backupPath, rawValue, 'utf8');
    return backupPath;
  } catch {
    // If not writable in baseDir, fallback to home directory
    const fallbackPath = path.join(os.homedir(), `trajectorySummaries_backup_${stamp}.txt`);
    try {
      fs.writeFileSync(fallbackPath, rawValue, 'utf8');
      return fallbackPath;
    } catch {
      return null;
    }
  }
}

/**
 * Write updated trajectorySummaries base64 string to state.vscdb ItemTable.
 */
export function writeTrajectorySummaries(dbPath: string, encodedValue: string): void {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN TRANSACTION;');
    const stmt = db.prepare(
      "INSERT INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.trajectorySummaries', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );
    stmt.run(encodedValue);
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw err;
  } finally {
    db.close();
  }
}
