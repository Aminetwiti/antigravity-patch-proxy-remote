const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/amine/.gemini/antigravity/conversations/276e9311-4a99-452b-b11b-7e7609fc5499.db');

const steps = db.prepare("SELECT * FROM steps").all();
console.log('Steps count:', steps.length);

for (const s of steps) {
  console.log(`\n=== STEP ${s.idx} (type=${s.step_type}, status=${s.status}) ===`);
  for (const col of ['metadata', 'error_details', 'task_details', 'render_info', 'step_payload']) {
    if (s[col]) {
      const buf = Buffer.from(s[col]);
      console.log(`[${col}] (${buf.length} bytes):`);
      // print clean strings
      const str = buf.toString('utf-8').replace(/[^\x20-\x7E\r\n\t]/g, '.');
      console.log(str.slice(0, 500));
    }
  }
}

