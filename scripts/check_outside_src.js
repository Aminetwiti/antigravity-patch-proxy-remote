const fs = require('fs');
const path = require('path');

function searchAll(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'src'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) searchAll(p, list);
    else if (/\.(ts|js|mjs)$/.test(entry.name)) list.push(p);
  }
  return list;
}

const files = searchAll('.');
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('src/proxy') || content.includes('/proxy/')) {
    console.log(`Potential match in non-src file: ${file}`);
  }
}
console.log('Done scanning non-src files.');
