import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';
import { pruneConversationSummaries, runPrune } from './prune';
import type { CommandContext } from '../types';

describe('pruneConversationSummaries', () => {
  let tempDir: string;
  let dbPath: string;
  let convDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-prune-'));
    dbPath = path.join(tempDir, 'conversation_summaries.db');
    convDir = path.join(tempDir, 'conversations');
    fs.mkdirSync(convDir, { recursive: true });

    // Create sqlite DB with test data
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text NOT NULL DEFAULT ""
      );
    `);
    const insert = db.prepare('INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?)');
    insert.run('conv-active-1', 'Active Conversation 1');
    insert.run('conv-active-2', 'Active Conversation 2');
    insert.run('conv-orphan-1', 'Ghost Conversation 1');
    insert.run('conv-orphan-2', 'Ghost Conversation 2');
    db.close();

    // Create file on disk only for active conversations
    fs.writeFileSync(path.join(convDir, 'conv-active-1.db'), 'mock-sqlite-file');
    fs.writeFileSync(path.join(convDir, 'conv-active-2.db'), 'mock-sqlite-file');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects orphan summaries without modifying database in dry-run mode', () => {
    const result = pruneConversationSummaries({ dryRun: true, dataDir: tempDir });
    expect(result.dryRun).toBe(true);
    expect(result.totalSummaries).toBe(4);
    expect(result.existingConversations).toBe(2);
    expect(result.orphanCount).toBe(2);
    expect(result.prunedCount).toBe(0);

    // Verify DB still contains 4 rows
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT conversation_id FROM conversation_summaries').all();
    db.close();
    expect(rows.length).toBe(4);
  });

  it('prunes orphan summaries, creates a backup, and preserves active conversations', () => {
    const result = pruneConversationSummaries({ dryRun: false, dataDir: tempDir });
    expect(result.dryRun).toBe(false);
    expect(result.orphanCount).toBe(2);
    expect(result.prunedCount).toBe(2);
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath!)).toBe(true);

    // Verify DB now only contains the 2 active rows
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT conversation_id FROM conversation_summaries').all() as Array<{ conversation_id: string }>;
    db.close();
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.conversation_id);
    expect(ids).toContain('conv-active-1');
    expect(ids).toContain('conv-active-2');
    expect(ids).not.toContain('conv-orphan-1');
    expect(ids).not.toContain('conv-orphan-2');
  });

  it('handles already clean database gracefully', () => {
    // Prune once
    pruneConversationSummaries({ dryRun: false, dataDir: tempDir });

    // Prune second time
    const result2 = pruneConversationSummaries({ dryRun: false, dataDir: tempDir });
    expect(result2.orphanCount).toBe(0);
    expect(result2.prunedCount).toBe(0);
  });

  it('runPrune command returns 0 in JSON mode', async () => {
    const ctx: CommandContext = {
      json: true,
      verbose: false,
      yes: true,
      cwd: tempDir,
      options: {},
    };
    // Mock getAntigravityDataDir via test options or runPrune
    const code = await runPrune(ctx, '--dry-run', []);
    expect(code).toBe(0);
  });
});
