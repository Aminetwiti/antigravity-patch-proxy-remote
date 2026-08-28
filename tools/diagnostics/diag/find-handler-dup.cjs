#!/usr/bin/env node
// scripts/diag/find-handler-dup.cjs — Find all 'storage:fetch-models' registrations
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

console.log('=== Files containing "storage:fetch-models" ===');
for (const f of list) {
  if (!f.endsWith('.js')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (content.includes('storage:fetch-models')) {
      console.log('  ' + f);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('storage:fetch-models')) {
          console.log('    L' + (i + 1) + ': ' + lines[i].trim().substring(0, 200));
        }
      }
    }
  } catch (e) {}
}