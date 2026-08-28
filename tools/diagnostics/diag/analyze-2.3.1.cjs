#!/usr/bin/env node
// scripts/diag/analyze-2.3.1.cjs — Diagnostic script for installed Antigravity
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/amine/AppData/Local/Temp/antigravity-2.3-extract';

console.log('=== 1. Check proxy-runner.js in asar ===');
const pr = path.join(base, 'proxy-runner.js');
console.log('  exists:', fs.existsSync(pr));
if (fs.existsSync(pr)) {
  const src = fs.readFileSync(pr, 'utf8');
  console.log('  size:', src.length, 'B');
  console.log('  first 40 lines:');
  console.log(src.split('\n').slice(0, 40).map(l => '    ' + l).join('\n'));
}

console.log('\n=== 2. Check app.asar.unpacked ===');
const unpacked = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar.unpacked';
if (fs.existsSync(unpacked)) {
  const walk = (dir, prefix='') => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p, prefix + f.name + '/');
      else console.log('  ' + prefix + f.name + ' (' + fs.statSync(p).size + ' B)');
    }
  };
  walk(unpacked);
}

console.log('\n=== 3. Find proxy/proxy-runner references in deployed JS ===');
const dist = path.join(base, 'dist');
const filesToCheck = ['main.js', 'languageServer.js', 'ipcHandlers.js', 'preload.js'];
const RE_PROXY = /require\(['"](?:\.\.\/)+proxy(?:-runner)?['"]|proxy-runner|cryptoStore|customModelStore|schemaValidator/g;
for (const f of filesToCheck) {
  const p = path.join(dist, f);
  if (!fs.existsSync(p)) { console.log('  --- ' + f + ': NOT FOUND'); continue; }
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (RE_PROXY.test(lines[i])) {
      hits.push('    L' + (i + 1) + ': ' + lines[i].trim());
      RE_PROXY.lastIndex = 0;
    }
  }
  if (hits.length) {
    console.log('  --- ' + f + ' ---');
    hits.slice(0, 20).forEach(h => console.log(h));
    if (hits.length > 20) console.log('    ... and ' + (hits.length - 20) + ' more');
  }
}

console.log('\n=== 4. Sample first 60 lines of deployed languageServer.js ===');
const lsPath = path.join(dist, 'languageServer.js');
if (fs.existsSync(lsPath)) {
  const lines = fs.readFileSync(lsPath, 'utf8').split('\n');
  lines.slice(0, 60).forEach((l, i) => console.log('    L' + (i + 1) + ': ' + l));
}

console.log('\n=== 5. Search for cloudcode URL pattern in language_server.exe ===');
const lsBin = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/bin/language_server.exe';
if (fs.existsSync(lsBin)) {
  const buf = fs.readFileSync(lsBin);
  // Search for known URL substrings
  const patterns = [
    'daily-cloudcode-pa.googleapis.com',
    'cloudcode-pa.googleapis.com',
    'cloudcode.googleapis.com',
    'daily-cloudcode',
    '127.0.0.1:50999',
    'localhost:50999',
    'v1internal',
    'googapis.com',
  ];
  for (const pat of patterns) {
    let idx = 0;
    const count = (buf.toString('binary').match(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count > 0) console.log('  ' + pat + ': ' + count + ' occurrences');
  }
}