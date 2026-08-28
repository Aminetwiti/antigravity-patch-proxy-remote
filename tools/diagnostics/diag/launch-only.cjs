#!/usr/bin/env node
// scripts/diag/launch-only.cjs — Just launch Antigravity and exit
const { spawn, execSync } = require('child_process');

console.log('=== Pre-launch: kill any Antigravity ===');
try { execSync('taskkill /F /IM Antigravity.exe /T', { stdio: 'pipe' }); } catch (e) {}
console.log('  done');

console.log('\n=== Launching Antigravity.exe ===');
const ag = spawn('C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe', [], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
ag.unref();
console.log('  spawn PID:', ag.pid);
console.log('  done. Watch logs for proxy startup.');
process.exit(0);