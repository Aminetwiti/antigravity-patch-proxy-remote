/**
 * History — persistent ring buffer of doctor runs.
 *
 * Stored as JSON lines in:
 *   ~/.gemini/antigravity/history/<timestamp>.json
 *
 * Each file contains one run result set plus metadata.
 * Retention is controlled by config.history.maxRuns.
 */
import fs from 'fs';
import path from 'path';
import { getAntigravityDataDir } from './paths';
import { loadConfig } from './config';
import type { CheckResult } from '../types';

export const HISTORY_DIR_NAME = 'history';

export interface HistoryEntry {
  id: string;
  ranAt: string;
  results?: CheckResult[];
  summary?: {
    ok: number;
    warn: number;
    error: number;
    info: number;
  };
  durationMs?: number;
  tags?: string[];
  kind?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export function getHistoryDir(): string {
  return path.join(getAntigravityDataDir(), HISTORY_DIR_NAME);
}

function tsId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

export function fileForId(id: string): string {
  return path.join(getHistoryDir(), `${id}.json`);
}

/** Save a doctor run to history. Enforces retention. */
export function saveHistory(entry: Omit<HistoryEntry, 'id' | 'ranAt'>): HistoryEntry {
  const dir = getHistoryDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = tsId();
  const ranAt = new Date().toISOString();
  const full: HistoryEntry = { id, ranAt, ...entry };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2), 'utf-8');
  enforceRetention();
  return full;
}

/** Enforce maxRuns retention (oldest first). */
export function enforceRetention(): void {
  const max = loadConfig().history.maxRuns;
  const dir = getHistoryDir();
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(max)) {
    fs.rmSync(path.join(dir, old.name), { force: true });
  }
}

/** List history entries, newest first. */
export function listHistory(): HistoryEntry[] {
  const dir = getHistoryDir();
  if (!fs.existsSync(dir)) return [];
  const out: HistoryEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      out.push(JSON.parse(raw) as HistoryEntry);
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}

/** Load a single history entry by id, or the latest if id === 'latest'. */
export function loadHistory(id: string): HistoryEntry | null {
  const resolved = resolveHistoryId(id);
  if (!resolved) return null;
  const p = fileForId(resolved);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as HistoryEntry;
  } catch {
    return null;
  }
}

/** Resolve 'latest' to the most recent history id. */
function resolveHistoryId(id: string): string | null {
  if (id !== 'latest') return id;
  const latest = listHistory()[0];
  return latest?.id ?? null;
}

/** Delete a single history entry by id. Returns true if removed. */
export function deleteHistory(id: string): boolean {
  const resolved = resolveHistoryId(id);
  if (!resolved) return false;
  const p = fileForId(resolved);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { force: true });
  return true;
}

/** Clear all history. */
export function clearHistory(): number {
  const dir = getHistoryDir();
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) fs.rmSync(path.join(dir, f), { force: true });
  return files.length;
}
