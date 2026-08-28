#!/usr/bin/env node
// scripts/diag/test-start.cjs — Fresh start of Antigravity + monitor logs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const mainLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
const prLog = path.join(os.tmpdir(), 'ag-proxy-runner.log');
const lsLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'language_server.log');

console.log('=== Step 1: Kill all Antigravity ===');
try {
  execSync('taskkill /F /IM Antigravity.exe /T', { stdio: 'inherit' });
} catch (e) { console.log('  (none or already killed)'); }
try {
  execSync('taskkill /F /IM language_server.exe /T', { stdio: 'inherit' });
} catch (e) { console.log('  (none)'); }
try {
  execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq Antigravity*"', { stdio: 'pipe' });
} catch (e) {}

console.log('\n=== Step 2: Capture log sizes BEFORE start ===');
const before = {
  main: fs.existsSync(mainLog) ? fs.statSync(mainLog).size : 0,
  pr: fs.existsSync(prLog) ? fs.statSync(prLog).size : 0,
  ls: fs.existsSync(lsLog) ? fs.statSync(lsLog).size : 0,
};
console.log('  before:', before);

console.log('\n=== Step 3: Launch Antigravity ===');
try {
  execSync('start "" "C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe"', { stdio: 'pipe' });
  console.log('  Launched. Waiting 15s for startup...');
} catch (e) {
  console.log('  Launch failed:', e.message);
}

setTimeout(() => {
  console.log('\n=== Step 4: Capture log sizes AFTER start ===');
  const after = {
    main: fs.existsSync(mainLog) ? fs.statSync(mainLog).size : 0,
    pr: fs.existsSync(prLog) ? fs.statSync(prLog).size : 0,
    ls: fs.existsSync(lsLog) ? fs.statSync(lsLog).size : 0,
  };
  console.log('  after:', after);
  console.log('  delta:', {
    main: after.main - before.main,
    pr: after.pr - before.pr,
    ls: after.ls - before.ls,
  });

  console.log('\n=== Step 5: Check processes ===');
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
    const procs = out.split('\n').filter(l => /antigravity|language_server/i.test(l));
    if (procs.length === 0) console.log('  NO processes running!');
    procs.forEach(p => console.log('  ' + p));
  } catch (e) {}

  console.log('\n=== Step 6: Check port 50999 ===');
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes(':50999'));
    if (lines.length === 0) console.log('  Port 50999 NOT listening');
    lines.forEach(l => console.log('  ' + l.trim()));
  } catch (e) {}

  console.log('\n=== Step 7: Tail main.log (new lines) ===');
  if (fs.existsSync(mainLog)) {
    const content = fs.readFileSync(mainLog, 'utf8');
    const allLines = content.split('\n');
    // Show only lines added since "before"
    const beforeContent = content.substring(0, before.main);
    const newContent = content.substring(before.main);
    const newLines = newContent.split('\n').filter(l => l.trim());
    console.log('  new lines count:', newLines.length);
    newLines.slice(-40).forEach(l => console.log('  ' + l));
  }

  console.log('\n=== Step 8: Tail proxy-runner.log ===');
  if (fs.existsSync(prLog)) {
    const content = fs.readFileSync(prLog, 'utf8');
    const lines = content.split('\n');
    console.log('  last 30 lines:');
    lines.slice(-30).forEach(l => console.log('  ' + l));
  } else {
    console.log('  no proxy-runner.log file');
  }

  process.exit(0);
}, 15000);