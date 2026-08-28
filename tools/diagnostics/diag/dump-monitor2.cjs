#!/usr/bin/env node
// scripts/diag/dump-monitor2.cjs — Dump startAndMonitorLanguageServer body
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist/languageServer.js').toString('utf8');
const lines = content.split('\n');

const idx = content.indexOf('function startAndMonitorLanguageServer');
console.log('=== function startAndMonitorLanguageServer ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function startAndMonitorLanguageServer')) {
    for (let j = i; j < Math.min(i + 50, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j]);
    }
    break;
  }
}

// Also dump main.js's whenReady block
console.log('\n=== main.js whenReady block ===');
const mainContent = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
const mainLines = mainContent.split('\n');
let wrIdx = -1;
for (let i = 0; i < mainLines.length; i++) {
  if (mainLines[i].includes('app.whenReady')) {
    wrIdx = i;
    break;
  }
}
if (wrIdx >= 0) {
  for (let j = wrIdx; j < Math.min(wrIdx + 80, mainLines.length); j++) {
    console.log('  L' + (j + 1) + ': ' + mainLines[j]);
  }
}