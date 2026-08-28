#!/usr/bin/env node
// scripts/diag/test-startproxy.cjs — Manually invoke startProxy() to see error
// We can't load proxy.js directly because it needs electron app context.
// Instead, let's inspect what gets called at runtime by injecting logging.

const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';

// 1. Verify languageServer.js's startLanguageServer function structure
const lsContent = asar.extractFile(asarPath, 'dist\\languageServer.js').toString('utf8');
const lsLines = lsContent.split('\n');

// Find startLanguageServer and dump the FULL function
console.log('=== startLanguageServer full function ===');
let idx = -1;
for (let i = 0; i < lsLines.length; i++) {
  if (lsLines[i].includes('function startLanguageServer(')) { idx = i; break; }
}
if (idx >= 0) {
  // Show next 60 lines
  for (let i = idx; i < Math.min(idx + 60, lsLines.length); i++) {
    console.log('  L' + (i + 1) + ': ' + lsLines[i]);
  }
}

// 2. Find ALL powerSaveBlocker calls in languageServer.js
console.log('\n=== All powerSaveBlocker in languageServer.js ===');
for (let i = 0; i < lsLines.length; i++) {
  if (/powerSave/i.test(lsLines[i])) {
    console.log('  L' + (i + 1) + ': ' + lsLines[i]);
  }
}

// 3. Also check if whenReady is reached — find functions that log early
console.log('\n=== Lines around powerSaveBlocker context ===');
const psIdx = lsContent.indexOf('powerSaveBlocker');
if (psIdx >= 0) {
  console.log('powerSaveBlocker NOT found in languageServer.js either');
} else {
  console.log('No powerSaveBlocker in languageServer.js');
}