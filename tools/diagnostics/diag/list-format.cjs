#!/usr/bin/env node
// scripts/diag/list-format.cjs — Check asar list format
const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);
console.log('Total entries:', list.length);

// Show format
console.log('\n=== First 20 entries (format check) ===');
list.slice(0, 20).forEach(e => console.log('  "' + e + '"'));

// Check key files with various formats
console.log('\n=== Check key files (with / prefix) ===');
const keys = ['proxy-runner.js', '/proxy-runner.js', 'dist/proxy.js', '/dist/proxy.js', 'dist/proxy/registry.js', '/dist/proxy/registry.js'];
for (const k of keys) {
  const found = list.includes(k);
  console.log('  ' + (found ? '[OK]   ' : '[MISS] ') + k);
}

// Use a function that handles both formats
function findKey(list, key) {
  return list.some(e => e === key || e === '/' + key || e.endsWith('/' + key));
}

console.log('\n=== With flexible matching ===');
const checks = ['proxy-runner.js', 'dist/proxy.js', 'dist/proxy/registry.js', 'dist/proxy/modelLoader.js', 'dist/languageServer.js', 'dist/main.js', 'dist/preload.js', 'dist/constants.js', 'dist/cryptoStore.js', 'dist/customModelStore.js', 'dist/schemaValidator.js'];
for (const k of checks) {
  console.log('  ' + (findKey(list, k) ? '[OK]   ' : '[MISS] ') + k);
}

// Filter to entries with proxy or custom
console.log('\n=== Entries containing "proxy" or "custom" ===');
list.filter(e => /proxy|cryptoStore|customModel|schemaValidator/.test(e)).forEach(e => console.log('  ' + e));