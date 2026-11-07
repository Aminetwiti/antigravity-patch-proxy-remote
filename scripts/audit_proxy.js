const fs = require('fs');
const path = require('path');

function getStats(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile());
  const subdirs = entries.filter(e => e.isDirectory());
  
  console.log('=== Directory:', dir, '->', files.length, 'files,', subdirs.length, 'subdirs ===');
  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n').length;
    if (lines > 300) {
      console.log('  [OVER 300]', f.name + ':', lines, 'lines');
    } else {
      console.log('  [OK]', f.name + ':', lines, 'lines');
    }
  }
  for (const d of subdirs) {
    getStats(path.join(dir, d.name));
  }
}

getStats('src/proxy');
