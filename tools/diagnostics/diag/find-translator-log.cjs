#!/usr/bin/env node
// scripts/diag/find-translator-log.cjs — Find where "TranslatorRegistry" log comes from
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

console.log('=== Files containing "TranslatorRegistry" ===');
for (const f of list) {
  if (!f.endsWith('.js')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (content.includes('TranslatorRegistry')) {
      // Find context
      const idx = content.indexOf('TranslatorRegistry');
      const ctx = content.substring(Math.max(0, idx - 100), idx + 200).replace(/\n/g, ' | ');
      console.log('  ' + f);
      console.log('    ' + ctx.substring(0, 250));
    }
  } catch (e) {}
}

// Also search for the actual log string
console.log('\n=== Files containing "[TranslatorRegistry]" ===');
for (const f of list) {
  if (!f.endsWith('.js')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (content.includes('[TranslatorRegistry]')) {
      console.log('  ' + f);
    }
  } catch (e) {}
}

// Check proxy-runner.js too
console.log('\n=== proxy-runner.js content ===');
try {
  const pr = asar.extractFile(asarPath, '\\proxy-runner.js').toString('utf8');
  console.log(pr);
} catch (e) {
  console.log('  cannot extract proxy-runner.js:', e.message);
}