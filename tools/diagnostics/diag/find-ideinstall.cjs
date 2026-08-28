#!/usr/bin/env node
// scripts/diag/find-ideinstall.cjs — Find IDE Wizard logic
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ideInstall\\index.js').toString('utf8');
const lines = content.split('\n');
console.log('=== dist/ideInstall/index.js (' + lines.length + ' lines) ===');
console.log('=== First 80 lines ===');
for (let i = 0; i < Math.min(80, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}

console.log('\n=== Look for maybeShowIdeInstallWizard / show ===');
for (let i = 0; i < lines.length; i++) {
  if (/maybeShowIdeInstallWizard|Already shown|skipping|createWindow|wizard/.test(lines[i])) {
    console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
  }
}