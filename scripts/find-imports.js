const fs = require('fs');
const path = require('path');

function getTsFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'node_modules' && item.name !== '.git' && item.name !== 'dist' && item.name !== 'build') {
        res = res.concat(getTsFiles(full));
      }
    } else if (item.name.endsWith('.ts') || item.name.endsWith('.js')) {
      res.push(full);
    }
  }
  return res;
}

const dirs = ['src', 'ag-doctor', 'tests'];
let files = [];
for (const d of dirs) files = files.concat(getTsFiles(d));

const importMap = new Map();

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /from\s+['"]([^'"]*proxy[^'"]*)['"]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const imp = m[1];
    if (!importMap.has(imp)) importMap.set(imp, []);
    importMap.get(imp).push(file.replace(/\\/g, '/'));
  }
  const reqRegex = /require\(['"]([^'"]*proxy[^'"]*)['"]\)/g;
  while ((m = reqRegex.exec(content)) !== null) {
    const imp = m[1];
    if (!importMap.has(imp)) importMap.set(imp, []);
    importMap.get(imp).push(file.replace(/\\/g, '/'));
  }
}

for (const [imp, importers] of importMap.entries()) {
  console.log(imp + ' (' + importers.length + ' files)');
}
