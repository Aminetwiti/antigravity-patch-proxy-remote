#!/usr/bin/env node
// scripts/diag/dump-monitor.cjs — Dump startAndMonitorLanguageServer function
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist/languageServer.js').toString('utf8');
const lines = content.split('\n');

// Find startAndMonitorLanguageServer function and its context
const startIdx = content.indexOf('startAndMonitorLanguageServer');
console.log('=== Around startAndMonitorLanguageServer (first 30 lines) ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function startAndMonitorLanguageServer') || lines[i].includes('startAndMonitorLanguageServer =')) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
    // Show next 60 lines
    for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
      console.log('  L' + (j + 1) + ': ' + lines[j]);
    }
    break;
  }
}

// Also check the startLanguageServer invocation - is it gated by something?
console.log('\n=== Around startLanguageServer call sites ===');
let idx = 0;
while ((idx = content.indexOf('startLanguageServer(', idx + 1)) >= 0) {
  console.log('  pos ' + idx + ': ...' + content.substring(Math.max(0, idx - 100), idx + 200).replace(/\n/g, ' | '));
}