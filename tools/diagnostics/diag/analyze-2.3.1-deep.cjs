#!/usr/bin/env node
// scripts/diag/analyze-2.3.1-deep.cjs — Deeper inspection
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/amine/AppData/Local/Temp/antigravity-2.3-extract';
const dist = path.join(base, 'dist');

function readLines(file, startLine, endLine) {
  const src = fs.readFileSync(path.join(dist, file), 'utf8');
  const lines = src.split('\n');
  for (let i = startLine - 1; i < Math.min(endLine, lines.length); i++) {
    console.log('    L' + (i + 1) + ': ' + lines[i]);
  }
}

function fileSize(file) {
  const p = path.join(dist, file);
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

console.log('=== File sizes (deployed vs repo) ===');
const files = ['main.js', 'languageServer.js', 'ipcHandlers.js', 'preload.js', 'constants.js', 'paths.js', 'utils.js'];
for (const f of files) {
  const depSize = fileSize(f);
  const repoPath = path.join(__dirname, '..', '..', 'dist', f);
  const repoSize = fs.existsSync(repoPath) ? fs.statSync(repoPath).size : 0;
  console.log('  ' + f.padEnd(25) + ' deployed=' + depSize.toString().padStart(8) + ' B   repo=' + repoSize.toString().padStart(8) + ' B   delta=' + (depSize - repoSize));
}

console.log('\n=== languageServer.js FULL content (no proxy refs → check new mechanism) ===');
const lsSize = fileSize('languageServer.js');
console.log('Total lines:');
const lsContent = fs.readFileSync(path.join(dist, 'languageServer.js'), 'utf8');
console.log('  ' + lsContent.split('\n').length + ' lines, ' + lsSize + ' B');

console.log('\n=== Searching for "proxy" / "50999" / "patch" in languageServer.js ===');
const lsLines = lsContent.split('\n');
const hits = [];
for (let i = 0; i < lsLines.length; i++) {
  if (/proxy|50999|patch|intercept|MITM|cryptoStore|customModel|schemaValid/i.test(lsLines[i])) {
    hits.push('  L' + (i + 1) + ': ' + lsLines[i].trim());
  }
}
if (hits.length === 0) console.log('  NO HITS — proxy/patch mechanism has been removed from languageServer.js');
else hits.forEach(h => console.log(h));

console.log('\n=== Searching for "proxy" / "50999" / "patch" in main.js ===');
const mainContent = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
const mainLines = mainContent.split('\n');
const mainHits = [];
for (let i = 0; i < mainLines.length; i++) {
  if (/proxy|50999|patch|intercept|MITM|cryptoStore|customModel|schemaValid/i.test(mainLines[i])) {
    mainHits.push('  L' + (i + 1) + ': ' + mainLines[i].trim());
  }
}
if (mainHits.length === 0) console.log('  NO HITS — proxy/patch mechanism has been removed from main.js');
else mainHits.slice(0, 30).forEach(h => console.log(h));

console.log('\n=== Searching for "proxy" / "50999" / "patch" in ipcHandlers.js ===');
const ipcContent = fs.readFileSync(path.join(dist, 'ipcHandlers.js'), 'utf8');
const ipcHits = [];
const ipcLines = ipcContent.split('\n');
for (let i = 0; i < ipcLines.length; i++) {
  if (/proxy|50999|patch|intercept|MITM|cryptoStore|customModel|schemaValid/i.test(ipcLines[i])) {
    ipcHits.push('  L' + (i + 1) + ': ' + ipcLines[i].trim());
  }
}
if (ipcHits.length === 0) console.log('  NO HITS — proxy/patch mechanism has been removed from ipcHandlers.js');
else ipcHits.slice(0, 30).forEach(h => console.log(h));

console.log('\n=== Searching language_server.exe for URL patterns (BUF) ===');
const lsBin = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/bin/language_server.exe';
if (fs.existsSync(lsBin)) {
  const buf = fs.readFileSync(lsBin);
  const str = buf.toString('binary');
  const patterns = [
    'daily-cloudcode-pa.googleapis.com',
    'cloudcode-pa.googleapis.com',
    'cloudcode.googleapis.com',
    'daily-cloudcode',
    '127.0.0.1:50999',
    'localhost:50999',
    'v1internal',
    'antigravity',
  ];
  for (const pat of patterns) {
    const safe = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(safe, 'g');
    const matches = str.match(re);
    if (matches) console.log('  ' + pat.padEnd(40) + ' → ' + matches.length + ' occurrences');
  }
}

console.log('\n=== Check resources/ for custom proxy stubs ===');
const resDir = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources';
const items = fs.readdirSync(resDir);
for (const item of items) {
  const p = path.join(resDir, item);
  const stat = fs.statSync(p);
  if (stat.isFile()) console.log('  ' + item + ' (' + stat.size + ' B)');
  else console.log('  [' + item + '/]');
}

console.log('\n=== Check root of app.asar for proxy-related files ===');
const rootFiles = fs.readdirSync(base);
const interesting = rootFiles.filter(f => /proxy|custom|patch|model|schema|crypto/i.test(f));
console.log('  Root-level proxy-related:', interesting.length ? interesting : 'NONE');
console.log('  Total root files:', rootFiles.length);
console.log('  Root dirs:', fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).join(', '));