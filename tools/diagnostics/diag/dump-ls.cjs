#!/usr/bin/env node
// scripts/diag/dump-ls.cjs — Dump deployed languageServer.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist/languageServer.js').toString('utf8');
const lines = content.split('\n');

console.log('=== Total lines:', lines.length, '===');
console.log('\n=== Last 100 lines (where startProxy should be) ===');
lines.slice(-100).forEach((l, i) => console.log('  L' + (lines.length - 100 + i + 1) + ': ' + l));

console.log('\n=== Find startProxy locations ===');
let idx = -1;
while ((idx = content.indexOf('startProxy', idx + 1)) >= 0) {
  console.log('  pos ' + idx + ': ...' + content.substring(Math.max(0, idx - 30), idx + 100).replace(/\n/g, ' | '));
}