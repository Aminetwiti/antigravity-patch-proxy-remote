#!/usr/bin/env node
// scripts/diag/find-shouldshow.cjs — Find shouldShowIdeInstallWizard definition
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ideInstall\\constants.js').toString('utf8');
const lines = content.split('\n');

console.log('=== ideInstall/constants.js (' + lines.length + ' lines) ===');
for (let i = 0; i < Math.min(100, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}