#!/usr/bin/env node
// scripts/diag/check-calls.cjs — Check what functions are called in main.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const mainContent = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
const mainLines = mainContent.split('\n');

console.log('=== Total lines:', mainLines.length, '===');

// Find any references to languageServer or startLanguageServer
console.log('\n=== References to languageServer/startProxy/startAndMonitor ===');
for (let i = 0; i < mainLines.length; i++) {
  if (/languageServer|startProxy|startAndMonitor|startLanguageServer/i.test(mainLines[i])) {
    console.log('  L' + (i + 1) + ': ' + mainLines[i].trim().substring(0, 150));
  }
}

// Compare with the REPO's main.js
console.log('\n=== Repo main.js — references ===');
const repoMain = require('fs').readFileSync('./dist/main.js', 'utf8');
const repoLines = repoMain.split('\n');
for (let i = 0; i < repoLines.length; i++) {
  if (/languageServer|startProxy|startAndMonitor|startLanguageServer/i.test(repoLines[i])) {
    console.log('  L' + (i + 1) + ': ' + repoLines[i].trim().substring(0, 150));
  }
}

console.log('\n=== Difference in imports ===');
// First 100 lines of each
console.log('--- Deployed main.js first 80 lines ---');
mainLines.slice(0, 80).forEach((l, i) => console.log('  L' + (i + 1) + ': ' + l));
console.log('\n--- Repo main.js first 80 lines ---');
repoLines.slice(0, 80).forEach((l, i) => console.log('  L' + (i + 1) + ': ' + l));