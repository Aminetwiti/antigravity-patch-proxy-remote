#!/usr/bin/env node
/**
 * scripts/diag/relaunch.cjs
 * Cleanly relaunch Antigravity and dump everything to a single report file.
 *   node scripts/diag/relaunch.cjs
 *   -> writes C:\Users\amine\AppData\Local\Temp\ag-relaunch-report.txt
 */
'use strict';
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPORT = path.join(os.tmpdir(), 'ag-relaunch-report.txt');
const AG_EXE = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe';
const LOG_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs');

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { return ''; }
}

(async () => {
  const out = [];
  const log = (s) => { out.push(s); try { fs.writeFileSync(REPORT, out.join('\n')); } catch {} };
  log('=== AG relaunch report @ ' + new Date().toISOString() + ' ===');

  // 1. Kill
  log('\n[1] Kill existing processes');
  ['Antigravity.exe', 'language_server.exe'].forEach(n => {
    try { execSync(`taskkill /F /IM ${n} /T`, { stdio: 'pipe' }); log('  killed ' + n); }
    catch (e) { /* ignore */ }
  });
  try {
    const procs = sh('tasklist /FO CSV /NH');
    procs.split('\n').forEach(line => {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m && m[1] === 'node.exe') {
        try {
          const c = sh(`wmic process where "ProcessId=${m[2]}" get CommandLine /VALUE`);
          if (/proxy-runner|ag-doctor/i.test(c)) {
            execSync(`taskkill /F /PID ${m[2]} /T`, { stdio: 'pipe' });
            log('  killed node.exe pid=' + m[2]);
          }
        } catch (e) { /* ignore */ }
      }
    });
  } catch (e) { /* ignore */ }

  // 2. Free port 50999
  log('\n[2] Free port 50999');
  try {
    // Use PowerShell instead of netstat+findstr, which can throw on no results.
    const busy = sh('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 50999 -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }"');
    if (busy && busy.trim()) {
      busy.split('\n').map(l => l.trim()).filter(Boolean).forEach(pid => {
        try {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'pipe' });
          log('  killed PID ' + pid);
        } catch (e) { /* ignore */ }
      });
    } else {
      log('  port already free');
    }
  } catch (e) { log('  (could not check port: ' + e.message + ')'); }

  // 3. Launch
  log('\n[3] Launch ' + AG_EXE);
  try {
    // Try cmd.exe /c start. If it fails, fall back to direct spawn.
    const child = spawn('cmd.exe', ['/c', 'start', '""', AG_EXE], {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    setTimeout(() => {
      // After 2s, check if it actually started
      try {
        const procs = sh('tasklist /FO CSV /NH').split('\n')
          .filter(l => /^"Antigravity\.exe"/.test(l));
        if (procs.length === 0) {
          // direct spawn fallback
          const ag = spawn(AG_EXE, [], { detached: true, stdio: 'ignore', windowsHide: false });
          ag.unref();
        }
      } catch (e) { /* ignore */ }
    }, 2000);
    log('  launched (cmd.exe start, with fallback)');
  } catch (e) {
    log('  launch via cmd failed, trying direct: ' + e.message);
    try {
      const ag = spawn(AG_EXE, [], { detached: true, stdio: 'ignore', windowsHide: false });
      ag.unref();
      log('  launched via direct spawn');
    } catch (e2) { log('  all launch attempts failed: ' + e2.message); }
  }

  // 4. Wait
  log('\n[4] Wait 12s for startup');
  await new Promise(r => setTimeout(r, 12000));

  // 5. Dump
  function stat(p) {
    try { const s = fs.statSync(p); return `${s.size} B mtime=${s.mtime.toISOString()}`; }
    catch (e) { return 'MISSING'; }
  }
  function show(name, p, n = 60) {
    log(`\n[5.${name}] ${p}  (${stat(p)})`);
    try {
      const c = fs.readFileSync(p, 'utf8');
      const lines = c.split('\n');
      log('--- last ' + n + ' lines ---');
      log(lines.slice(-n).join('\n') || '(empty)');
    } catch (e) { log('  (cannot read)'); }
  }

  show('main',   path.join(LOG_DIR, 'main.log'));
  show('render', path.join(LOG_DIR, 'renderer.log'), 80);
  show('ls',     path.join(LOG_DIR, 'language_server.log'), 30);

  log('\n[6] port 50999');
  try {
    const ps = sh('netstat -ano | findstr :50999').trim();
    log(ps || '  (no listener)');
  } catch (e) { log('  (check failed)'); }

  log('\n[7] Antigravity processes');
  try {
    const pr = sh('tasklist /FO CSV /NH');
    pr.split('\n').filter(l => /antigravity|language_server/i.test(l)).forEach(p => log('  ' + p));
  } catch (e) { log('  (none)'); }

  log('\n[8] window titles (only non-empty)');
  try {
    const pr = sh('tasklist /V /FO CSV /NH');
    pr.split('\n').filter(l => /antigravity/i.test(l)).forEach(p => {
      if (!/"N\/A"/.test(p)) log('  ' + p);
    });
  } catch (e) { log('  (none)'); }

  log('\n=== DONE ===');
  console.log('Report written to: ' + REPORT);
  console.log('--- REPORT CONTENTS ---');
  console.log(fs.readFileSync(REPORT, 'utf8'));
})();
