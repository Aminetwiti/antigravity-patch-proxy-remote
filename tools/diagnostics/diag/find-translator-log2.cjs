#!/usr/bin/env node
// scripts/diag/find-translator-log2.cjs — Try multiple path formats
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

// Try multiple path formats for extractFile
const candidates = [
  '\\proxy-runner.js',
  '/proxy-runner.js',
  'proxy-runner.js',
];

for (const c of candidates) {
  try {
    const content = asar.extractFile(asarPath, c).toString('utf8');
    console.log('  EXTRACT OK with: "' + c + '" (' + content.length + ' B)');
    console.log('  --- content ---');
    console.log(content);
    console.log('  --- end ---');
    break;
  } catch (e) {
    console.log('  FAIL "' + c + '": ' + e.message);
  }
}

// Use listPackage and try to extract from there
console.log('\n=== Direct extraction by index ===');
const prEntry = list.find(e => e === '\\proxy-runner.js');
console.log('  entry:', JSON.stringify(prEntry));
if (prEntry) {
  try {
    const content = asar.extractFile(asarPath, prEntry).toString('utf8');
    console.log('  extracted:', content.length, 'B');
    console.log('  --- content ---');
    console.log(content);
  } catch (e) { console.log('  extract fail:', e.message); }
}

// Search for TranslatorRegistry across all .js files
console.log('\n=== Search TranslatorRegistry ===');
for (const f of list) {
  if (!f.endsWith('.js')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (content.includes('TranslatorRegistry') || content.includes('Loaded provider translator')) {
      console.log('  HIT: ' + f);
      const idx = content.indexOf('TranslatorRegistry') >= 0 ? content.indexOf('TranslatorRegistry') : content.indexOf('Loaded provider translator');
      console.log('  ctx: ' + content.substring(Math.max(0, idx - 50), idx + 200).replace(/\n/g, ' | ').substring(0, 300));
    }
  } catch (e) {}
}