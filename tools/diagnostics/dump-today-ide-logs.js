const fs = require('fs');
const path = require('path');
const base = path.join(process.env.APPDATA, 'Antigravity IDE', 'logs', '20260818T112731');
function show(rel) {
  const full = path.join(base, rel);
  console.log('\n========== ' + rel + ' (' + (fs.existsSync(full) ? fs.statSync(full).size + 'B' : 'MISSING') + ') ==========');
  if (fs.existsSync(full)) console.log(fs.readFileSync(full, 'utf8').slice(-3500));
}
show('auth.log');
show('cloudcode.log');
show('main.log');
show(path.join('window1', 'exthost', 'google.antigravity', 'Antigravity IDE.log'));
