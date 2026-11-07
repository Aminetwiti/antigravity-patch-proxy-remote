const fs = require('fs');
const path = require('path');

function searchFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const item of fs.readdirSync(dir)) {
    if (item === 'node_modules' || item === 'dist' || item === '.git') continue;
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) res = res.concat(searchFiles(full));
    else if (item.endsWith('.ts') || item.endsWith('.js')) res.push(full);
  }
  return res;
}

const files = searchFiles('src').concat(searchFiles('tests'), searchFiles('ag-doctor'));
const importMap = {};
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const regex = /(?:from\s+['"]|require\(['"])([^'"]*proxy[^'"]*)['"]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const target = m[1];
    if (!importMap[target]) importMap[target] = [];
    importMap[target].push(f);
  }
}
console.log(JSON.stringify(importMap, null, 2));
