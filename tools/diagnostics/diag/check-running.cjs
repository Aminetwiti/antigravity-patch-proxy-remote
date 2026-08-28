#!/usr/bin/env node
// scripts/diag/check-running.cjs
const { execSync } = require('child_process');
console.log('=== Processes ===');
try {
  const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
  const procs = out.split('\n').filter(l => /antigravity|language_server/i.test(l));
  procs.forEach(p => console.log('  ' + p));
} catch (e) { console.log('tasklist failed:', e.message); }

console.log('\n=== Port 50999 ===');
try {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const lines = out.split('\n').filter(l => l.includes(':50999'));
  if (lines.length === 0) console.log('  No listener on port 50999');
  lines.forEach(l => console.log('  ' + l.trim()));
} catch (e) { console.log('netstat failed:', e.message); }

console.log('\n=== Try to launch Antigravity ===');
try {
  execSync('start "" "C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe"', { stdio: 'inherit' });
  console.log('  Launched. Waiting 10s...');
  // Wait and re-check
  setTimeout(() => {
    console.log('\n=== After 10s ===');
    try {
      const out2 = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      const procs2 = out2.split('\n').filter(l => /antigravity|language_server/i.test(l));
      if (procs2.length === 0) console.log('  Still no Antigravity process');
      procs2.forEach(p => console.log('  ' + p));
    } catch (e) {}
    try {
      const out3 = execSync('netstat -ano', { encoding: 'utf8' });
      const lines3 = out3.split('\n').filter(l => l.includes(':50999') || l.includes(':50998') || l.includes(':50997'));
      if (lines3.length === 0) console.log('  No listener on 50997-50999');
      lines3.forEach(l => console.log('  ' + l.trim()));
    } catch (e) {}
    process.exit(0);
  }, 10000);
} catch (e) { console.log('  launch failed:', e.message); }