#!/usr/bin/env node
// scripts/diag/test-dedup-regex.cjs — Test the dedup regex
const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ipcHandlers.js').toString('utf8');

// Save a copy for testing
fs.writeFileSync('./test-ipcHandlers.js', content);

// Try various regex patterns
const patterns = [
  /electron_1\.ipcMain\.handle\('storage:fetch-models'[\s\S]*?\}\);/gm,
  /ipcMain\.handle\('storage:fetch-models'[\s\S]*?\}\);/gm,
  /ipcMain\.handle\("storage:fetch-models"[\s\S]*?\}\);/gm,
];

console.log('=== Testing regex patterns ===');
for (let i = 0; i < patterns.length; i++) {
  const matches = content.match(patterns[i]);
  console.log('Pattern ' + i + ': ' + matches.length + ' matches');
  if (matches && matches.length > 0) {
    matches.forEach((m, j) => console.log('  match ' + j + ': ' + m.substring(0, 100) + '...'));
  }
}

// Try simpler
console.log('\n=== Count fetch-models occurrences ===');
const simpleRe = /storage:fetch-models/g;
let count = 0;
let m;
while ((m = simpleRe.exec(content)) !== null) count++;
console.log('  Total occurrences:', count);

// Try counting ipcMain.handle('storage:fetch-models')
const handleRe = /ipcMain\.handle\(['"]storage:fetch-models['"]/g;
let handleCount = 0;
while ((m = handleRe.exec(content)) !== null) handleCount++;
console.log('  ipcMain.handle calls:', handleCount);