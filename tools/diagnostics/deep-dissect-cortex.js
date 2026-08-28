/**
 * Deep Dissection of language_server.exe
 * Extracts internal System Prompts, SQLite/OpenSearch Index Schemas,
 * Cortex Planner State Machine, and WebM Encoder integrations.
 */
const fs = require('fs');
const path = require('path');

const BIN_PATH = path.resolve(__dirname, '../remote/tools/antigravity/Antigravity/resources/bin/language_server.exe');

console.log(`[+] Reading language_server.exe (${(fs.statSync(BIN_PATH).size / (1024 * 1024)).toFixed(2)} MB)...`);
const buf = fs.readFileSync(BIN_PATH);

// 1. Extract System Prompts & Instruction Templates
console.log(`[+] Scanning for Cortex System Prompt templates & tags...`);
const promptTags = [
  '<system_instructions>',
  '<identity>',
  '<user_rules>',
  '<planning_mode>',
  '<artifacts>',
  '<skills>',
  '<knowledge_items>',
  '<messaging>',
  '<slash_commands>',
  '<communication_style>',
  '<tool_guidance>',
  'You are Antigravity',
  'You are a senior',
  'google3/third_party/jetski/cortex',
  'google3/third_party/jetski/prompt',
  'google3/third_party/jetski/indexing'
];

const foundPrompts = [];
const strBuf = buf.toString('latin1');

promptTags.forEach(tag => {
  let pos = 0;
  let matches = 0;
  while ((pos = strBuf.indexOf(tag, pos)) !== -1 && matches < 10) {
    const start = Math.max(0, pos - 100);
    const end = Math.min(strBuf.length, pos + 400);
    const snippet = strBuf.substring(start, end).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ');
    foundPrompts.push({ tag, offset: pos, snippet });
    pos += tag.length;
    matches++;
  }
});

// 2. Extract SQLite & Storage Table Schemas
console.log(`[+] Scanning for SQL schemas and table definitions...`);
const sqlKeywords = ['CREATE TABLE', 'CREATE INDEX', 'CREATE VIRTUAL TABLE', 'SELECT ', 'INSERT INTO '];
const foundSQL = [];

sqlKeywords.forEach(kw => {
  let pos = 0;
  let matches = 0;
  while ((pos = strBuf.indexOf(kw, pos)) !== -1 && matches < 15) {
    const start = pos;
    const end = Math.min(strBuf.length, pos + 250);
    const snippet = strBuf.substring(start, end).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ');
    if (snippet.length > kw.length + 10) {
      foundSQL.push({ keyword: kw, offset: pos, snippet });
    }
    pos += kw.length;
    matches++;
  }
});

// 3. Extract Cortex State Machine Transitions & Enums
console.log(`[+] Scanning for Cortex Planner States...`);
const stateKeywords = [
  'PLANNER_STAGE_',
  'PLANNER_MODE_',
  'STEP_TYPE_',
  'CASCADE_STAGE_',
  'TRAJECTORY_STATE_',
  'TOOL_CALL_',
  'INTERACTION_'
];

const foundStates = {};
stateKeywords.forEach(sk => {
  foundStates[sk] = new Set();
  let pos = 0;
  while ((pos = strBuf.indexOf(sk, pos)) !== -1) {
    let end = pos + sk.length;
    while (end < strBuf.length && /[A-Z0-9_]/.test(strBuf[end])) {
      end++;
    }
    const token = strBuf.substring(pos, end);
    foundStates[sk].add(token);
    pos = end;
  }
  foundStates[sk] = Array.from(foundStates[sk]);
});

// 4. Output Findings Summary
const report = {
  extractedAt: new Date().toISOString(),
  binarySize: buf.length,
  promptsFound: foundPrompts.length,
  prompts: foundPrompts,
  sqlStatementsFound: foundSQL.length,
  sqlStatements: foundSQL,
  cortexStates: foundStates
};

const OUT_PATH = path.resolve(__dirname, '../scratch/cortex_deep_dissection.json');
fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`[+] Dissection completed! Report saved to ${OUT_PATH}`);
