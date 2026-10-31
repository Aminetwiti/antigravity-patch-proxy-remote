const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('Querying not_fully_idle conversations:');
const stuckRows = db.prepare('SELECT conversation_id, title, preview, status, not_fully_idle, killed, last_modified_time FROM conversation_summaries WHERE not_fully_idle = 1 OR status != 0').all();
console.log('Stuck or active rows count:', stuckRows.length);
function formatTime(val) {
  try {
    const num = Number(val);
    if (!num || isNaN(num)) return 'N/A';
    // Could be milliseconds, microseconds, or nanoseconds
    const ms = num > 1e14 ? num / 1e6 : (num > 1e11 ? num : num * 1000);
    return new Date(ms).toISOString();
  } catch (e) {
    return String(val);
  }
}

for (const r of stuckRows.slice(0, 5)) {
  console.log(`[SAMPLE] ID: ${r.conversation_id} | Title: "${r.title}" | Status: ${r.status} | not_fully_idle: ${r.not_fully_idle} | killed: ${r.killed} | LastMod: ${formatTime(r.last_modified_time)}`);
}

console.log('\nSearching for course / driver:');
const matches = db.prepare('SELECT conversation_id, title, preview, status, not_fully_idle, killed, last_modified_time FROM conversation_summaries WHERE title LIKE ? OR preview LIKE ?').all('%course%', '%course%');
for (const r of matches) {
  console.log(`[MATCH] ID: ${r.conversation_id} | Title: "${r.title}" | Status: ${r.status} | not_fully_idle: ${r.not_fully_idle}`);
}

const driverMatches = db.prepare('SELECT conversation_id, title, preview, status, not_fully_idle, killed, last_modified_time FROM conversation_summaries WHERE title LIKE ? OR preview LIKE ?').all('%driver%', '%driver%');
for (const r of driverMatches) {
  console.log(`[MATCH DRIVER] ID: ${r.conversation_id} | Title: "${r.title}" | Status: ${r.status} | not_fully_idle: ${r.not_fully_idle}`);
}

const recent = db.prepare('SELECT conversation_id, title, preview, status, not_fully_idle, killed, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 10').all();
console.log('\nTop 10 Most Recent Conversations:');
for (const r of recent) {
  console.log(`[RECENT] ID: ${r.conversation_id} | Title: "${r.title}" | Status: ${r.status} | not_fully_idle: ${r.not_fully_idle} | LastMod: ${formatTime(r.last_modified_time)}`);
}
