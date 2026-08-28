#!/usr/bin/env node
// scripts/diag/find-constants-rest.cjs — Dump rest of constants.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ideInstall\\constants.js').toString('utf8');
const lines = content.split('\n');
console.log('=== Lines 100-132 ===');
lines.slice(99).forEach((l, i) => console.log('  L' + (100 + i) + ': ' + l));