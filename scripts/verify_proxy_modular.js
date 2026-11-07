const fs = require('fs');
const path = require('path');

let totalErrors = 0;

function checkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter(e => !e.isDirectory());
  const subdirs = entries.filter(e => e.isDirectory());
  const totalChildren = entries.length;

  if (totalChildren > 4) {
    console.error(`[VIOLATION: >4 items in folder] ${dir} has ${totalChildren} items (${files.length} files, ${subdirs.length} subdirs)`);
    totalErrors++;
  }

  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').length;
    if (lines > 300) {
      console.error(`[VIOLATION: >300 lines] ${fullPath} has ${lines} lines`);
      totalErrors++;
    }
  }

  for (const d of subdirs) {
    checkDir(path.join(dir, d.name));
  }
}

const targetDir = path.resolve('src/proxy');
console.log(`Checking modular rules on: ${targetDir}`);
checkDir(targetDir);

if (totalErrors === 0) {
  console.log('SUCCESS: All files <= 300 lines and all folders <= 4 children!');
  process.exit(0);
} else {
  console.error(`FAILED with ${totalErrors} violations.`);
  process.exit(1);
}
