const fs = require('fs');
const path = require('path');

const testDir = 'src/__tests__';
const files = fs.readdirSync(testDir);
const imports = new Map();

for (const file of files) {
  if (!file.endsWith('.ts')) continue;
  const content = fs.readFileSync(path.join(testDir, file), 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/from ['"]\.\.\/proxy\/([^'"]+)['"]/);
    if (match) {
      const mod = match[1];
      if (!imports.has(mod)) imports.set(mod, []);
      imports.get(mod).push(file);
    }
  }
}

for (const [mod, testFiles] of imports.entries()) {
  console.log(`${mod}: used in ${testFiles.length} tests`);
}
