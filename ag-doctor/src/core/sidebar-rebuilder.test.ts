import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  encodeVarint,
  decodeVarint,
  encodeLengthDelimited,
  encodeStringField,
  iterLengthDelimited,
  stripField,
  buildTimestampFields,
  extractTimestampSeconds,
  pathToWorkspaceUri,
  formatPromptTitle,
  normalizePromptText,
  collapsePromptUrls,
  extractExistingMetadata,
  buildTrajectoryEntry,
  extractPromptFromConversationDb,
} from './sidebar-rebuilder';

describe('sidebar-rebuilder: protobuf & varint helpers', () => {
  it('encodes and decodes varints correctly', () => {
    const testCases = [0, 1, 127, 128, 300, 16384, 1000000];
    for (const val of testCases) {
      const buf = encodeVarint(val);
      const { value, newPos } = decodeVarint(buf, 0);
      expect(value).toBe(val);
      expect(newPos).toBe(buf.length);
    }
  });

  it('encodes and iterates length-delimited fields', () => {
    const field1 = encodeStringField(1, 'first message');
    const field2 = encodeStringField(2, 'second message');
    const field1Again = encodeStringField(1, 'third message');
    const combined = Buffer.concat([field1, field2, field1Again]);

    const resultsF1 = iterLengthDelimited(combined, 1);
    expect(resultsF1.length).toBe(2);
    expect(resultsF1[0].toString('utf8')).toBe('first message');
    expect(resultsF1[1].toString('utf8')).toBe('third message');

    const resultsF2 = iterLengthDelimited(combined, 2);
    expect(resultsF2.length).toBe(1);
    expect(resultsF2[0].toString('utf8')).toBe('second message');
  });

  it('strips specified field without corrupting remaining fields', () => {
    const f1 = encodeStringField(1, 'keep 1');
    const f2 = encodeStringField(2, 'delete me');
    const f3 = encodeStringField(3, 'keep 3');
    const combined = Buffer.concat([f1, f2, f3]);

    const stripped = stripField(combined, 2);
    expect(iterLengthDelimited(stripped, 2).length).toBe(0);
    expect(iterLengthDelimited(stripped, 1)[0].toString('utf8')).toBe('keep 1');
    expect(iterLengthDelimited(stripped, 3)[0].toString('utf8')).toBe('keep 3');
  });

  it('builds and extracts timestamps', () => {
    const nowSec = 1710000000;
    const tsBuf = buildTimestampFields(nowSec);
    const sec3 = extractTimestampSeconds(tsBuf, 3);
    const sec7 = extractTimestampSeconds(tsBuf, 7);
    const sec10 = extractTimestampSeconds(tsBuf, 10);
    expect(sec3).toBe(nowSec);
    expect(sec7).toBe(nowSec);
    expect(sec10).toBe(nowSec);
  });
});

describe('sidebar-rebuilder: prompt & title formatting', () => {
  it('normalizes prompt whitespace', () => {
    expect(normalizePromptText('  hello \n\t world  ')).toBe('hello world');
  });

  it('collapses URLs to hostname while keeping sentence structure', () => {
    expect(collapsePromptUrls('check https://github.com/google/antigravity for info')).toBe('check github.com for info');
  });

  it('formats prompt titles concisely', () => {
    expect(formatPromptTitle('is our cli latest? i mean antigravity cli')).toBe('is our cli latest?');
    expect(formatPromptTitle('# Agent Broker Request\nTopic: strict route test')).toBe('Agent Broker Request Topic: strict route test');

    const longPrompt = 'go check the switchboard mcp request codex sent a simple translation request to another agent and report everything';
    const formatted = formatPromptTitle(longPrompt);
    expect(formatted).not.toBeNull();
    expect(formatted!.length).toBeLessThanOrEqual(60);
    expect(formatted!.endsWith('…')).toBe(true);
  });
});

describe('sidebar-rebuilder: workspace URI conversion', () => {
  it('converts Windows paths to file:/// URIs', () => {
    expect(pathToWorkspaceUri('C:\\Users\\test\\Project')).toBe('file:///c:/Users/test/Project');
    expect(pathToWorkspaceUri('d:/Repos/My App')).toBe('file:///d:/Repos/My App');
  });

  it('preserves existing vscode-remote and file URIs', () => {
    expect(pathToWorkspaceUri('vscode-remote://wsl+Ubuntu/home/user')).toBe('vscode-remote://wsl+Ubuntu/home/user');
    expect(pathToWorkspaceUri('file:///c:/Users/test')).toBe('file:///c:/Users/test');
  });
});

describe('sidebar-rebuilder: metadata extraction and entry construction', () => {
  it('builds a trajectory entry and decodes it back', () => {
    const cid = '12345678-abcd-ef01-2345-6789abcdef01';
    const title = 'Test Conversation';
    const entryBuf = buildTrajectoryEntry(cid, title, undefined, 'C:\\MyProject', 1710000000);

    const outerMessage = encodeLengthDelimited(1, entryBuf);
    const b64 = outerMessage.toString('base64');

    const { titles, innerBlobs } = extractExistingMetadata(b64);
    expect(titles.get(cid)).toBe(title);
    expect(innerBlobs.has(cid)).toBe(true);
  });

  it('extracts prompt from SQLite conversation database', () => {
    const sqlite = require('node:sqlite');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-conv-'));
    const dbPath = path.join(tmpDir, 'test_conv.db');

    try {
      const db = new sqlite.DatabaseSync(dbPath);
      db.exec('CREATE TABLE conversation_steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB);');

      // Build step_payload for type 14: field 19 length-delimited containing field 2 "Mon super prompt utilisateur"
      const promptText = 'Mon super prompt utilisateur';
      const promptField = encodeStringField(2, promptText);
      const containerField = encodeLengthDelimited(19, promptField);

      const stmt = db.prepare('INSERT INTO conversation_steps (idx, step_type, step_payload) VALUES (?, ?, ?)');
      stmt.run(1, 14, containerField);
      db.close();

      const extracted = extractPromptFromConversationDb(dbPath);
      expect(extracted).toBe(promptText);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
