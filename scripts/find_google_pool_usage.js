const fs = require('fs');

const content = fs.readFileSync('src/proxy/googlePool.ts', 'utf8');
const lines = content.split('\n');

const exportsList = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^export (const|function|class|interface|type|enum|let|var)\s+([A-Za-z0-9_]+)/.test(line)) {
    const match = line.match(/^export (const|function|class|interface|type|enum|let|var)\s+([A-Za-z0-9_]+)/);
    exportsList.push({ kind: match[1], name: match[2], line: i + 1 });
  }
}

console.log('Total exports in googlePool.ts:', exportsList.length);
console.log(JSON.stringify(exportsList, null, 2));
