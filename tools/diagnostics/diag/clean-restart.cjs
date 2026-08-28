#!/usr/bin/env node
// scripts/diag/clean-restart.cjs — Clean Antigravity restart with fresh log
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Step 1: Kill all Antigravity + LS + proxy-stub ===');
try { execSync('taskkill /F /IM Antigravity.exe /T', { stdio: 'pipe' }); } catch (e) {}
try { execSync('taskkill /F /IM language_server.exe /T', { stdio: 'pipe' }); } catch (e) {}
try {
  const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
  const procs = out.split('\n').filter(l => /antigravity|language_server/i.test(l));
  procs.forEach(p => {
    const name = p.split('","')[0].replace('"', '');
    try { execSync(`taskkill /F /IM ${name} /T`, { stdio: 'pipe' }); } catch (e) {}
  });
} catch (e) {}
console.log('  Killed.');

// Save current logs
const mainLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
const backup = mainLog + '.pre-clean-restart-' + Date.now() + '.bak';
try {
  fs.copyFileSync(mainLog, backup);
  console.log('  Backed up:', backup);
  fs.writeFileSync(mainLog, ''); // Truncate
  console.log('  Truncated main.log');
} catch (e) { console.log('  log backup failed:', e.message); }

// Same for proxy-runner.log
const prLog = path.join(os.tmpdir(), 'ag-proxy-runner.log');
try { fs.writeFileSync(prLog, ''); console.log('  Truncated proxy-runner.log'); } catch (e) {}

console.log('\n=== Step 2: Launch Antigravity (detached) ===');
const ag = spawn('cmd.exe', ['/c', 'start', '', 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe'], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
ag.unref();
console.log('  Launched (PID: ' + ag.pid + ')');

console.log('\n=== Step 3: Wait 20s for startup ===');

setTimeout(() => {
  console.log('\n=== Step 4: Verify state ===');

  // Processes
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
    const procs = out.split('\n').filter(l => /antigravity|language_server/i.test(l));
    console.log('  Antigravity processes: ' + procs.length);
    procs.forEach(p => console.log('    ' + p));
  } catch (e) {}

  // Port 50999
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes(':50999'));
    console.log('  Port 50999: ' + (lines.length ? 'LISTENING' : 'NOT LISTENING'));
    lines.forEach(l => console.log('    ' + l.trim()));
  } catch (e) {}

  // main.log
  console.log('\n=== Step 5: Fresh main.log content ===');
  if (fs.existsSync(mainLog)) {
    const content = fs.readFileSync(mainLog, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    console.log('  total new lines:', lines.length);
    lines.forEach(l => console.log('  ' + l));
  }

  // proxy-runner.log
  console.log('\n=== Step 6: proxy-runner.log content ===');
  if (fs.existsSync(prLog)) {
    const content = fs.readFileSync(prLog, 'utf8');
    console.log(content || '(empty)');
  } else {
    console.log('  no proxy-runner.log');
  }

  process.exit(0);
}, 20000);