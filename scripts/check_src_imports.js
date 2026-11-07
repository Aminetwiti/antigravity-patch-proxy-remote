const fs = require('fs');
const path = require('path');

function checkSrc(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== 'proxy') checkSrc(full);
    } else if (f.name.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (/['"].*proxy.*['"]/.test(l)) {
          console.log(`${path.relative('src', full)}:${idx+1} -> ${l.trim()}`);
        }
      });
    }
  }
}

checkSrc(path.resolve('src'));
