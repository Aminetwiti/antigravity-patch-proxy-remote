const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const dbPath = path.join(dataDir, 'conversation_summaries.db');

if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  const check = db.prepare("SELECT count(*) as c FROM conversation_summaries WHERE not_fully_idle = 1 OR status = 'CASCADE_RUN_STATUS_RUNNING'").get();
  console.log(`Found ${check.c} sessions in running/not-idle state.`);

  const res = db.prepare("UPDATE conversation_summaries SET not_fully_idle = 0, status = 'CASCADE_RUN_STATUS_IDLE' WHERE not_fully_idle = 1 OR status = 'CASCADE_RUN_STATUS_RUNNING'").run();
  console.log(`Successfully reset ${res.changes} sessions to IDLE.`);

  // Also remove agyhub_summaries_proto.pb if it exists so LS rebuilds fresh from SQLite
  const protoPath = path.join(dataDir, 'agyhub_summaries_proto.pb');
  if (fs.existsSync(protoPath)) {
    try {
      fs.unlinkSync(protoPath);
      console.log('Removed stale agyhub_summaries_proto.pb cache.');
    } catch (e) {
      console.log('Could not remove proto cache:', e.message);
    }
  }

  db.close();
}
