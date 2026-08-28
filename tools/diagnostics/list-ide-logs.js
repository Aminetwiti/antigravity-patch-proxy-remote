const fs = require('fs');
const path = require('path');

const base = path.join(process.env.APPDATA, 'Antigravity IDE', 'logs');
const out = [];
function walk(dir, depth) {
  if (depth > 6) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, depth + 1);
    else if (/\.log$/.test(ent.name)) {
      try {
        const st = fs.statSync(full);
        if (st.size > 0) out.push({ full, size: st.size, mtime: st.mtimeMs });
      } catch (e) {}
    }
  }
}
walk(base, 0);
out.sort((a, b) => b.mtime - a.mtime);
for (const f of out.slice(0, 15)) {
  console.log(new Date(f.mtime).toISOString(), f.size, f.full);
}
