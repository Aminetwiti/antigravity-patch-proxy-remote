/**
 * Dual Summary Store Reconciler
 *
 * Language Server 2.18+ synchronizes `conversation_summaries.db` (SQLite) and
 * `agyhub_summaries_proto.pb` (Protobuf `SummariesState`).
 *
 * This service reconciles:
 * 1. `annotations/*.pbtxt` archive flags into `conversation_summaries.db`
 *    (`raw_summary` field 15 tag 0x7a with subfield 4 `\x20\x01`).
 * 2. `conversations_fts` full-text search table (`archived = 1` for archived sessions).
 * 3. Removes stale `agyhub_summaries_proto.pb` when out-of-sync so Language Server
 *    cleanly rebuilds it from the reconciled SQLite database without resurrecting archived chats.
 * 4. Scrubs `app_storage.json` layout keys for archived sessions so they never reopen in tabs/sidebar.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ParsedAnnotation {
  id: string;
  title?: string;
  archived: boolean;
  pinned: boolean;
  archivalSeconds?: number;
  archivalNanos?: number;
  viewSeconds?: number;
  viewNanos?: number;
}

export interface ReconcileResult {
  ok: boolean;
  totalAnnotations: number;
  archivedAnnotationsCount: number;
  totalSummaries: number;
  reconciledArchivedRawCount: number;
  reconciledFtsCount: number;
  scrubbedStorageKeysCount: number;
  protoCacheInvalidated: boolean;
  error?: string;
}

export function encodeVarint(val: bigint | number): Buffer {
  let v = BigInt(val);
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

export function readVarint(buf: Buffer, offset: number): { val: bigint; bytesRead: number } {
  let val = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset < buf.length) {
    const b = BigInt(buf[offset]);
    bytesRead++;
    val |= (b & 0x7fn) << shift;
    offset++;
    if ((b & 0x80n) === 0n) break;
    shift += 7n;
  }
  return { val, bytesRead };
}

export function encodeLengthDelimited(fieldNum: number, buf: Buffer): Buffer {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(buf.length);
  return Buffer.concat([tag, len, buf]);
}

export function encodeTimestamp(seconds: number, nanos?: number): Buffer {
  const parts: Buffer[] = [];
  if (seconds) {
    const secTag = encodeVarint((1 << 3) | 0);
    parts.push(Buffer.concat([secTag, encodeVarint(seconds)]));
  }
  if (nanos) {
    const nanoTag = encodeVarint((2 << 3) | 0);
    parts.push(Buffer.concat([nanoTag, encodeVarint(nanos)]));
  }
  return Buffer.concat(parts);
}

export function parsePbtxt(pbtxtContent: string, id: string): ParsedAnnotation {
  const res: ParsedAnnotation = {
    id,
    archived: /archived:\s*true/.test(pbtxtContent),
    pinned: /pinned:\s*true/.test(pbtxtContent),
  };
  const tm = pbtxtContent.match(/title:\s*"((?:\\.|[^"\\])*)"/);
  if (tm) res.title = tm[1];

  const am = pbtxtContent.match(/archival_status_timestamp:\s*\{\s*seconds:\s*(\d+)(?:\s+nanos:\s*(\d+))?\s*\}/);
  if (am) {
    res.archivalSeconds = Number(am[1]);
    res.archivalNanos = am[2] ? Number(am[2]) : 0;
  }

  const vm = pbtxtContent.match(/last_user_view_time:\s*\{\s*seconds:\s*(\d+)(?:\s+nanos:\s*(\d+))?\s*\}/);
  if (vm) {
    res.viewSeconds = Number(vm[1]);
    res.viewNanos = vm[2] ? Number(vm[2]) : 0;
  }

  return res;
}

export function encodeAnnotationsField(parsed: ParsedAnnotation): Buffer {
  const parts: Buffer[] = [];
  if (parsed.title) {
    parts.push(encodeLengthDelimited(1, Buffer.from(parsed.title, 'utf8')));
  }
  if (parsed.archived) {
    const tag = encodeVarint((4 << 3) | 0);
    parts.push(Buffer.concat([tag, Buffer.from([1])]));
  }
  if (parsed.archivalSeconds) {
    const tsBuf = encodeTimestamp(parsed.archivalSeconds, parsed.archivalNanos);
    parts.push(encodeLengthDelimited(5, tsBuf));
  }
  if (parsed.viewSeconds) {
    const tsBuf = encodeTimestamp(parsed.viewSeconds, parsed.viewNanos);
    parts.push(encodeLengthDelimited(7, tsBuf));
  }
  if (parsed.pinned) {
    const tag = encodeVarint((12 << 3) | 0);
    parts.push(Buffer.concat([tag, Buffer.from([1])]));
  }
  return encodeLengthDelimited(15, Buffer.concat(parts));
}

export function stripProtobufField(buf: Buffer, fieldNumberToStrip: number): Buffer {
  let offset = 0;
  const retainedChunks: Buffer[] = [];
  while (offset < buf.length) {
    const startOffset = offset;
    const { val: tag, bytesRead: tagBytes } = readVarint(buf, offset);
    offset += tagBytes;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);

    let fieldEnd = offset;
    if (wireType === 0) {
      const { bytesRead: vBytes } = readVarint(buf, offset);
      offset += vBytes;
      fieldEnd = offset;
    } else if (wireType === 1) {
      offset += 8;
      fieldEnd = offset;
    } else if (wireType === 2) {
      const { val: len, bytesRead: lBytes } = readVarint(buf, offset);
      offset += lBytes + Number(len);
      fieldEnd = offset;
    } else if (wireType === 5) {
      offset += 4;
      fieldEnd = offset;
    } else {
      // If unknown wire type encountered, abort stripping safely and return original
      return buf;
    }

    if (fieldNum !== fieldNumberToStrip) {
      retainedChunks.push(buf.subarray(startOffset, fieldEnd));
    }
  }
  return Buffer.concat(retainedChunks);
}

function getDatabaseSync() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite');
    return sqlite.DatabaseSync;
  } catch (_) {
    return null;
  }
}

export function reconcileSummariesOnBoot(options: {
  dataDir?: string;
  appDataDir?: string;
  dryRun?: boolean;
} = {}): ReconcileResult {
  const result: ReconcileResult = {
    ok: true,
    totalAnnotations: 0,
    archivedAnnotationsCount: 0,
    totalSummaries: 0,
    reconciledArchivedRawCount: 0,
    reconciledFtsCount: 0,
    scrubbedStorageKeysCount: 0,
    protoCacheInvalidated: false,
  };

  const dataDir = options.dataDir || path.join(os.homedir(), '.gemini', 'antigravity');
  const dbPath = path.join(dataDir, 'conversation_summaries.db');
  const annotDir = path.join(dataDir, 'annotations');
  const protoPath = path.join(dataDir, 'agyhub_summaries_proto.pb');

  if (!fs.existsSync(dbPath)) {
    return result;
  }

  // 1. Scan annotations
  const annotationsMap = new Map<string, ParsedAnnotation>();
  const archivedIds = new Set<string>();

  if (fs.existsSync(annotDir)) {
    try {
      const files = fs.readdirSync(annotDir);
      for (const f of files) {
        if (!f.endsWith('.pbtxt')) continue;
        const id = f.replace(/\.pbtxt$/, '');
        try {
          const content = fs.readFileSync(path.join(annotDir, f), 'utf8');
          const parsed = parsePbtxt(content, id);
          annotationsMap.set(id, parsed);
          result.totalAnnotations++;
          if (parsed.archived) {
            archivedIds.add(id);
            result.archivedAnnotationsCount++;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 2. Open SQLite database
  const DatabaseSync = getDatabaseSync();
  if (!DatabaseSync) {
    result.ok = false;
    result.error = 'node:sqlite unavailable';
    return result;
  }

  let db: any;
  try {
    db = new DatabaseSync(dbPath);
    try { db.exec('PRAGMA busy_timeout = 5000;'); } catch (_) {}

    // Check if tables exist
    const hasSummariesTable = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'").get());
    if (!hasSummariesTable) {
      db.close();
      return result;
    }

    const hasFtsTable = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations_fts'").get());

    const rows = db.prepare('SELECT conversation_id, title, raw_summary FROM conversation_summaries').all() as Array<{
      conversation_id: string;
      title: string;
      raw_summary?: Buffer | Uint8Array;
    }>;
    result.totalSummaries = rows.length;

    let ftsMap: Map<string, number> | null = null;
    if (hasFtsTable) {
      ftsMap = new Map<string, number>();
      try {
        const ftsRows = db.prepare('SELECT conversation_id, archived FROM conversations_fts WHERE chunk_index = -1').all() as Array<{
          conversation_id: string;
          archived: number;
        }>;
        for (const r of ftsRows) {
          ftsMap.set(r.conversation_id, r.archived);
        }
      } catch (_) {}
    }

    const rawUpdates: Array<{ id: string; newRaw: Buffer }> = [];
    const ftsUpdates: Array<{ id: string; archived: number }> = [];

    for (const row of rows) {
      const annot = annotationsMap.get(row.conversation_id);
      if (!annot) continue;

      if (annot.archived) {
        // Ensure raw_summary has archived: true in field 15
        const origBuf = row.raw_summary ? Buffer.from(row.raw_summary) : Buffer.alloc(0);
        let needsRawUpdate = false;

        const idx15 = origBuf.indexOf(0x7a);
        if (idx15 === -1) {
          needsRawUpdate = true;
        } else {
          // Check if field 15 has \x20\x01
          const lenByte = origBuf[idx15 + 1] || 0;
          const field15Slice = origBuf.subarray(idx15, idx15 + 2 + lenByte);
          if (!field15Slice.includes(Buffer.from([0x20, 0x01]))) {
            needsRawUpdate = true;
          }
        }

        if (needsRawUpdate) {
          const stripped = stripProtobufField(origBuf, 15);
          const newField15 = encodeAnnotationsField(annot);
          const newRaw = Buffer.concat([stripped, newField15]);
          rawUpdates.push({ id: row.conversation_id, newRaw });
        }

        // Check FTS
        if (ftsMap && ftsMap.get(row.conversation_id) !== 1) {
          ftsUpdates.push({ id: row.conversation_id, archived: 1 });
        }
      } else {
        // If unarchived in annot, ensure FTS is 0
        if (ftsMap && ftsMap.get(row.conversation_id) === 1) {
          ftsUpdates.push({ id: row.conversation_id, archived: 0 });
        }
      }
    }

    if (!options.dryRun && (rawUpdates.length > 0 || ftsUpdates.length > 0)) {
      db.exec('BEGIN TRANSACTION;');
      if (rawUpdates.length > 0) {
        const updateRawStmt = db.prepare('UPDATE conversation_summaries SET raw_summary = ? WHERE conversation_id = ?');
        for (const item of rawUpdates) {
          updateRawStmt.run(item.newRaw, item.id);
          result.reconciledArchivedRawCount++;
        }
      }
      if (ftsUpdates.length > 0 && hasFtsTable) {
        const updateFtsStmt = db.prepare('UPDATE conversations_fts SET archived = ? WHERE chunk_index = -1 AND conversation_id = ?');
        for (const item of ftsUpdates) {
          updateFtsStmt.run(item.archived, item.id);
          result.reconciledFtsCount++;
        }
      }
      db.exec('COMMIT;');
    } else {
      result.reconciledArchivedRawCount = rawUpdates.length;
      result.reconciledFtsCount = ftsUpdates.length;
    }

    db.close();
  } catch (err) {
    result.ok = false;
    result.error = (err as Error).message;
    if (db) {
      try { db.close(); } catch (_) {}
    }
    return result;
  }

  // 3. Reconcile / invalidate agyhub_summaries_proto.pb cache
  // If raw_summary or FTS was out of sync, or if proto has missing archive flags,
  // unlink agyhub_summaries_proto.pb so Language Server cleanly rebuilds it on startup
  if (!options.dryRun && fs.existsSync(protoPath)) {
    let protoNeedsRefresh = result.reconciledArchivedRawCount > 0 || result.reconciledFtsCount > 0;
    if (!protoNeedsRefresh) {
      // Check if proto file contains any archived session without 0x20 0x01
      try {
        const protoBuf = fs.readFileSync(protoPath);
        for (const id of archivedIds) {
          const idx = protoBuf.indexOf(Buffer.from(id));
          if (idx !== -1) {
            const entrySlice = protoBuf.subarray(idx, idx + 1000);
            const idx15 = entrySlice.indexOf(0x7a);
            if (idx15 !== -1) {
              const f15 = entrySlice.subarray(idx15, idx15 + 100);
              if (!f15.includes(Buffer.from([0x20, 0x01]))) {
                protoNeedsRefresh = true;
                break;
              }
            } else {
              protoNeedsRefresh = true;
              break;
            }
          }
        }
      } catch (_) {}
    }

    if (protoNeedsRefresh) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupProto = path.join(dataDir, `agyhub_summaries_proto.pb.bak_${ts}`);
        fs.copyFileSync(protoPath, backupProto);
        fs.unlinkSync(protoPath);
        result.protoCacheInvalidated = true;
      } catch (_) {}
    }
  }

  // 4. Scrub app_storage.json
  const appData = options.appDataDir || (process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config')));
  const storagePath = path.join(appData, 'Antigravity', 'app_storage.json');

  if (fs.existsSync(storagePath) && archivedIds.size > 0) {
    try {
      const storageRaw = fs.readFileSync(storagePath, 'utf8');
      const storage = JSON.parse(storageRaw);
      let storageModified = false;

      // Clean pinned conversations
      if (typeof storage.pinned_conversations_order === 'string') {
        try {
          const pinned = JSON.parse(storage.pinned_conversations_order);
          if (Array.isArray(pinned)) {
            const filteredPinned = pinned.filter((id: string) => !archivedIds.has(id));
            if (filteredPinned.length !== pinned.length) {
              storage.pinned_conversations_order = JSON.stringify(filteredPinned);
              storageModified = true;
              result.scrubbedStorageKeysCount += (pinned.length - filteredPinned.length);
            }
          }
        } catch (_) {}
      }

      // Clean active multi-conversation layout & collapsed sidebar keys
      for (const key of Object.keys(storage)) {
        if (key.startsWith('antigravity-multi-conversation-layout-v3-') && key !== 'antigravity-multi-conversation-layout-v3-index') {
          const id = key.replace('antigravity-multi-conversation-layout-v3-', '');
          if (archivedIds.has(id)) {
            delete storage[key];
            storageModified = true;
            result.scrubbedStorageKeysCount++;
          }
        } else if (key.startsWith('sidebarCollapsed-')) {
          const id = key.replace('sidebarCollapsed-', '');
          if (archivedIds.has(id)) {
            delete storage[key];
            storageModified = true;
            result.scrubbedStorageKeysCount++;
          }
        }
      }

      // Clean conversation-input-drafts if present
      if (typeof storage['conversation-input-drafts'] === 'string') {
        try {
          const drafts = JSON.parse(storage['conversation-input-drafts']);
          if (typeof drafts === 'object' && drafts !== null) {
            let draftsMod = false;
            for (const id of Object.keys(drafts)) {
              if (archivedIds.has(id)) {
                delete drafts[id];
                draftsMod = true;
                result.scrubbedStorageKeysCount++;
              }
            }
            if (draftsMod) {
              storage['conversation-input-drafts'] = JSON.stringify(drafts);
              storageModified = true;
            }
          }
        } catch (_) {}
      }

      if (storageModified && !options.dryRun) {
        fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2), 'utf8');
      }
    } catch (_) {}
  }

  return result;
}
