#!/usr/bin/env node
// scripts/diag/dump-whenready.cjs — Dump full whenReady block (140-225)
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\main.js').toString('utf8');
const lines = content.split('\n');

console.log('=== whenReady block (140-225) ===');
for (let i = 139; i < Math.min(225, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
}