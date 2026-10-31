#!/usr/bin/env node
/**
 * test-patch-dedupe.js — Unit test for the v2.3.x dedupe logic in patch_2_3.js.
 *
 * We extract the dedupe logic into a helper and run it against synthetic
 * fixtures that mimic the tsc-compiled dist/ipcHandlers.js bundle format.
 *
 * The test fixtures include:
 *   - Single quotes around the channel name (the format the OLD regex handled)
 *   - Double quotes around the channel name (the format the OLD regex MISSED)
 *   - Mixed: one `'channel'` + one `"channel"` (heterogeneous duplicates)
 *   - 3× duplicates (to verify the loop strips ALL but the last)
 *   - Single registration (no dedupe needed → no-op)
 *   - No duplicates of OTHER channels (must not be touched)
 *
 * Exit 0 = all pass; 1 = any fail.
 */
'use strict';

const assert = require('assert');

// ─── Copy of the dedupe helper from patch_2_3.js (kept in sync) ────────────
function dedupeDuplicateIpcHandlers(content, DUPLICATE_IPC_HANDLERS) {
  let totalStripped = 0;
  const log = [];
  for (const channel of DUPLICATE_IPC_HANDLERS) {
    const esc = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quote = `["']`;
    const handleStart = new RegExp(
      `ipcMain\\.handle\\(${quote}${esc}${quote}\\s*,`,
      'g',
    );
    const blocks = [];
    let m;
    while ((m = handleStart.exec(content)) !== null) {
      const startIdx = m.index;
      let depth = 0;
      let i = startIdx;
      let opened = false;
      for (; i < content.length; i++) {
        const c = content[i];
        if (c === '{') { depth++; opened = true; }
        else if (c === '}') { depth--; }
        if (opened && depth === 0) {
          let j = i + 1;
          while (j < content.length && /\s/.test(content[j])) j++;
          if (content[j] === ')' && content[j + 1] === ';') {
            blocks.push({ start: startIdx, end: j + 2 });
            break;
          }
        }
      }
      if (i >= content.length) break;
    }
    if (blocks.length > 1) {
      const kept = blocks[blocks.length - 1];
      let out = '';
      let cursor = 0;
      for (let k = 0; k < blocks.length - 1; k++) {
        const b = blocks[k];
        out += content.slice(cursor, b.start);
        out += `/* v2.3.x patch: duplicate '${channel}' registration stripped */\n`;
        cursor = b.end;
        totalStripped++;
      }
      out += content.slice(cursor);
      content = out;
      log.push(`stripped ${blocks.length - 1} duplicate '${channel}' (kept last of ${blocks.length})`);
    } else {
      log.push(`'${channel}' registered ${blocks.length}× (no dedupe needed)`);
    }
  }
  return { content, totalStripped, log };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────
const SINGLE_QUOTE_DUP = `\
const { ipcMain } = require('electron');
ipcMain.handle('storage:fetch-models', async () => {
    const models = ['old-registry'];
    return models;
});
ipcMain.handle('storage:save-model', async () => {});
ipcMain.handle('storage:fetch-models', async () => {
    const models = await db.query('SELECT * FROM models');
    return models;
});
app.whenReady().then(() => {});
`;

const DOUBLE_QUOTE_DUP = `\
const { ipcMain } = require('electron');
ipcMain.handle("storage:fetch-models", async () => {
    return ['old'];
});
ipcMain.handle("storage:save-model", () => {});
ipcMain.handle("storage:fetch-models", async () => {
    return await db.query();
});
`;

const MIXED_QUOTES = `\
ipcMain.handle('storage:fetch-models', async () => { return 1; });
ipcMain.handle("storage:fetch-models", async () => { return 2; });
`;

const TRIPLE_DUP = `\
ipcMain.handle('storage:fetch-models', () => { return 'a'; });
ipcMain.handle('storage:fetch-models', () => { return 'b'; });
ipcMain.handle('storage:fetch-models', () => { return 'c'; });
`;

const NO_DUP = `\
ipcMain.handle('storage:fetch-models', () => { return 1; });
ipcMain.handle('storage:save-model', () => {});
`;

const NESTED_BRACES = `\
ipcMain.handle('storage:fetch-models', () => {
    const obj = { nested: { deep: 1 } };
    if (obj.nested.deep === 1) { return 'first'; }
    return 'never';
});
ipcMain.handle('storage:fetch-models', () => {
    return 'second';
});
`;

const OTHER_CHANNELS_INTACT = `\
ipcMain.handle('storage:fetch-models', () => { return 'dup-1'; });
ipcMain.handle('storage:save-model', () => { return 'save'; });
ipcMain.handle('window:minimize', () => { return 'min'; });
ipcMain.handle('storage:fetch-models', () => { return 'dup-2'; });
`;

// ─── Tests ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log('dedupeDuplicateIpcHandlers() — unit tests\n');

test('SINGLE_QUOTE_DUP: strips first, keeps second', () => {
  const r = dedupeDuplicateIpcHandlers(SINGLE_QUOTE_DUP, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 1, 'should strip exactly 1');
  // The first handler should be replaced by the stripped comment
  assert.ok(r.content.includes(`duplicate 'storage:fetch-models' registration stripped`),
    'should contain stripped comment');
  // The second (kept) handler should reference db.query (last one)
  assert.ok(r.content.includes('db.query'), 'should keep last handler with db.query');
  assert.ok(!r.content.includes(`['old-registry']`), 'should have removed first handler body');
  // save-model must be intact
  assert.ok(r.content.includes("'storage:save-model'"), 'save-model must remain');
});

test('DOUBLE_QUOTE_DUP: strips even when tsc emits double quotes', () => {
  const r = dedupeDuplicateIpcHandlers(DOUBLE_QUOTE_DUP, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 1, 'should strip exactly 1 (regression: old regex failed here)');
  assert.ok(r.content.includes('db.query'), 'should keep last handler');
  assert.ok(!r.content.includes(`['old']`), 'should have removed first handler body');
});

test('MIXED_QUOTES: strips regardless of quote style', () => {
  const r = dedupeDuplicateIpcHandlers(MIXED_QUOTES, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 1, 'should strip exactly 1');
  assert.ok(r.content.includes('return 2'), 'should keep the second one (return 2)');
  assert.ok(!r.content.includes('return 1'), 'should have removed the first (return 1)');
});

test('TRIPLE_DUP: strips 2, keeps last (regression: old loop only stripped 1)', () => {
  const r = dedupeDuplicateIpcHandlers(TRIPLE_DUP, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 2, 'should strip exactly 2 (old loop stopped at 1)');
  assert.ok(r.content.includes(`return 'c'`), 'should keep the last (return c)');
  // Count occurrences of "return '" in the result — should be exactly 1
  const matches = r.content.match(/return '[abc]'/g) || [];
  assert.strictEqual(matches.length, 1, `should have exactly 1 remaining handler, got ${matches.length}`);
});

test('NO_DUP: no-op, no stripping', () => {
  const r = dedupeDuplicateIpcHandlers(NO_DUP, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 0, 'should strip 0');
  assert.strictEqual(r.content, NO_DUP, 'content should be unchanged');
});

test('NESTED_BRACES: brace-tracking handles nested objects', () => {
  const r = dedupeDuplicateIpcHandlers(NESTED_BRACES, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 1, 'should strip exactly 1');
  assert.ok(r.content.includes(`return 'second'`), 'should keep second handler');
  assert.ok(!r.content.includes(`return 'first'`), 'should have removed first handler');
});

test('OTHER_CHANNELS_INTACT: does not touch unrelated handlers', () => {
  const r = dedupeDuplicateIpcHandlers(OTHER_CHANNELS_INTACT, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 1, 'should strip 1 duplicate');
  assert.ok(r.content.includes(`'storage:save-model'`), 'save-model must remain');
  assert.ok(r.content.includes(`'window:minimize'`), 'window:minimize must remain');
  // Last fetch-models (dup-2) is kept, first (dup-1) is stripped
  assert.ok(r.content.includes(`return 'dup-2'`), 'last fetch-models kept');
  assert.ok(!r.content.includes(`return 'dup-1'`), 'first fetch-models stripped');
});

test('EMPTY_INPUT: handles empty content gracefully', () => {
  const r = dedupeDuplicateIpcHandlers('', ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 0);
  assert.strictEqual(r.content, '');
});

test('NO_MATCHING_CHANNEL: leaves content untouched when channel absent', () => {
  const input = `ipcMain.handle('something:else', () => {});`;
  const r = dedupeDuplicateIpcHandlers(input, ['storage:fetch-models']);
  assert.strictEqual(r.totalStripped, 0);
  assert.strictEqual(r.content, input);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);