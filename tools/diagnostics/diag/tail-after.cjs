#!/usr/bin/env node
// scripts/diag/tail-after.cjs — Show log lines after TranslatorRegistry load
const fs = require('fs');
const path = require('path');
const os = require('os');

const mainLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
const content = fs.readFileSync(mainLog, 'utf8');
const lines = content.split('\n');

// Find all TranslatorRegistry timestamps
const registryLines = lines.filter(l => /TranslatorRegistry.*loaded|Loaded custom models/.test(l));
console.log('=== TranslatorRegistry / Loaded custom models lines ===');
registryLines.forEach(l => console.log('  ' + l));

// Show what's after the LAST TranslatorRegistry line
const lastIdx = lines.findIndex(l => /TranslatorRegistry.*loaded/.test(l));
if (lastIdx >= 0) {
  console.log('\n=== Last 30 lines after LAST TranslatorRegistry ===');
  for (let i = lastIdx; i < Math.min(lastIdx + 30, lines.length); i++) {
    console.log('  ' + lines[i]);
  }
}

console.log('\n=== Lines mentioning Custom Models ===');
const customLines = lines.filter(l => /custom|crypto|patch|proxy|module/i.test(l));
customLines.slice(-20).forEach(l => console.log('  ' + l));