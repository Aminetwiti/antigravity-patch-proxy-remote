const fs = require('fs');
const path = require('path');
const base = path.join(process.env.APPDATA, 'Antigravity IDE', 'logs', '20260817T185700');
const files = [
  'cloudcode.log',
  'auth.log',
  'ls-main.log',
  path.join('window1', 'exthost', 'google.antigravity', 'Antigravity IDE.log'),
  'main.log',
];
for (const rel of files) {
  const full = path.join(base, rel);
  console.log('\n\n========== ' + rel + ' (' + (fs.existsSync(full) ? fs.statSync(full).size + 'B' : 'MISSING') + ') ==========');
  if (fs.existsSync(full)) {
    console.log(fs.readFileSync(full, 'utf8').slice(-4000));
  }
}
