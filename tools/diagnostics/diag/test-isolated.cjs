#!/usr/bin/env node
// scripts/diag/test-isolated.cjs — Isolated clean test
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const mainLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
const prLog = path.join(os.tmpdir(), 'ag-proxy-runner.log');
const lsLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'language_server.log');

console.log('=== Step 1: Kill EVERYTHING ===');
const names = ['Antigravity.exe', 'language_server.exe', 'electron.exe', 'proxy-runner.exe'];
for (const n of names) {
  try {
    execSync(`taskkill /F /IM ${n} /T`, { stdio: 'pipe' });
    console.log(`  killed ${n}`);
  } catch (e) { /* ignore */ }
}

console.log('\n=== Step 2: Truncate logs ===');
try {
  const backup = mainLog + '.iso-test-' + Date.now() + '.bak';
  if (fs.existsSync(mainLog)) {
    fs.copyFileSync(mainLog, backup);
    fs.writeFileSync(mainLog, '');
    console.log('  main.log truncated (backup: ' + path.basename(backup) + ')');
  }
  if (fs.existsSync(prLog)) {
    fs.writeFileSync(prLog, '');
    console.log('  proxy-runner.log truncated');
  }
} catch (e) { console.log('  log truncate failed:', e.message); }

console.log('\n=== Step 3: Wait 3s then launch ONLY Antigravity ===');
setTimeout(() => {
  try {
    execSync('cmd /c start "" "C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe"', { stdio: 'pipe' });
    console.log('  Antigravity launched');
  } catch (e) { console.log('  launch failed:', e.message); }

  console.log('\n=== Step 4: Wait 20s ===');
  setTimeout(() => {
    console.log('\n=== Step 5: Check state ===');
    try {
      const procs = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      const agProcs = procs.split('\n').filter(l => /antigravity|language_server/i.test(l));
      console.log('  Antigravity processes: ' + agProcs.length);
      agProcs.forEach(p => console.log('    ' + p));
    } catch (e) {}

    try {
      const ns = execSync('netstat -ano', { encoding: 'utf8' });
      const ports = ns.split('\n').filter(l => l.includes(':50999'));
      console.log('  Port 50999: ' + (ports.length ? 'LISTENING' : 'NOT LISTENING'));
      ports.forEach(l => console.log('    ' + l.trim()));
    } catch (e) {}

    console.log('\n=== Step 6: Fresh main.log ===');
    if (fs.existsSync(mainLog)) {
      const content = fs.readFileSync(mainLog, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      console.log('  total lines:', lines.length);
      lines.forEach(l => console.log('  ' + l));
    } else {
      console.log('  main.log missing');
    }

    console.log('\n=== Step 7: Fresh proxy-runner.log ===');
    if (fs.existsSync(prLog)) {
      const content = fs.readFileSync(prLog, 'utf8');
      console.log(content || '(empty)');
    } else {
      console.log('  proxy-runner.log missing');
    }

    console.log('\n=== Step 8: Fresh language_server.log ===');
    if (fs.existsSync(lsLog)) {
      const content = fs.readFileSync(lsLog, 'utf8');
      console.log(content || '(empty)');
    } else {
      console.log('  ls log missing');
    }

    process.exit(0);
  }, 20000);
}, 3000);