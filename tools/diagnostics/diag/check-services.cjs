#!/usr/bin/env node
// scripts/diag/check-services.cjs — Verify services + ideInstall exist in deployed asar
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

const checks = [
  'dist\\services\\settingsService.js',
  'dist\\ideInstall\\index.js',
  'dist\\ideInstall\\wizard.js',
  'dist\\ideInstall\\constants.js',
  'dist\\ideInstall\\service.js',
  'dist\\ideInstall\\wizardHtml.js',
  'dist\\ideInstall\\wizardPreload.js',
  'dist\\paths.js',
  'dist\\storage.js',
  'dist\\customScheme.js',
  'dist\\tray.js',
  'dist\\menu.js',
  'dist\\updater.js',
  'dist\\utils.js',
];
console.log('=== Service/ideInstall paths check (with forward slashes) ===');
for (const c of checks) {
  const c2 = c.replace(/\\\\/g, '/');
  const found = list.includes(c2) || list.includes(c);
  console.log('  ' + (found ? '[OK]   ' : '[MISS] ') + c);
}

// Also dump all entries with 'service' or 'ideInstall'
console.log('\n=== Entries with "service" or "ideInstall" ===');
list.filter(e => /service|ideInstall/i.test(e)).forEach(e => console.log('  ' + e));

// Also check our REPO dist has them
const fs = require('fs');
console.log('\n=== REPO dist/ ===');
for (const c of checks) {
  const local = './' + c.replace(/\\\\/g, '/');
  const exists = fs.existsSync(local);
  console.log('  ' + (exists ? '[OK]   ' : '[MISS] ') + local);
}