#!/usr/bin/env node
/**
 * scripts/diag/relaunch2.cjs
 * Minimal version: just kill old AG, launch new AG, dump everything.
 */
'use strict';
const { execSync, spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPORT = path.join(os.tmpdir(), 'ag-relaunch-report.txt');
const AG_EXE = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe';
const LOG_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs');

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) {
    // Powershell + many Windows commands return non-zero on "no results".
    return e.stdout ? e.stdout.toString() : '';
  }
}
function append(s) {
  try {
    fs.appendFileSync(REPORT, s + '\n');
  } catch {}
}
function writeInit() {
  try { fs.writeFileSync(REPORT, '=== AG relaunch report @ ' + new Date().toISOString() + ' ===\n'); }
  catch {}
}

writeInit();

// Step 1 — kill
append('\n[1] Kill existing');
for (const n of ['Antigravity.exe', 'language_server.exe']) {
  try { sh(`taskkill /F /IM ${n} /T`); append('  killed ' + n); } catch {}
}

// Step 2 — free port 50999
append('\n[2] Free port 50999');
try {
  const pids = sh('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 50999 -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }"');
  if (pids && pids.trim()) {
    for (const pid of pids.split('\n').map(l => l.trim()).filter(Boolean)) {
      try { sh(`taskkill /F /PID ${pid} /T`); append('  killed PID ' + pid); } catch {}
    }
  } else {
    append('  port free');
  }
} catch (e) { append('  (skip: ' + e.message + ')'); }

// Step 3 — launch (use execFile detached so the parent process can return)
append('\n[3] Launch');
try {
  // Detached with spawn + unref; this is the most reliable.
  const child = spawn(AG_EXE, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  append('  spawned Antigravity.exe PID ' + child.pid);
} catch (e) {
  append('  spawn failed: ' + e.message);
}

// Force any further writes to flush via a small setImmediate
setImmediate(() => {
  append('\n[4] Step 3 submitted. Sleeping 15s...');
  setTimeout(() => {
    append('\n[5] After 15s, dumping state');

    function stat(p) {
      try { const s = fs.statSync(p); return `${s.size} B mtime=${s.mtime.toISOString()}`; }
      catch (e) { return 'MISSING'; }
    }
    function show(name, p, n = 80) {
      append(`\n--- ${name}: ${p}  (${stat(p)})`);
      try {
        const c = fs.readFileSync(p, 'utf8');
        const lines = c.split('\n');
        const start = Math.max(0, lines.length - n);
        append(`(lines ${start}..${lines.length})`);
        append(lines.slice(start).join('\n'));
      } catch (e) { append('  (cannot read)'); }
    }
    show('main',       path.join(LOG_DIR, 'main.log'));
    show('renderer',   path.join(LOG_DIR, 'renderer.log'), 120);
    show('language_server', path.join(LOG_DIR, 'language_server.log'), 40);

    append('\n--- port 50999 ---');
    try {
      const p = sh('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 50999 -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String"');
      append(p.trim() || '  no listener');
    } catch (e) { append('  (skip)'); }

    append('\n--- processes (all "Antigravity*" + node.exe) ---');
    try {
      const pr = sh('tasklist /FO CSV /NH');
      pr.split('\n').filter(l => /antigravity|language_server|node\.exe/i.test(l)).forEach(p => append('  ' + p));
    } catch (e) { append('  (skip)'); }

    append('\n--- window titles (Antigravity only, non-empty) ---');
    try {
      const pr = sh('tasklist /V /FO CSV /NH');
      pr.split('\n').filter(l => /antigravity/i.test(l)).forEach(p => {
        if (!/"",""N\/A"/.test(p) && !/,""\s*$/.test(p)) append('  ' + p);
      });
    } catch (e) { append('  (skip)'); }

    append('\n=== DONE ===');
    console.log('REPORT: ' + REPORT);
    console.log(fs.readFileSync(REPORT, 'utf8'));
    process.exit(0);
  }, 15000);
});
