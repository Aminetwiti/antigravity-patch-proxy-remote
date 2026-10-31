/**
 * sidebar-rebuilder.ts — Rebuilds Antigravity's conversation index (state.vscdb trajectorySummaries).
 *
 * Fully restores conversations missing from the sidebar, sorts by date (newest first),
 * preserves/recovers titles and workspace associations without external dependencies.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findVscdbPaths, getTrajectorySummariesRaw, backupTrajectorySummaries, writeTrajectorySummaries, VscdbTarget } from './vscdb';
import { isWsl } from './platform';

function getDatabaseSync() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite');
    return sqlite.DatabaseSync;
  } catch (err) {
    throw new Error(`node:sqlite is required. ${(err as Error).message}`);
  }
}

// ─── Protobuf & Varint Helpers ──────────────────────────────────────────────

export function encodeVarint(value: number): Buffer {
  const parts: number[] = [];
  let v = Math.floor(value) >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    parts.push(b);
  } while (v !== 0);
  return Buffer.from(parts.length ? parts : [0]);
}

export function decodeVarint(buf: Buffer, pos: number): { value: number; newPos: number } {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos];
    result |= (b & 0x7f) << shift;
    pos++;
    if ((b & 0x80) === 0) {
      return { value: result >>> 0, newPos: pos };
    }
    shift += 7;
  }
  return { value: result >>> 0, newPos: pos };
}

export function skipField(buf: Buffer, pos: number, wireType: number): number {
  if (wireType === 0) {
    const { newPos } = decodeVarint(buf, pos);
    return newPos;
  } else if (wireType === 2) {
    const { value: len, newPos } = decodeVarint(buf, pos);
    return newPos + len;
  } else if (wireType === 1) {
    return pos + 8;
  } else if (wireType === 5) {
    return pos + 4;
  }
  return pos;
}

export function iterLengthDelimited(buf: Buffer, targetField: number): Buffer[] {
  const results: Buffer[] = [];
  let pos = 0;
  try {
    while (pos < buf.length) {
      const { value: tag, newPos: p1 } = decodeVarint(buf, pos);
      pos = p1;
      const wireType = tag & 7;
      const fieldNum = tag >>> 3;
      if (wireType === 2) {
        const { value: len, newPos: p2 } = decodeVarint(buf, pos);
        const end = p2 + len;
        if (end > buf.length) break;
        if (fieldNum === targetField) {
          results.push(buf.subarray(p2, end));
        }
        pos = end;
      } else {
        const next = skipField(buf, pos, wireType);
        if (next <= pos || next > buf.length) break;
        pos = next;
      }
    }
  } catch {
    // ignore parse errors in corrupted blobs
  }
  return results;
}

export function stripField(buf: Buffer, targetField: number): Buffer {
  const chunks: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    let tag = 0;
    try {
      const d = decodeVarint(buf, pos);
      tag = d.value;
      pos = d.newPos;
    } catch {
      chunks.push(buf.subarray(start));
      break;
    }
    const wireType = tag & 7;
    const fieldNum = tag >>> 3;
    const next = skipField(buf, pos, wireType);
    if (next <= pos || next > buf.length) {
      chunks.push(buf.subarray(start));
      break;
    }
    pos = next;
    if (fieldNum !== targetField) {
      chunks.push(buf.subarray(start, pos));
    }
  }
  return Buffer.concat(chunks);
}

export function encodeLengthDelimited(fieldNum: number, data: Buffer): Buffer {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

export function encodeStringField(fieldNum: number, str: string): Buffer {
  return encodeLengthDelimited(fieldNum, Buffer.from(str, 'utf8'));
}

export function buildTimestampFields(epochSeconds: number): Buffer {
  const tsInner = Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(Math.floor(epochSeconds))]);
  return Buffer.concat([
    encodeLengthDelimited(3, tsInner),
    encodeLengthDelimited(7, tsInner),
    encodeLengthDelimited(10, tsInner),
  ]);
}

export function buildTimestampField(fieldNum: number, epochSeconds: number): Buffer {
  const tsInner = Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(Math.floor(epochSeconds))]);
  return encodeLengthDelimited(fieldNum, tsInner);
}

export function extractTimestampSeconds(innerBlob: Buffer, fieldNum: number): number | null {
  const list = iterLengthDelimited(innerBlob, fieldNum);
  let maxSec: number | null = null;
  for (const item of list) {
    try {
      let pos = 0;
      while (pos < item.length) {
        const { value: tag, newPos } = decodeVarint(item, pos);
        pos = newPos;
        const fn = tag >>> 3;
        const wt = tag & 7;
        if (fn === 1 && wt === 0) {
          const { value: sec, newPos: p2 } = decodeVarint(item, pos);
          pos = p2;
          if (maxSec === null || sec > maxSec) maxSec = sec;
          break;
        }
        pos = skipField(item, pos, wt);
      }
    } catch {
      // ignore
    }
  }
  return maxSec;
}

// ─── Workspace Helpers ──────────────────────────────────────────────────────

export function pathToWorkspaceUri(folderPath: string): string {
  if (folderPath.startsWith('vscode-remote://') || folderPath.startsWith('file:///')) {
    return folderPath;
  }
  let p = folderPath.replace(/\\/g, '/');
  if (p.length >= 2 && p[1] === ':') {
    const drive = p[0].toLowerCase();
    const rest = p.slice(2);
    return `file:///${drive}:${rest}`;
  }
  return `file:///${p.replace(/^\/+/, '')}`;
}

export function buildWorkspaceField(folderPath: string): Buffer {
  const uri = pathToWorkspaceUri(folderPath);
  const subMsg = Buffer.concat([
    encodeStringField(1, uri),
    encodeStringField(2, uri),
  ]);
  return encodeLengthDelimited(9, subMsg);
}

export function extractWorkspaceHint(innerBlob: Buffer): string | null {
  if (!innerBlob || innerBlob.length === 0) return null;
  try {
    let pos = 0;
    while (pos < innerBlob.length) {
      const { value: tag, newPos } = decodeVarint(innerBlob, pos);
      pos = newPos;
      const wireType = tag & 7;
      const fieldNum = tag >>> 3;
      if (wireType === 2) {
        const { value: len, newPos: p2 } = decodeVarint(innerBlob, pos);
        const content = innerBlob.subarray(p2, p2 + len);
        pos = p2 + len;
        if (fieldNum > 1) {
          const text = content.toString('utf8');
          if (text.includes('file:///') || text.includes('vscode-remote://')) {
            return text;
          }
        }
      } else {
        pos = skipField(innerBlob, pos, wireType);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ─── Prompt & Title Formatting ──────────────────────────────────────────────

export function normalizePromptText(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt.replace(/\s+/g, ' ').trim();
}

export function collapsePromptUrls(prompt: string): string {
  return prompt.replace(/https?:\/\/[^\s<>()]+/gi, (url) => {
    let raw = url;
    let trailing = '';
    while (raw && '.,!?;:)]}'.includes(raw[raw.length - 1])) {
      trailing = raw[raw.length - 1] + trailing;
      raw = raw.slice(0, -1);
    }
    try {
      const u = new URL(raw);
      return (u.hostname || raw) + trailing;
    } catch {
      return url;
    }
  });
}

export function truncatePromptTitle(text: string, maxChars = 60, maxWords = 10): string {
  const words = text.split(' ');
  let truncated = words.length > maxWords;
  const slice = words.slice(0, maxWords);
  let result = '';
  for (const w of slice) {
    const candidate = result ? `${result} ${w}` : w;
    if (candidate.length > maxChars) {
      truncated = true;
      break;
    }
    result = candidate;
  }
  if (!result && text) {
    result = text.slice(0, maxChars).trimEnd();
    truncated = text.length > result.length;
  }
  if (truncated) {
    result = result.replace(/[.,;:!?]+$/, '');
    while (result && result.length + 1 > maxChars) {
      const lastSpace = result.lastIndexOf(' ');
      if (lastSpace !== -1) {
        result = result.slice(0, lastSpace);
      } else {
        result = result.slice(0, maxChars - 1).trimEnd();
        break;
      }
    }
    result += '…';
  }
  return result;
}

export function formatPromptTitle(prompt: string): string | null {
  let normalized = normalizePromptText(prompt);
  if (!normalized) return null;
  normalized = normalizePromptText(collapsePromptUrls(normalized));
  normalized = normalized.replace(/^#{1,6}\s+/, '');

  const match = normalized.match(/^(.+?[.!?])(?:\s|$)/);
  if (match) {
    const firstSentence = match[1].trim();
    if (firstSentence.length <= 60 && firstSentence.split(' ').length <= 10) {
      return firstSentence;
    }
  }

  const truncated = truncatePromptTitle(normalized);
  return truncated || null;
}

export function extractPromptFromConversationDb(dbPath: string): string | null {
  const DatabaseSync = getDatabaseSync();
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    // Find step table name
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    let stepTable: string | null = null;
    let hasIdx = false;
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string }>;
      const colNames = new Set(cols.map(c => c.name));
      if (colNames.has('step_type') && colNames.has('step_payload')) {
        stepTable = `"${t.name}"`;
        hasIdx = colNames.has('idx');
        break;
      }
    }
    if (!stepTable) return null;

    const orderCol = hasIdx ? '"idx"' : 'rowid';
    const rows = db.prepare(`SELECT step_payload FROM ${stepTable} WHERE step_type = 14 ORDER BY ${orderCol}`).all() as Array<{ step_payload: Buffer | Uint8Array }>;

    for (const row of rows) {
      if (!row || !row.step_payload) continue;
      const payload = Buffer.from(row.step_payload);
      for (const container of iterLengthDelimited(payload, 19)) {
        for (const titleBytes of iterLengthDelimited(container, 2)) {
          const prompt = titleBytes.toString('utf8');
          const normalized = normalizePromptText(prompt);
          if (normalized) return normalized;
        }
      }
    }
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
  return null;
}

export function getTitleFromBrain(conversationId: string, brainDirs: string[]): string | null {
  for (const bDir of brainDirs) {
    const sessionDir = path.join(bDir, conversationId);
    if (!fs.existsSync(sessionDir)) continue;
    try {
      const files = fs.readdirSync(sessionDir);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(sessionDir, f), 'utf8');
        const match = content.match(/^#\s+(.+)$/m);
        if (match && match[1]) {
          const t = match[1].trim();
          if (t && !t.toLowerCase().startsWith('conversation')) return t;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// ─── Directory Discovery ────────────────────────────────────────────────────

export function getAllGeminiDirs(): { convDirs: string[]; brainDirs: string[]; wsDir: string | null } {
  const home = os.homedir();
  const convDirs: string[] = [];
  const brainDirs: string[] = [];
  let wsDir: string | null = null;

  const names = ['antigravity-ide', 'antigravity', 'antigravity-backup'];
  for (const n of names) {
    convDirs.push(path.join(home, '.gemini', n, 'conversations'));
    brainDirs.push(path.join(home, '.gemini', n, 'brain'));
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const ws1 = path.join(appData, 'Antigravity IDE', 'User', 'workspaceStorage');
    const ws2 = path.join(appData, 'antigravity', 'User', 'workspaceStorage');
    wsDir = fs.existsSync(ws1) ? ws1 : (fs.existsSync(ws2) ? ws2 : null);
  } else if (process.platform === 'darwin') {
    const sup = path.join(home, 'Library', 'Application Support');
    const ws1 = path.join(sup, 'Antigravity IDE', 'User', 'workspaceStorage');
    wsDir = fs.existsSync(ws1) ? ws1 : null;
  } else {
    const cfg = path.join(home, '.config');
    const ws1 = path.join(cfg, 'Antigravity IDE', 'User', 'workspaceStorage');
    wsDir = fs.existsSync(ws1) ? ws1 : null;
  }

  return {
    convDirs: convDirs.filter(d => fs.existsSync(d)),
    brainDirs: brainDirs.filter(d => fs.existsSync(d)),
    wsDir,
  };
}

export function loadWorkspaceStorageUris(wsDir: string | null): string[] {
  if (!wsDir || !fs.existsSync(wsDir)) return [];
  const uris: string[] = [];
  try {
    const entries = fs.readdirSync(wsDir);
    for (const name of entries) {
      const p = path.join(wsDir, name, 'workspace.json');
      if (fs.existsSync(p)) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          const uri = data.folder || data.workspace;
          if (uri && typeof uri === 'string') uris.push(uri);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  uris.sort((a, b) => b.length - a.length);
  return uris;
}

// ─── Existing Metadata Extractor ───────────────────────────────────────────

export function extractExistingMetadata(rawB64: string | null): {
  titles: Map<string, string>;
  innerBlobs: Map<string, Buffer>;
} {
  const titles = new Map<string, string>();
  const innerBlobs = new Map<string, Buffer>();
  if (!rawB64) return { titles, innerBlobs };

  try {
    const decoded = Buffer.from(rawB64, 'base64');
    let pos = 0;
    while (pos < decoded.length) {
      const { value: tag, newPos } = decodeVarint(decoded, pos);
      pos = newPos;
      const wireType = tag & 7;
      if (wireType !== 2) break;
      const { value: len, newPos: p2 } = decodeVarint(decoded, pos);
      const entry = decoded.subarray(p2, p2 + len);
      pos = p2 + len;

      let ep = 0;
      let uid: string | null = null;
      let infoB64: string | null = null;
      while (ep < entry.length) {
        const { value: t, newPos: ep1 } = decodeVarint(entry, ep);
        ep = ep1;
        const fn = t >>> 3;
        const wt = t & 7;
        if (wt === 2) {
          const { value: l, newPos: ep2 } = decodeVarint(entry, ep);
          const content = entry.subarray(ep2, ep2 + l);
          ep = ep2 + l;
          if (fn === 1) {
            uid = content.toString('utf8');
          } else if (fn === 2) {
            let sp = 0;
            const { newPos: sp1 } = decodeVarint(content, sp);
            sp = sp1;
            const { value: sl, newPos: sp2 } = decodeVarint(content, sp);
            infoB64 = content.subarray(sp2, sp2 + sl).toString('utf8');
          }
        } else if (wt === 0) {
          const { newPos: ep2 } = decodeVarint(entry, ep);
          ep = ep2;
        } else {
          break;
        }
      }

      if (uid && infoB64) {
        try {
          const rawInner = Buffer.from(infoB64, 'base64');
          innerBlobs.set(uid, rawInner);
          let ip = 0;
          const { newPos: ip1 } = decodeVarint(rawInner, ip);
          ip = ip1;
          const { value: il, newPos: ip2 } = decodeVarint(rawInner, ip);
          const title = rawInner.subarray(ip2, ip2 + il).toString('utf8');
          const isFallback = /^Conversation \([A-Za-z]{3} \d{2}\) [a-f0-9]{8}$/i.test(title) || title === `Conversation ${uid.slice(0, 8)}`;
          if (!isFallback) {
            titles.set(uid, title);
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return { titles, innerBlobs };
}

// ─── Entry Builder ──────────────────────────────────────────────────────────

export function buildTrajectoryEntry(
  conversationId: string,
  title: string,
  existingInnerData?: Buffer,
  workspacePath?: string,
  mtimeSeconds?: number,
  sourceIsDb = false
): Buffer {
  let innerInfo: Buffer;

  if (existingInnerData && existingInnerData.length > 0) {
    const preserved = stripField(existingInnerData, 1);
    innerInfo = Buffer.concat([encodeStringField(1, title), preserved]);

    if (workspacePath) {
      innerInfo = stripField(innerInfo, 9);
      innerInfo = Buffer.concat([innerInfo, buildWorkspaceField(workspacePath)]);
    }

    if (sourceIsDb && mtimeSeconds) {
      const indexedMtime = extractTimestampSeconds(existingInnerData, 3);
      if (indexedMtime === null || mtimeSeconds > indexedMtime) {
        innerInfo = stripField(innerInfo, 3);
        innerInfo = Buffer.concat([innerInfo, buildTimestampField(3, mtimeSeconds)]);
      }
    } else if (mtimeSeconds && extractTimestampSeconds(existingInnerData, 3) === null) {
      innerInfo = Buffer.concat([innerInfo, buildTimestampFields(mtimeSeconds)]);
    }
  } else {
    innerInfo = encodeStringField(1, title);
    if (workspacePath) {
      innerInfo = Buffer.concat([innerInfo, buildWorkspaceField(workspacePath)]);
    }
    if (mtimeSeconds) {
      innerInfo = Buffer.concat([innerInfo, buildTimestampFields(mtimeSeconds)]);
    }
  }

  const infoB64 = innerInfo.toString('base64');
  const subMsg = encodeStringField(1, infoB64);

  return Buffer.concat([
    encodeStringField(1, conversationId),
    encodeLengthDelimited(2, subMsg),
  ]);
}

// ─── Main Rebuild Pipeline ─────────────────────────────────────────────────

export interface RebuildSidebarResult {
  totalConversations: number;
  titlesPreserved: number;
  titlesFromBrain: number;
  titlesFromPrompt: number;
  titlesFallback: number;
  workspacesMapped: number;
  databasesUpdated: number;
  backupsCreated: string[];
  dryRun: boolean;
}

export async function rebuildSidebar(options: { dryRun?: boolean; vscdbTargets?: VscdbTarget[] } = {}): Promise<RebuildSidebarResult> {
  const dryRun = Boolean(options.dryRun);
  const targets = options.vscdbTargets || findVscdbPaths();

  if (targets.length === 0) {
    throw new Error('No Antigravity state.vscdb databases found on this system.');
  }

  const { convDirs, brainDirs } = getAllGeminiDirs();

  // 1. Gather all conversation files
  const catalog = new Map<string, { path: string; isDb: boolean; mtime: number }>();
  for (const dir of convDirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const name of files) {
        const lower = name.toLowerCase();
        if (lower.endsWith('.db-shm') || lower.endsWith('.db-wal')) continue;
        const isDb = lower.endsWith('.db');
        const isPb = lower.endsWith('.pb');
        if (!isDb && !isPb) continue;

        const id = name.replace(/\.(db|pb)$/i, '');
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        const mtime = Math.floor(stat.mtimeMs / 1000);

        // Priority: .db beats .pb, earlier configured folder beats later
        if (!catalog.has(id) || (isDb && !catalog.get(id)!.isDb)) {
          catalog.set(id, { path: fullPath, isDb, mtime });
        }
      }
    } catch {
      // ignore inaccessible dirs
    }
  }

  // 2. Extract existing metadata from all target databases
  const mergedTitles = new Map<string, string>();
  const mergedInnerBlobs = new Map<string, Buffer>();

  for (const t of targets) {
    const raw = getTrajectorySummariesRaw(t.dbPath);
    if (raw) {
      const { titles, innerBlobs } = extractExistingMetadata(raw);
      for (const [k, v] of titles) {
        if (!mergedTitles.has(k)) mergedTitles.set(k, v);
      }
      for (const [k, v] of innerBlobs) {
        if (!mergedInnerBlobs.has(k)) mergedInnerBlobs.set(k, v);
      }
    }
  }

  // 3. Resolve titles and workspaces for each conversation
  let titlesPreserved = 0;
  let titlesFromBrain = 0;
  let titlesFromPrompt = 0;
  let titlesFallback = 0;
  let workspacesMapped = 0;

  interface ResolvedEntry {
    id: string;
    title: string;
    source: 'preserved' | 'brain' | 'prompt' | 'fallback';
    innerData?: Buffer;
    wsPath?: string;
    mtime: number;
    isDb: boolean;
  }

  const resolved: ResolvedEntry[] = [];

  for (const [id, item] of catalog) {
    const existingTitle = mergedTitles.get(id);
    const innerData = mergedInnerBlobs.get(id);

    let title: string | null = null;
    let source: 'preserved' | 'brain' | 'prompt' | 'fallback' = 'fallback';

    if (existingTitle) {
      title = existingTitle;
      source = 'preserved';
      titlesPreserved++;
    } else {
      // Try brain
      const brainTitle = getTitleFromBrain(id, brainDirs);
      if (brainTitle) {
        title = brainTitle;
        source = 'brain';
        titlesFromBrain++;
      } else if (item.isDb) {
        // Try user prompt
        const prompt = extractPromptFromConversationDb(item.path);
        const formatted = prompt ? formatPromptTitle(prompt) : null;
        if (formatted) {
          title = formatted;
          source = 'prompt';
          titlesFromPrompt++;
        }
      }

      if (!title) {
        const d = new Date(item.mtime * 1000);
        const month = d.toLocaleString('en-US', { month: 'short' });
        const day = String(d.getDate()).padStart(2, '0');
        title = `Conversation (${month} ${day}) ${id.slice(0, 8)}`;
        source = 'fallback';
        titlesFallback++;
      }
    }

    // Check workspace
    let wsHint = innerData ? extractWorkspaceHint(innerData) : null;
    if (wsHint) workspacesMapped++;

    resolved.push({
      id,
      title,
      source,
      innerData,
      wsPath: wsHint || undefined,
      mtime: item.mtime,
      isDb: item.isDb,
    });
  }

  // Sort by newest timestamp descending
  resolved.sort((a, b) => b.mtime - a.mtime);

  // 4. Build binary trajectorySummaries protobuf
  const entryBuffers: Buffer[] = [];
  for (const r of resolved) {
    const entryBuf = buildTrajectoryEntry(
      r.id,
      r.title,
      r.innerData,
      undefined,
      r.mtime,
      r.isDb
    );
    entryBuffers.push(encodeLengthDelimited(1, entryBuf));
  }

  const finalPayload = Buffer.concat(entryBuffers);
  const encodedValue = finalPayload.toString('base64');

  // 5. Write to targets (unless dryRun)
  const backupsCreated: string[] = [];
  let databasesUpdated = 0;

  if (!dryRun) {
    for (const t of targets) {
      const currentRaw = getTrajectorySummariesRaw(t.dbPath);
      if (currentRaw) {
        const bk = backupTrajectorySummaries(t.dbPath, currentRaw);
        if (bk) backupsCreated.push(bk);
      }
      writeTrajectorySummaries(t.dbPath, encodedValue);
      databasesUpdated++;
    }
  }

  return {
    totalConversations: catalog.size,
    titlesPreserved,
    titlesFromBrain,
    titlesFromPrompt,
    titlesFallback,
    workspacesMapped,
    databasesUpdated,
    backupsCreated,
    dryRun,
  };
}
