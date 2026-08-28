#!/usr/bin/env node
// scripts/diag/find-ipc-handlers.cjs — Find all ipcMain.handle calls
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

console.log('=== Files containing ipcMain.handle ===');
for (const f of list) {
  if (!f.endsWith('.js')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (content.includes('ipcMain.handle') || content.includes('ipcMain_1.handle')) {
      console.log('  ' + f);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('handle(') && (lines[i].includes('ipcMain') || lines[i].includes('storage') || lines[i].includes('custom'))) {
          console.log('    L' + (i + 1) + ': ' + lines[i].trim().substring(0, 200));
        }
      }
    }
  } catch (e) {}
}