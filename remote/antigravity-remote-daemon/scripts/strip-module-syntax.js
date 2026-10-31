const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist', 'renderer');
let patched = 0;

if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const fp = path.join(dir, f);
    const src = fs.readFileSync(fp, 'utf8');
    const out = src
      .replace(/^export /gm, '')
      .replace(/^import .+;\s*$/gm, '');

    if (out !== src) {
      fs.writeFileSync(fp, out);
      patched++;
    }
  }
}

console.log(`✓ stripped module syntax from ${patched} renderer file(s)`);
