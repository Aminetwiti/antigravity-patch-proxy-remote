#!/usr/bin/env node
const asar = require('@electron/asar');
const content = asar.extractFile('C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar', 'dist\\ipcHandlers.js').toString('utf8');
const lines = content.split('\n');
console.log('=== deployed ipcHandlers.js (' + lines.length + ' lines) ===');

// Look for storage: handlers + custom model handlers + proxy
for (let i = 0; i < lines.length; i++) {
  if (/ipcMain\.handle|registerIpcHandlers|storage:/.test(lines[i])) {
    console.log('  L' + (i+1) + ': ' + lines[i].trim().substring(0, 180));
  }
}

// Look for any "duplicate handler" warnings
console.log('\n=== looking for "registerIpcHandlers" function start ===');
for (let i = 0; i < lines.length; i++) {
  if (/function registerIpcHandlers|exports\.registerIpcHandlers|registerIpcHandlers\s*=/.test(lines[i])) {
    console.log('  L' + (i+1) + ': ' + lines[i]);
    for (let j = i+1; j < Math.min(i+20, lines.length); j++) {
      console.log('  L' + (j+1) + ': ' + lines[j]);
    }
  }
}

// Find all ipcMain.handle call sites
console.log('\n=== ipcMain.handle call sites (first 50) ===');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  if (/ipcMain\.handle/.test(lines[i])) {
    console.log('  L' + (i+1) + ': ' + lines[i].trim().substring(0, 150));
    if (++count >= 50) break;
  }
}