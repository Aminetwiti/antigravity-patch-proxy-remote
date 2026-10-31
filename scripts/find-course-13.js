const path = require('path');
const os = require('os');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(os.homedir(), '.gemini', 'antigravity');
const convDir = path.join(dataDir, 'conversations');

console.log('Scanning conversations in:', convDir);
if (!fs.existsSync(convDir)) {
  console.log('Directory does not exist!');
  process.exit(1);
}

const files = fs.readdirSync(convDir).filter(f => f.endsWith('.db') && !f.includes('-wal') && !f.includes('-shm'));
console.log('Total .db files:', files.length);

const targets = ['course 13', 'course13', 'course-13'];
for (const file of files) {
  const filePath = path.join(convDir, file);
  try {
    const buf = fs.readFileSync(filePath);
    for (const t of targets) {
      if (buf.includes(Buffer.from(t, 'utf8'))) {
        console.log(`FOUND "${t}" in: ${file}`);
      }
    }
  } catch (err) {
    //
  }
}

// Also check brain directories
const brainDir = path.join(dataDir, 'brain');
if (fs.existsSync(brainDir)) {
  console.log('Scanning brain directory...');
  const brains = fs.readdirSync(brainDir);
  for (const b of brains) {
    const tPath = path.join(brainDir, b, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(tPath)) {
      try {
        const content = fs.readFileSync(tPath, 'utf8');
        if (content.includes('course 13') || content.includes('course13')) {
          console.log(`FOUND in brain transcript: ${b}`);
        }
      } catch (e) {}
    }
  }
}
