#!/usr/bin/env node
// scripts/diag/list-aser-proxy.cjs
// Lists all files in app.asar under dist/proxy/* and shows what the
// deployed preload.js requires.

const asar = require('@electron/asar');
const fs = require('fs');

const ASAR = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar';

console.log('=== listing all dist/proxy/* files in asar ===');
const proxyFiles = asar.listPackage(ASAR).filter((p) => p.toLowerCase().startsWith('dist/proxy/'));
proxyFiles.sort();
for (const p of proxyFiles) console.log(p);

console.log('\n=== dist/proxy requires (extracted from deployed preload.js) ===');
const preloadBuf = asar.extractFile(ASAR, 'dist/preload.js');
const preloadSrc = preloadBuf.toString('utf8');
const reqLines = preloadSrc.split('\n').filter((l) => l.includes('require("./proxy/') || l.includes("require('./proxy/"));
for (const l of reqLines) console.log(l.trim());

console.log('\n=== other top-level dist files (cryptoStore, customModelStore, schemaValidator) ===');
const topFiles = asar.listPackage(ASAR).filter((p) => /^(dist\/(cryptoStore|customModelStore|schemaValidator)\.js|proxy-runner\.js)$/i.test(p));
for (const p of topFiles) console.log(p);
console.log('top-level proxy-runner.js present:', topFiles.some((p) => /proxy-runner/i.test(p)));
console.log('cryptoStore.js present:', topFiles.some((p) => /cryptoStore\.js$/i.test(p)));
console.log('customModelStore.js present:', topFiles.some((p) => /customModelStore\.js$/i.test(p)));
console.log('schemaValidator.js present:', topFiles.some((p) => /schemaValidator\.js$/i.test(p)));