#!/usr/bin/env node
const asar = require('@electron/asar');
const content = asar.extractFile('C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar', 'dist\\preload.js').toString('utf8');
const lines = content.split('\n');
console.log('=== deployed preload.js (' + lines.length + ' lines) ===');
console.log('=== first 60 lines ===');
lines.slice(0, 60).forEach((l, i) => console.log('  L' + (i+1) + ': ' + l));
console.log('\n=== look for "contextBridge", "exposeInMainWorld", "ipcRenderer" ===');
for (let i = 0; i < lines.length; i++) {
  if (/contextBridge|exposeInMainWorld|ipcRenderer|customModels|proxy/i.test(lines[i])) {
    console.log('  L' + (i+1) + ': ' + lines[i].substring(0, 200));
  }
}