#!/usr/bin/env node
// scripts/diag/check-logs.cjs — Find and tail Antigravity logs
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Looking for Antigravity logs ===');
const candidates = [
  path.join(os.homedir(), '.gemini', 'antigravity', 'logs'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs'),
  path.join(os.homedir(), 'AppData', 'Local', 'Antigravity', 'logs'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'antigravity', 'logs'),
];

for (const dir of candidates) {
  if (fs.existsSync(dir)) {
    console.log('  FOUND:', dir);
    const files = fs.readdirSync(dir);
    files.forEach(f => {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      console.log('    ' + f + ' (' + stat.size + ' B, mtime=' + stat.mtime.toISOString() + ')');
    });
  } else {
    console.log('  not found:', dir);
  }
}

// Try the user data dir more broadly
const widerCandidates = [
  path.join(os.homedir(), '.gemini'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity'),
  path.join(os.homedir(), 'AppData', 'Local', 'Antigravity'),
];
for (const dir of widerCandidates) {
  if (fs.existsSync(dir)) {
    console.log('\n  WIDER DIR:', dir);
    walk(dir, 2);
  }
}

function walk(dir, depth) {
  if (depth <= 0) return;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/log/i.test(e.name)) {
          console.log('    [LOG DIR] ' + p);
          try {
            for (const f of fs.readdirSync(p)) {
              const stat = fs.statSync(path.join(p, f));
              console.log('      ' + f + ' (' + stat.size + ' B)');
            }
          } catch {}
        }
        walk(p, depth - 1);
      } else if (/\.(log|txt|json)$/i.test(e.name)) {
        const stat = fs.statSync(p);
        if (stat.size > 0) console.log('    ' + p + ' (' + stat.size + ' B)');
      }
    }
  } catch {}
}

console.log('\n=== Check most recent main.log / language_server.log ===');
function tailLatest(pattern, label) {
  // ... walk and find latest
  let best = null;
  function f(dir) {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) f(p);
        else if (pattern.test(e.name)) {
          const stat = fs.statSync(p);
          if (!best || stat.mtime > best.mtime) best = { path: p, mtime: stat.mtime, size: stat.size };
        }
      }
    } catch {}
  }
  f(path.join(os.homedir(), '.gemini'));
  f(path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity'));
  if (best) {
    console.log('\n  LATEST ' + label + ':', best.path, '(' + best.size + ' B)');
    const content = fs.readFileSync(best.path, 'utf8');
    const lines = content.split('\n');
    console.log('  === Last 50 lines ===');
    lines.slice(-50).forEach(l => console.log('    ' + l));
    // Find proxy errors
    const proxyErrors = lines.filter(l => /proxy|startProxy|Cannot find module|error|fail/i.test(l));
    if (proxyErrors.length > 0) {
      console.log('\n  === Proxy/error lines (last 20) ===');
      proxyErrors.slice(-20).forEach(l => console.log('    ' + l));
    }
  } else {
    console.log('  no ' + label + ' found');
  }
}

tailLatest(/main\.log/, 'main.log');
tailLatest(/language.*\.log/, 'language_server.log');