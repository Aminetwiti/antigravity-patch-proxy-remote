#!/usr/bin/env node
// scripts/diag/dump-main-flow.cjs — Find whenReady + startAndMonitor calls in main.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const mainContent = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
const mainLines = mainContent.split('\n');

// Find all references to whenReady and startAndMonitor
console.log('=== All "whenReady" references ===');
for (let i = 0; i < mainLines.length; i++) {
  if (/whenReady|startAndMonitor|startLanguageServer|startProxy/i.test(mainLines[i])) {
    console.log('  L' + (i + 1) + ': ' + mainLines[i].trim().substring(0, 150));
  }
}

console.log('\n=== Lines 215-240 (around L222 call) ===');
for (let i = 214; i < Math.min(240, mainLines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + mainLines[i]);
}

console.log('\n=== Lines 150-230 (look for function context) ===');
for (let i = 149; i < Math.min(230, mainLines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + mainLines[i]);
}