#!/usr/bin/env node
// scripts/diag/verify-fixes.cjs — Verify all our fixes are deployed
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\main.js').toString('utf8');
const lines = content.split('\n');

console.log('=== Verify fixes in dist/main.js ===');
console.log('Total lines:', lines.length);

// Find require('../proxy-runner')
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("require('../proxy-runner')")) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
  }
}

// Find try { main_1.default.initialize() ...
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('main_1.default.initialize')) {
    console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
    // Show next 3 lines
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j].substring(0, 200));
    }
  }
}

// Find maybeShowIdeInstallWizard (should be commented out)
console.log('\n=== maybeShowIdeInstallWizard context ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('maybeShowIdeInstallWizard')) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
    for (let j = Math.max(0, i - 2); j < Math.min(i + 3, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j].substring(0, 200));
    }
  }
}