const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');

const dataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const dbPath = path.join(dataDir, 'conversation_summaries.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const stuck = db.prepare("SELECT conversation_id, title, status, not_fully_idle, killed FROM conversation_summaries WHERE not_fully_idle != 0 OR status != 'CASCADE_RUN_STATUS_IDLE'").all();
console.log('Stuck or non-idle sessions count:', stuck.length);
for (const s of stuck) {
  console.log(s);
}
