#!/usr/bin/env node
// scripts/diag/find-handlers-in-ipc.cjs — Find handle calls in ipcHandlers.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\ipcHandlers.js').toString('utf8');
const lines = content.split('\n');

console.log('=== ipcHandlers.js handle() calls ===');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.handle(') || lines[i].includes('storage:') || lines[i].includes('fetch-models')) {
    console.log('L' + (i + 1) + ': ' + lines[i].trim().substring(0, 250));
    count++;
    if (count > 30) break;
  }
}

console.log('\n=== ipcHandlers.js length: ' + lines.length + ' lines ===');