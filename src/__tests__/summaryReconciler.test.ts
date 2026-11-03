import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';
import {
  reconcileSummariesOnBoot,
  parsePbtxt,
  encodeAnnotationsField,
  stripProtobufField,
  encodeVarint,
  readVarint,
} from '../services/summaryReconciler';

describe('summaryReconciler', () => {
  let tempDir: string;
  let tempAppData: string;
  let dataDir: string;
  let dbPath: string;
  let annotDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-reconciler-'));
    dataDir = path.join(tempDir, 'gemini_data');
    tempAppData = path.join(tempDir, 'app_data');
    dbPath = path.join(dataDir, 'conversation_summaries.db');
    annotDir = path.join(dataDir, 'annotations');

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(annotDir, { recursive: true });
    fs.mkdirSync(path.join(tempAppData, 'Antigravity'), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('parses .pbtxt files correctly', () => {
    const raw = `title:"Test Session"  archived:true  archival_status_timestamp:{seconds:1793564170  nanos:743303000}  last_user_view_time:{seconds:1793623132  nanos:476000000}`;
    const parsed = parsePbtxt(raw, 'test-id');
    expect(parsed.id).toBe('test-id');
    expect(parsed.title).toBe('Test Session');
    expect(parsed.archived).toBe(true);
    expect(parsed.pinned).toBe(false);
    expect(parsed.archivalSeconds).toBe(1793564170);
    expect(parsed.archivalNanos).toBe(743303000);
    expect(parsed.viewSeconds).toBe(1793623132);
    expect(parsed.viewNanos).toBe(476000000);
  });

  it('encodes annotations field 15 with subfield 4 (archived = true)', () => {
    const parsed = {
      id: 'test-id',
      title: 'Hello',
      archived: true,
      pinned: false,
    };
    const encoded = encodeAnnotationsField(parsed);
    expect(encoded[0]).toBe(0x7a); // tag 15 << 3 | 2
    expect(encoded.includes(Buffer.from([0x20, 0x01]))).toBe(true); // subfield 4, bool 1
  });

  it('strips specified protobuf field correctly', () => {
    // Field 1 (tag 0x0a): string "abc" (length 3)
    // Field 15 (tag 0x7a): length 2, \x20\x01
    const f1 = Buffer.concat([Buffer.from([0x0a, 3]), Buffer.from('abc', 'utf8')]);
    const f15 = Buffer.from([0x7a, 2, 0x20, 0x01]);
    const full = Buffer.concat([f1, f15]);

    const stripped = stripProtobufField(full, 15);
    expect(stripped.equals(f1)).toBe(true);
    expect(stripped.includes(0x7a)).toBe(false);
  });

  it('reconciles SQLite database, conversations_fts, and scrubs app_storage.json', () => {
    // 1. Create SQLite database
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text NOT NULL DEFAULT "",
        raw_summary blob
      );
      CREATE TABLE conversations_fts (
        conversation_id UNINDEXED,
        chunk_index UNINDEXED,
        archived UNINDEXED,
        title
      );
    `);

    // Insert active conversation and an out-of-sync archived conversation
    const insertSummary = db.prepare('INSERT INTO conversation_summaries (conversation_id, title, raw_summary) VALUES (?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO conversations_fts (conversation_id, chunk_index, archived, title) VALUES (?, ?, ?, ?)');

    // Unarchived session
    const activeRaw = Buffer.concat([Buffer.from([0x0a, 6]), Buffer.from('Active', 'utf8')]);
    insertSummary.run('conv-active', 'Active', activeRaw);
    insertFts.run('conv-active', -1, 0, 'Active');

    // Archived session with stale raw_summary (missing 0x20 0x01) and fts archived=0
    const staleArchivedRaw = Buffer.concat([
      Buffer.from([0x0a, 8]), Buffer.from('Archived', 'utf8'),
      Buffer.from([0x7a, 4, 0x0a, 2, 0x48, 0x69]), // field 15 has title "Hi" but no archived flag
    ]);
    insertSummary.run('conv-archived-1', 'Archived', staleArchivedRaw);
    insertFts.run('conv-archived-1', -1, 0, 'Archived');

    db.close();

    // 2. Write annotations
    fs.writeFileSync(path.join(annotDir, 'conv-active.pbtxt'), 'title:"Active"');
    fs.writeFileSync(path.join(annotDir, 'conv-archived-1.pbtxt'), 'title:"Archived" archived:true');

    // 3. Write stale agyhub_summaries_proto.pb
    const protoPath = path.join(dataDir, 'agyhub_summaries_proto.pb');
    fs.writeFileSync(protoPath, 'mock-proto-state');

    // 4. Write app_storage.json containing layout keys for conv-archived-1
    const storagePath = path.join(tempAppData, 'Antigravity', 'app_storage.json');
    const storageContent = {
      pinned_conversations_order: JSON.stringify(['conv-active', 'conv-archived-1']),
      'antigravity-multi-conversation-layout-v3-conv-archived-1': { width: 400 },
      'antigravity-multi-conversation-layout-v3-conv-active': { width: 500 },
      'sidebarCollapsed-conv-archived-1': true,
      'conversation-input-drafts': JSON.stringify({
        'conv-archived-1': 'some draft',
        'conv-active': 'active draft',
      }),
    };
    fs.writeFileSync(storagePath, JSON.stringify(storageContent), 'utf8');

    // 5. Run reconciliation
    const result = reconcileSummariesOnBoot({
      dataDir,
      appDataDir: tempAppData,
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.totalAnnotations).toBe(2);
    expect(result.archivedAnnotationsCount).toBe(1);
    expect(result.reconciledArchivedRawCount).toBe(1);
    expect(result.reconciledFtsCount).toBe(1);
    expect(result.protoCacheInvalidated).toBe(true);
    expect(fs.existsSync(protoPath)).toBe(false); // Stale cache unlinked

    // 6. Verify SQLite raw_summary now contains field 15 with 0x20 0x01
    const checkDb = new DatabaseSync(dbPath, { readOnly: true });
    const row = checkDb.prepare('SELECT raw_summary FROM conversation_summaries WHERE conversation_id = ?').get('conv-archived-1') as { raw_summary: Buffer };
    const rawBuf = Buffer.from(row.raw_summary);
    expect(rawBuf.includes(0x7a)).toBe(true);
    expect(rawBuf.includes(Buffer.from([0x20, 0x01]))).toBe(true);

    // Verify FTS table updated
    const ftsRow = checkDb.prepare('SELECT archived FROM conversations_fts WHERE conversation_id = ? AND chunk_index = -1').get('conv-archived-1') as { archived: number };
    expect(ftsRow.archived).toBe(1);

    checkDb.close();

    // 7. Verify app_storage.json scrubbed
    const scrubbedStorage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    expect(JSON.parse(scrubbedStorage.pinned_conversations_order)).toEqual(['conv-active']);
    expect(scrubbedStorage['antigravity-multi-conversation-layout-v3-conv-archived-1']).toBeUndefined();
    expect(scrubbedStorage['antigravity-multi-conversation-layout-v3-conv-active']).toBeDefined();
    expect(scrubbedStorage['sidebarCollapsed-conv-archived-1']).toBeUndefined();
    const scrubbedDrafts = JSON.parse(scrubbedStorage['conversation-input-drafts']);
    expect(scrubbedDrafts['conv-archived-1']).toBeUndefined();
    expect(scrubbedDrafts['conv-active']).toBe('active draft');

    // 8. Verify Idempotence (running second time performs 0 mutations)
    const result2 = reconcileSummariesOnBoot({
      dataDir,
      appDataDir: tempAppData,
      dryRun: false,
    });
    expect(result2.reconciledArchivedRawCount).toBe(0);
    expect(result2.reconciledFtsCount).toBe(0);
    expect(result2.scrubbedStorageKeysCount).toBe(0);
  });
});
