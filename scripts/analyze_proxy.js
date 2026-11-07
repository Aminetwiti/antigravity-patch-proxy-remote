const fs = require('fs');
const path = require('path');

function analyzeDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = { dir, files: [], subdirs: [] };
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      result.subdirs.push(e.name);
    } else {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n').length;
      result.files.push({ name: e.name, lines });
    }
  }
  return result;
}

function walk(dir) {
  const current = analyzeDir(dir);
  console.log(`Directory: ${path.relative('.', current.dir)} | Files: ${current.files.length} | Subdirs: ${current.subdirs.length} | Total children: ${current.files.length + current.subdirs.length}`);
  for (const f of current.files) {
    if (f.lines > 300) {
      console.log(`  [OVER 300 LINES] ${f.name} (${f.lines} lines)`);
    } else {
      console.log(`  [OK] ${f.name} (${f.lines} lines)`);
    }
  }
  for (const sub of current.subdirs) {
    walk(path.join(dir, sub));
  }
}

walk(path.resolve('src/proxy'));
