const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/amine/.gemini/antigravity/conversations/276e9311-4a99-452b-b11b-7e7609fc5499.db');

const steps = db.prepare("SELECT * FROM steps").all();
for (const s of steps) {
  const buf = Buffer.from(s.step_payload);
  console.log(`Step ${s.idx} size ${buf.length}:`);
  const text = buf.toString('utf-8');
  const matches = text.match(/[^\x00-\x1F\x7F-\x9F]{4,}/g) || [];
  console.log('Matches:', matches.slice(0, 10).join(' \n '));
}

