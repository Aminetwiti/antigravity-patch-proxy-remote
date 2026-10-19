const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/amine/.gemini/antigravity/conversations/276e9311-4a99-452b-b11b-7e7609fc5499.db');

const steps = db.prepare("SELECT idx, step_type, status, metadata, error_details, step_payload FROM steps").all();
console.log('Total steps:', steps.length);
for (const s of steps) {
  console.log(`Step ${s.idx}: type=${s.step_type}, status=${s.status}`);
  if (s.metadata) console.log('  metadata:', s.metadata.toString('utf-8').slice(0, 300));
  if (s.error_details) console.log('  error_details:', s.error_details.toString('utf-8').slice(0, 300));
  if (s.step_payload) console.log('  step_payload:', s.step_payload.toString('utf-8').slice(0, 300));
}
