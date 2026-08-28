#!/usr/bin/env node
// scripts/diag/compare-versions.cjs — Compare repo files vs deployed 2.3.1 files
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/amine/AppData/Local/Temp/antigravity-2.3-extract';
const dist = path.join(base, 'dist');

console.log('=== Critical files to OVERWRITE (because Google removed proxy hooks) ===\n');

// Files that need to be replaced (deployed shrank significantly)
const replacements = [
  { file: 'main.js',           reason: 'TLS bypass + require(\'../proxy-runner\') removed' },
  { file: 'languageServer.js', reason: 'proxy wiring + port 50999 removed' },
  { file: 'ipcHandlers.js',    reason: 'custom-model IPC handlers removed' },
  { file: 'preload.js',        reason: 'Custom Models UI injection removed (75 KB → 5 KB)' },
  { file: 'constants.js',      reason: 'PROVIDERS list + config removed (9.9 KB → 355 B)' },
];

for (const r of replacements) {
  const repoPath = path.join(__dirname, '..', '..', 'dist', r.file);
  if (!fs.existsSync(repoPath)) { console.log('  [MISSING IN REPO] ' + r.file); continue; }
  const deployed = fs.existsSync(path.join(dist, r.file))
    ? fs.readFileSync(path.join(dist, r.file), 'utf8')
    : null;
  const repo = fs.readFileSync(repoPath, 'utf8');
  console.log('--- ' + r.file + ' (' + r.reason + ') ---');
  console.log('  Deployed: ' + (deployed ? deployed.length + ' B, ' + deployed.split('\n').length + ' lines' : 'NOT FOUND'));
  console.log('  Repo:     ' + repo.length + ' B, ' + repo.split('\n').length + ' lines');
  if (deployed) {
    // Find first major difference
    const dLines = deployed.split('\n');
    const rLines = repo.split('\n');
    const minLen = Math.min(dLines.length, rLines.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
      if (dLines[i].trim() !== rLines[i].trim()) { firstDiff = i + 1; break; }
    }
    if (firstDiff === -1) firstDiff = minLen + 1;
    console.log('  First major diff at: L' + firstDiff);
    console.log('    DEPLOYED L' + firstDiff + ': ' + (dLines[firstDiff - 1] || '(end)').trim().substring(0, 80));
    console.log('    REPO     L' + firstDiff + ': ' + (rLines[firstDiff - 1]  || '(end)').trim().substring(0, 80));
  }
  console.log();
}

console.log('=== Find "proxy-runner" / "require" patterns in deployed main.js ===');
const mainSrc = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
const mainLines = mainSrc.split('\n');
// Show first 30 + last 30 lines
console.log('  --- FIRST 30 lines ---');
for (let i = 0; i < Math.min(30, mainLines.length); i++) console.log('  L' + (i+1) + ': ' + mainLines[i]);
console.log('  --- LAST 30 lines ---');
for (let i = Math.max(0, mainLines.length - 30); i < mainLines.length; i++) console.log('  L' + (i+1) + ': ' + mainLines[i]);

console.log('\n=== Find proxy-runner in repo ===');
const repoMain = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'main.js'), 'utf8');
const repoMainLines = repoMain.split('\n');
const runnerRefs = [];
for (let i = 0; i < repoMainLines.length; i++) {
  if (/proxy-runner|50999|TLS|cryptoStore|proxy.js|customModel/i.test(repoMainLines[i])) {
    runnerRefs.push('  L' + (i+1) + ': ' + repoMainLines[i].trim().substring(0, 100));
  }
}
console.log('  Repo main.js proxy/patch references:');
runnerRefs.forEach(r => console.log(r));

console.log('\n=== Repo languageServer.js proxy refs ===');
const repoLS = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'languageServer.js'), 'utf8');
const repoLSLines = repoLS.split('\n');
const lsRefs = [];
for (let i = 0; i < repoLSLines.length; i++) {
  if (/proxy-runner|50999|startProxy|TLS|cryptoStore|proxy.js|customModel/i.test(repoLSLines[i])) {
    lsRefs.push('  L' + (i+1) + ': ' + repoLSLines[i].trim().substring(0, 120));
  }
}
console.log('  Repo languageServer.js proxy/patch references:');
lsRefs.forEach(r => console.log(r));