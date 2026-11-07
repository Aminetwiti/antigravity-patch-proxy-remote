const fs = require('fs');
const path = require('path');

function searchImports(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'out'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      searchImports(full, fileList);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      fileList.push(full);
    }
  }
  return fileList;
}

const allFiles = searchImports(path.resolve('.'));
const proxyImporters = [];

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Check for imports from proxy
    if (/(from\s+['"][^'"]*proxy|require\(['"][^'"]*proxy)/.test(line)) {
      proxyImporters.push({ file: path.relative(process.cwd(), file), line: idx + 1, text: line.trim() });
    }
  });
}

console.log(`Found ${proxyImporters.length} imports referencing proxy:`);
const byFile = {};
for (const imp of proxyImporters) {
  if (!byFile[imp.file]) byFile[imp.file] = [];
  byFile[imp.file].push(imp);
}

for (const [file, imps] of Object.entries(byFile)) {
  console.log(`\n${file}:`);
  imps.forEach(i => console.log(`  Line ${i.line}: ${i.text}`));
}
