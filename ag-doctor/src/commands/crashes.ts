/**
 * `ag-doctor crashes` — analyze Crashpad crash dumps.
 *
 * Scans the Antigravity Crashpad directory, groups by signature,
 * and shows the top crashes.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info, table } from '../cli/output';

const USAGE = `ag-doctor crashes — analyze Crashpad crash dumps

Usage:
  ag-doctor crashes          List recent crashes
  ag-doctor crashes --json   Output JSON
`;

interface CrashInfo {
  file: string;
  mtime: number;
  size: number;
  signature?: string;
}

interface CrashGroup {
  signature: string;
  count: number;
  latest: string;
  files: string[];
}

function getCrashpadDir(): string | null {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Antigravity', 'Crashpad', 'reports');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'Crashpad', 'reports');
  }
  return path.join(os.homedir(), '.config', 'Antigravity', 'Crashpad', 'reports');
}

function listCrashes(dir: string): CrashInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: CrashInfo[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.dmp')) continue;
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    out.push({ file: f, mtime: stat.mtimeMs, size: stat.size });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function signatureFromFile(file: string): string {
  // Real signatures require minidump parsing; use filename + size as proxy.
  return `${path.basename(file, '.dmp')}`;
}

function groupCrashes(crashes: CrashInfo[]): CrashGroup[] {
  const groups = new Map<string, CrashGroup>();
  for (const c of crashes) {
    const sig = signatureFromFile(c.file);
    const g = groups.get(sig) ?? { signature: sig, count: 0, latest: new Date(c.mtime).toISOString(), files: [] };
    g.count++;
    g.files.push(c.file);
    if (c.mtime > new Date(g.latest).getTime()) g.latest = new Date(c.mtime).toISOString();
    groups.set(sig, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

export async function runCrashes(ctx: CommandContext): Promise<number> {
  if (ctx.options?.help || ctx.options?.h) {
    console.log(USAGE);
    return 0;
  }

  const dir = getCrashpadDir();
  if (!dir) {
    error('Could not determine Crashpad directory');
    return 2;
  }
  const crashes = listCrashes(dir);
  const groups = groupCrashes(crashes);

  if (ctx.json) {
    console.log(JSON.stringify({ dir, crashCount: crashes.length, groups }, null, 2));
    return 0;
  }

  header('Crash dump analysis');
  info(`Directory: ${dir}`);
  if (crashes.length === 0) {
    info('No crash dumps found.');
    return 0;
  }
  console.log('');
  console.log(`${c.bold('Total dumps:')} ${crashes.length}`);
  console.log('');

  const rows: Array<[string, string, string, string]> = [];
  for (const g of groups.slice(0, 5)) {
    rows.push([g.signature.slice(0, 32), String(g.count), g.latest, g.files[0]]);
  }
  table(rows);
  console.log('');
  ok(`Top ${Math.min(groups.length, 5)} crash signatures shown`);
  return 0;
}
