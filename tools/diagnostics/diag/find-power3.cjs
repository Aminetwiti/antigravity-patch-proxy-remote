#!/usr/bin/env node
// scripts/diag/find-power3.cjs — Find powerSaveBlocker across all dist files
const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

const distFiles = list.filter(e => e.startsWith('\\dist\\') && e.endsWith('.js') && !e.includes('test') && !e.includes('__mocks__'));

console.log('Scanning ' + distFiles.length + ' dist files for powerSaveBlocker...');
for (const f of distFiles) {
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (/powerSaveBlocker/i.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/powerSaveBlocker/i.test(lines[i])) {
          console.log('  ' + f + ' L' + (i + 1) + ': ' + lines[i]);
        }
      }
    }
  } catch (e) {}
}

// Also search for "Power save blocker started"
console.log('\nScanning for "Power save blocker started"...');
for (const f of distFiles) {
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (/Power save blocker/i.test(content)) {
      console.log('  HIT: ' + f);
    }
  } catch (e) {}
}