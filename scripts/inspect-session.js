const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');

const convId = '190dab18-65ff-4cb1-94d4-1651a5f55775';
const dataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const dbPath = path.join(dataDir, 'conversations', `${convId}.db`);

console.log('Inspecting conversation db:', dbPath);
if (!fs.existsSync(dbPath)) {
  console.log('File does not exist!');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name));

for (const t of tables) {
  const count = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get();
  console.log(`Table ${t.name}: ${count.c} rows`);
}

// Let's inspect the steps or messages table
if (tables.some(t => t.name === 'steps')) {
  const lastSteps = db.prepare("SELECT idx, step_type, status, error_details, length(step_payload) as payload_len FROM steps ORDER BY idx DESC LIMIT 10").all();
  console.log('\nLast 10 steps:');
  for (const s of lastSteps) {
    console.log(`idx: ${s.idx} | step_type: ${s.step_type} | status: ${s.status} | payload_len: ${s.payload_len} | error: ${s.error_details}`);
  }

  // Get the very last step payload to see what it contains
  const lastStep = db.prepare("SELECT * FROM steps ORDER BY idx DESC LIMIT 1").get();
  console.log('\nLast step full details:', {
    idx: lastStep.idx,
    step_type: lastStep.step_type,
    status: lastStep.status,
    has_subtrajectory: lastStep.has_subtrajectory,
    error_details: lastStep.error_details ? String(lastStep.error_details) : null,
    step_format: lastStep.step_format
  });
  if (lastStep.step_payload) {
    const str = Buffer.from(lastStep.step_payload).toString('utf8');
    console.log('Payload text (first 300 chars):', str.slice(0, 300));
  }
}

// Check conversation_summaries row for this session
const summariesDb = new DatabaseSync(path.join(dataDir, 'conversation_summaries.db'), { readOnly: true });
const summaryRow = summariesDb.prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?").get(convId);
console.log('\nSummary record:', {
  conversation_id: summaryRow.conversation_id,
  title: summaryRow.title,
  status: summaryRow.status,
  not_fully_idle: summaryRow.not_fully_idle,
  killed: summaryRow.killed,
  workspace_uris: summaryRow.workspace_uris
});
