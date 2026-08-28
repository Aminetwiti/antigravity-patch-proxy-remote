#!/usr/bin/env node
/**
 * Cleanly relaunch Antigravity with full log capture.
 *  - Kills all running Antigravity + electron + language_server processes
 *  - Backs up current logs
 *  - Launches Antigravity
 *  - Waits, then dumps main.log + shows DevTools URL
 */
'use strict';
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AG_INSTALL = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity';
const AG_EXE     = path.join(AG_INSTALL, 'Antigravity.exe');
const LOG_DIR    = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs');
const RENDERER   = path.join(LOG_DIR, 'renderer.log');
const MAIN       = path.join(LOG_DIR, 'main.log');
const LS         = path.join(LOG_DIR, 'language_server.log');

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch (e) { return ''; }
}

console.log('=== Step 1: Kill all Antigravity-related processes ===');
['Antigravity.exe', 'language_server.exe', 'node.exe']
  .forEach(name => {
    try { execSync(`taskkill /F /IM ${name} /T`, { stdio: 'pipe' }); console.log(`  killed ${name}`); }
    catch (e) { /* nothing */ }
  });

// Kill any lingering node processes that might be proxy-runner / ag-doctor
try {
  const procs = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
  procs.split('\n').forEach(line => {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (!m) return;
    const [, name, pid] = m;
    if (name === 'node.exe') {
      try {
        const cmd = execSync(`wmic process where "ProcessId=${pid}" get CommandLine /VALUE`, { encoding: 'utf8' });
        if (/proxy-runner|ag-doctor/i.test(cmd)) {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'pipe' });
          console.log(`  killed ${name} pid=${pid} (${cmd.match(/proxy-runner|ag-doctor/)?.[0]})`);
        }
      } catch (e) { /* nothing */ }
    }
  });
} catch (e) { /* nothing */ }

console.log('\n=== Step 2: Backup logs (just in case) ===');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
[MAIN, RENDERER, LS].forEach(f => {
  if (fs.existsSync(f)) {
    const bak = f + '.pre-' + stamp + '.bak';
    try { fs.copyFileSync(f, bak); console.log(`  backed up: ${path.basename(bak)}`); }
    catch (e) { console.log(`  backup failed (file busy?): ${e.message}`); }
  } else {
    console.log(`  (does not exist): ${path.basename(f)}`);
  }
});

console.log('\n=== Step 3: Free up port 50999 if anything is holding it ===');
try {
  const out = sh('netstat -ano | findstr :50999');
  if (out) {
    console.log('  port 50999 is held by:\n' + out.split('\n').map(l => '    ' + l).join('\n'));
    out.split('\n').forEach(line => {
      const m = line.match(/\s(\d+)$/);
      if (m) {
        try { execSync(`taskkill /F /PID ${m[1]} /T`, { stdio: 'pipe' }); console.log(`  killed PID ${m[1]}`); }
        catch (e) { /* nothing */ }
      }
    });
  } else {
    console.log('  port 50999 free');
  }
} catch (e) { console.log('  port check failed'); }

console.log('\n=== Step 4: Wait 2s then launch Antigravity ===');
setTimeout(() => {
  console.log('  launching...');
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '""', AG_EXE], {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
  } catch (e) { console.log('  launch failed:', e.message); }

  console.log('\n=== Step 5: Wait 10s, then check state ===');
  setTimeout(() => {
    console.log('\n--- main.log (tail 40) ---');
    if (fs.existsSync(MAIN)) {
      const c = fs.readFileSync(MAIN, 'utf8');
      const lines = c.split('\n');
      const recent = lines.slice(-40);
      console.log(recent.join('\n') || '(empty)');
      console.log(`\n  total lines in main.log: ${lines.filter(l => l.trim()).length}`);
      console.log(`  last modified: ${fs.statSync(MAIN).mtime.toISOString()}`);
    } else { console.log('  (missing)'); }

    console.log('\n--- renderer.log (tail 40) ---');
    if (fs.existsSync(RENDERER)) {
      const c = fs.readFileSync(RENDERER, 'utf8');
      console.log(c.split('\n').slice(-40).join('\n') || '(empty)');
    } else { console.log('  (does not exist yet — renderer did not write any log)'); }

    console.log('\n--- language_server.log (tail 20) ---');
    if (fs.existsSync(LS)) {
      const c = fs.readFileSync(LS, 'utf8');
      console.log(c.split('\n').slice(-20).join('\n') || '(empty)');
    } else { console.log('  (missing)'); }

    console.log('\n--- port 50999 ---');
    try { console.log(execSync('netstat -ano | findstr :50999', { encoding: 'utf8' })); }
    catch (e) { console.log('  no listener'); }

    console.log('\n--- Antigravity processes ---');
    try {
      const procs = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      procs.split('\n').filter(l => /antigravity|language_server/i.test(l)).forEach(p => console.log('  ' + p));
    } catch (e) { console.log('  (none)'); }

    console.log('\n=== ALL DONE — look at the logs above ===');
    process.exit(0);
  }, 10000);
}, 2000);
