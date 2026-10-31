/**
 * Snapshots — timestamped backups of mutable state (custom_models.json,
 * language_server binary, config.json). Created automatically before
 * risky operations (repair, patch apply, models remove) and on demand.
 *
 * Stored in:
 *   ~/.gemini/antigravity/snapshots/<timestamp>/
 *     ├── manifest.json     # what was captured + metadata
 *     ├── custom_models.json
 *     ├── language_server[.bak]
 *     └── config.json
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAntigravityDataDir } from './paths';
import { getLanguageServerBinary, getLanguageServerBackup } from './paths';
import { getCustomModelsPath } from './paths';
import { getConfigPath } from './config';
import { loadConfig } from './config';

export const SNAPSHOT_DIR_NAME = 'snapshots';

export interface SnapshotManifest {
  id: string;            // timestamp id, e.g. 2026-07-08T12-34-56
  createdAt: string;     // ISO timestamp
  reason: string;        // why the snapshot was created
  files: string[];       // relative paths inside the snapshot dir
  sizeBytes: number;     // total size on disk
  antigravityVersion?: string;
}

export function getSnapshotsDir(): string {
  return path.join(getAntigravityDataDir(), SNAPSHOT_DIR_NAME);
}

export function getSnapshotDir(id: string): string {
  return path.join(getSnapshotsDir(), id);
}

function tsId(): string {
  // Filesystem-safe ISO timestamp
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

function copyIfExists(src: string, dest: string): boolean {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

/**
 * Create a snapshot of all mutable state. Returns the manifest.
 * If `reason` is omitted, defaults to "manual".
 */
export function createSnapshot(reason = 'manual', opts?: { silent?: boolean }): SnapshotManifest {
  const id = tsId();
  const dir = getSnapshotDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const files: string[] = [];

  // 1. custom_models.json
  if (copyIfExists(getCustomModelsPath(), path.join(dir, 'custom_models.json'))) {
    files.push('custom_models.json');
  }

  // 2. language_server binary + backup
  const bin = getLanguageServerBinary();
  if (bin && copyIfExists(bin, path.join(dir, 'language_server'))) {
    files.push('language_server');
  }
  const bak = getLanguageServerBackup();
  if (bak && copyIfExists(bak, path.join(dir, 'language_server.bak'))) {
    files.push('language_server.bak');
  }

  // 3. config.json
  if (copyIfExists(getConfigPath(), path.join(dir, 'config.json'))) {
    files.push('config.json');
  }

  const manifest: SnapshotManifest = {
    id,
    createdAt: new Date().toISOString(),
    reason,
    files,
    sizeBytes: dirSize(dir),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // Enforce maxSnapshots from config
  enforceRetention();

  if (!opts?.silent) {
    // eslint-disable-next-line no-console
    console.log(`[snapshot] created ${id} (${files.length} files, ${manifest.sizeBytes} bytes)`);
  }

  return manifest;
}

/** Enforce the maxSnapshots cap from config (oldest first). */
export function enforceRetention(): void {
  const max = loadConfig().snapshot.maxSnapshots;
  const dir = getSnapshotsDir();
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of entries.slice(max)) {
    fs.rmSync(path.join(dir, old.name), { recursive: true, force: true });
  }
}

/** List all snapshots, newest first. */
export function listSnapshots(): SnapshotManifest[] {
  const dir = getSnapshotsDir();
  if (!fs.existsSync(dir)) return [];
  const out: SnapshotManifest[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SnapshotManifest;
      out.push(m);
    } catch {
      // skip corrupt manifest
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Delete a single snapshot by id. Returns true if removed. */
export function deleteSnapshot(id: string): boolean {
  const dir = getSnapshotDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Restore files from a snapshot. Returns the list of restored paths. */
export function restoreSnapshot(id: string): { ok: boolean; restored: string[]; message: string } {
  const dir = getSnapshotDir(id);
  if (!fs.existsSync(dir)) {
    return { ok: false, restored: [], message: `Snapshot ${id} not found` };
  }
  const restored: string[] = [];
  const map: Record<string, string> = {
    'custom_models.json': getCustomModelsPath(),
    'language_server': getLanguageServerBinary() ?? '',
    'language_server.bak': getLanguageServerBackup() ?? '',
    'config.json': getConfigPath(),
  };
  for (const [rel, dest] of Object.entries(map)) {
    if (!dest) continue;
    const src = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      restored.push(rel);
    } catch (e) {
      return { ok: false, restored, message: `Failed to restore ${rel}: ${(e as Error).message}` };
    }
  }
  return { ok: true, restored, message: `Restored ${restored.length} file(s) from ${id}` };
}

/**
 * Auto-create a snapshot before a risky operation.
 * No-op if config.snapshot.enabled is false.
 */
export function snapshotBefore(reason: string): SnapshotManifest | null {
  const cfg = loadConfig();
  if (!cfg.snapshot.enabled) return null;
  return createSnapshot(reason, { silent: true });
}
