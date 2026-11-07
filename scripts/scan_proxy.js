const fs = require('fs');
const path = require('path');

function getProxyImports() {
  const tests = fs.readdirSync('src/__tests__');
  const proxyImports = new Set();
  const fileToImports = {};
  for (const t of tests) {
    if (!t.endsWith('.ts')) continue;
    const filePath = 'src/__tests__/' + t;
    const c = fs.readFileSync(filePath, 'utf8');
    const regex = /(?:from\s+['"]|require\(['"])(\.\.\/proxy\/[^'"]+)['"]/g;
    let m;
    while ((m = regex.exec(c)) !== null) {
      const p = m[1].replace('../proxy/', '');
      proxyImports.add(p);
      if (!fileToImports[filePath]) fileToImports[filePath] = [];
      fileToImports[filePath].push(p);
    }
  }
  console.log('Imported proxy modules in src/__tests__:', Array.from(proxyImports).sort());
  return { proxyImports, fileToImports };
}

getProxyImports();
