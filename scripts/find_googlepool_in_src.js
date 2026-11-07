const fs = require('fs');
const path = require('path');

function searchSrc(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      searchSrc(full);
    } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('googlePool')) {
        console.log(full);
      }
    }
  }
}

searchSrc('src');
