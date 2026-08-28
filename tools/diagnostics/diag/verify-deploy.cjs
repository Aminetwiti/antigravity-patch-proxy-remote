#!/usr/bin/env node
// scripts/diag/verify-deploy.cjs — Verify what was actually deployed
const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);
console.log('=== Key files in deployed asar ===');
const keys = ['proxy-runner.js', 'dist/proxy.js', 'dist/proxy/registry.js', 'dist/proxy/modelLoader.js', 'dist/languageServer.js', 'dist/main.js', 'dist/preload.js', 'dist/constants.js', 'dist/ipcHandlers.js', 'dist/cryptoStore.js', 'dist/customModelStore.js', 'dist/schemaValidator.js'];
for (const k of keys) {
  const exists = list.includes(k);
  console.log('  ' + (exists ? '[OK]   ' : '[MISS] ') + k);
}

// Read languageServer.js from the deployed asar to check for our patch
console.log('\n=== Check deployed languageServer.js for proxy hooks ===');
const lsContent = asar.extractFile(asarPath, 'dist/languageServer.js').toString('utf8');
const hasStartProxy = lsContent.includes('startProxy');
const hasProxyImport = /require\(['"]\.\/proxy['"]\)|from\s+['"]\.\/proxy['"]/.test(lsContent);
const hasProxyRunner = lsContent.includes('proxy-runner');
const hasPort = lsContent.includes('50999');
console.log('  has startProxy():', hasStartProxy);
console.log('  has proxy import:', hasProxyImport);
console.log('  has proxy-runner ref:', hasProxyRunner);
console.log('  has port 50999:', hasPort);

if (hasStartProxy) {
  // Find context around startProxy
  const idx = lsContent.indexOf('startProxy');
  console.log('  context:', lsContent.substring(Math.max(0, idx - 100), idx + 200).replace(/\n/g, ' | '));
}

console.log('\n=== Check deployed main.js for proxy hooks ===');
const mainContent = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
console.log('  has proxy-runner:', mainContent.includes('proxy-runner'));
console.log('  has 50999:', mainContent.includes('50999'));
console.log('  has TLS bypass:', mainContent.includes('ignoreTLS') || mainContent.includes('certificateError') || mainContent.includes('bypassTLS'));

console.log('\n=== Check proxy-runner.js ===');
if (list.includes('proxy-runner.js')) {
  const prContent = asar.extractFile(asarPath, 'proxy-runner.js').toString('utf8');
  console.log('  size:', prContent.length);
  console.log('  first 500 chars:');
  console.log('  ' + prContent.substring(0, 500).replace(/\n/g, '\n  '));
}

console.log('\n=== Check preload.js size ===');
const preloadSize = asar.extractFile(asarPath, 'dist/preload.js').toString('utf8').length;
console.log('  deployed preload.js:', preloadSize, 'B (expected ~75 KB if patched)');

console.log('\n=== Check constants.js size ===');
const constSize = asar.extractFile(asarPath, 'dist/constants.js').toString('utf8').length;
console.log('  deployed constants.js:', constSize, 'B (expected ~9 KB if patched)');