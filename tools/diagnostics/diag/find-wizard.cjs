#!/usr/bin/env node
// scripts/diag/find-wizard.cjs — Dump wizard.js content
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ideInstall\\wizard.js').toString('utf8');
const lines = content.split('\n');
console.log('=== dist/ideInstall/wizard.js (' + lines.length + ' lines) ===');

// Find maybeShowIdeInstallWizard function
const startIdx = lines.findIndex(l => l.includes('function maybeShowIdeInstallWizard') || l.includes('maybeShowIdeInstallWizard ='));
if (startIdx >= 0) {
  console.log('\n=== maybeShowIdeInstallWizard function ===');
  for (let i = startIdx; i < Math.min(startIdx + 60, lines.length); i++) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
  }
}

// Find "Already shown"
for (let i = 0; i < lines.length; i++) {
  if (/Already shown|skipping/.test(lines[i])) {
    console.log('\n=== L' + (i + 1) + ' ===');
    for (let j = Math.max(0, i - 3); j < Math.min(i + 10, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j]);
    }
  }
}