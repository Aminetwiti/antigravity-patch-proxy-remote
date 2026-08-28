#!/usr/bin/env node
// scripts/diag/find-wizard2.cjs — Dump maybeShowIdeInstallWizard body
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ideInstall\\wizard.js').toString('utf8');
const lines = content.split('\n');

// Find function maybeShowIdeInstallWizard
let idx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function maybeShowIdeInstallWizard')) { idx = i; break; }
}
if (idx < 0) {
  // try with arrow function
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('maybeShowIdeInstallWizard') && lines[i].includes('=>')) { idx = i; break; }
  }
}
console.log('function at line', idx + 1);
console.log('\n=== maybeShowIdeInstallWizard body ===');
if (idx >= 0) {
  for (let i = idx; i < Math.min(idx + 50, lines.length); i++) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
  }
}

// Also dump "Already shown" context
console.log('\n=== "Already shown" context ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Already shown')) {
    for (let j = Math.max(0, i - 5); j < Math.min(i + 10, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j]);
    }
  }
}

// Look at shouldShowIdeInstallWizard
console.log('\n=== shouldShowIdeInstallWizard ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function shouldShow') || lines[i].includes('shouldShowIdeInstallWizard =')) {
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j]);
    }
  }
}