/**
 * Backup Antigravity Conversation Databases & Sessions.
 * Safeguards conversation_summaries.db, conversations/*.db, and agyhub_summaries_proto.pb
 * to prevent session loss on remote access or unexpected IDE updates.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 5;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else if (stats.isFile()) {
    fs.copyFileSync(src, dest);
  }
}

function rotateBackups(backupsDir, maxKeep) {
  try {
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('sessions_'))
      .map((e) => ({
        name: e.name,
        path: path.join(backupsDir, e.name),
        time: fs.statSync(path.join(backupsDir, e.name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    if (entries.length > maxKeep) {
      const toDelete = entries.slice(maxKeep);
      for (const oldBackup of toDelete) {
        fs.rmSync(oldBackup.path, { recursive: true, force: true });
        console.log(`[SessionBackup] Pruned old snapshot: ${oldBackup.name}`);
      }
    }
  } catch (err) {
    console.warn('[SessionBackup] Warning: failed to rotate old backups:', err.message);
  }
}

function runBackup() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('[SessionBackup] Antigravity data dir not found at:', DATA_DIR);
    return;
  }

  ensureDir(BACKUPS_DIR);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const targetDir = path.join(BACKUPS_DIR, `sessions_${timestamp}`);

  const targets = [
    'conversation_summaries.db',
    'conversation_summaries.db-wal',
    'conversation_summaries.db-shm',
    'agyhub_summaries_proto.pb',
    'app_storage.json',
    'conversations',
    'annotations',
  ];

  let backedUpCount = 0;
  for (const item of targets) {
    const srcPath = path.join(DATA_DIR, item);
    if (fs.existsSync(srcPath)) {
      ensureDir(targetDir);
      const destPath = path.join(targetDir, item);
      try {
        copyRecursive(srcPath, destPath);
        backedUpCount++;
      } catch (e) {
        console.warn(`[SessionBackup] Failed to copy ${item}:`, e.message);
      }
    }
  }

  if (backedUpCount > 0) {
    console.log(`[SessionBackup] Successfully backed up ${backedUpCount} session database(s) to:`);
    console.log(`                ${targetDir}`);
    rotateBackups(BACKUPS_DIR, MAX_BACKUPS);
  } else {
    console.log('[SessionBackup] No active conversation databases found to backup in:', DATA_DIR);
  }
}

runBackup();
