const fs = require('fs');
const path = require('path');

function searchImports(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const norm = full.replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.git' && !norm.startsWith('src/proxy')) {
        searchImports(full);
      }
    } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (/['"][^'"]*proxy[^'"]*['"]/.test(l)) {
          console.log(full + ':' + (idx + 1) + ' -> ' + l.trim());
        }
      });
    }
  }
}

searchImports('src');
