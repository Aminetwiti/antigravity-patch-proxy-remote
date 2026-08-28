#!/usr/bin/env node
// scripts/diag/compare-asars.cjs — Compare original vs patched asar contents
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const orig = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const patched = 'C:/Users/amine/AppData/Local/Temp/app.asar.patched';

console.log('=== Original asar ===');
console.log('  size:', fs.statSync(orig).size, 'B');
const origList = asar.listPackage(orig);
console.log('  total entries:', origList.length);
console.log('  size by top-level dir:');
const origByDir = {};
for (const f of origList) {
  const top = f.split('/')[0] || f;
  origByDir[top] = (origByDir[top] || 0) + 1;
}
for (const [k, v] of Object.entries(origByDir).sort((a, b) => b[1] - a[1])) {
  console.log('    ' + k.padEnd(20) + ' ' + v + ' entries');
}

console.log('\n=== Patched asar ===');
console.log('  size:', fs.statSync(patched).size, 'B');
const patchedList = asar.listPackage(patched);
console.log('  total entries:', patchedList.length);
console.log('  size by top-level dir:');
const patchedByDir = {};
for (const f of patchedList) {
  const top = f.split('/')[0] || f;
  patchedByDir[top] = (patchedByDir[top] || 0) + 1;
}
for (const [k, v] of Object.entries(patchedByDir).sort((a, b) => b[1] - a[1])) {
  console.log('    ' + k.padEnd(20) + ' ' + v + ' entries');
}

console.log('\n=== NEW files in patched (not in original) ===');
const origSet = new Set(origList);
const newFiles = patchedList.filter(f => !origSet.has(f));
console.log('  total new:', newFiles.length);
newFiles.slice(0, 50).forEach(f => console.log('    + ' + f));
if (newFiles.length > 50) console.log('    ... and ' + (newFiles.length - 50) + ' more');

console.log('\n=== FILES in original but NOT in patched (should be 0) ===');
const patchedSet = new Set(patchedList);
const removedFiles = origList.filter(f => !patchedSet.has(f));
console.log('  total removed:', removedFiles.length);
removedFiles.slice(0, 20).forEach(f => console.log('    - ' + f));

console.log('\n=== Sample node_modules/ entries in patched ===');
const nmEntries = patchedList.filter(f => f.startsWith('node_modules/'));
console.log('  node_modules/ entries:', nmEntries.length);
nmEntries.slice(0, 20).forEach(f => console.log('    ' + f));

console.log('\n=== Sample dist/ entries in patched ===');
const distEntries = patchedList.filter(f => f.startsWith('dist/'));
console.log('  dist/ entries:', distEntries.length);
distEntries.slice(0, 30).forEach(f => console.log('    ' + f));