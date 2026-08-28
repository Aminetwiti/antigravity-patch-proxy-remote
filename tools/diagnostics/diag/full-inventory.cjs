#!/usr/bin/env node
// scripts/diag/full-inventory.cjs — Full inventory of what needs to be patched
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/amine/AppData/Local/Temp/antigravity-2.3-extract';
const repoRoot = path.resolve(__dirname, '..', '..');
const repoDist = path.join(repoRoot, 'dist');

console.log('=== STEP 1: List ALL files in repo dist/ (to inject) ===');
function listAll(dir, prefix='') {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) out.push(...listAll(path.join(dir, f.name), prefix + f.name + '/'));
    else if (f.name.endsWith('.js') && !f.name.endsWith('.test.js') && !f.name.endsWith('.d.ts')) {
      out.push({ path: prefix + f.name, full: path.join(dir, f.name), size: fs.statSync(path.join(dir, f.name)).size });
    }
  }
  return out;
}
const repoFiles = listAll(repoDist);
let totalRepo = 0;
console.log('  Total JS files in repo:', repoFiles.length);
repoFiles.forEach(f => { totalRepo += f.size; console.log('    ' + f.path.padEnd(40) + ' ' + f.size + ' B'); });
console.log('  TOTAL: ' + totalRepo + ' B');

console.log('\n=== STEP 2: Check root-level files in repo (proxy-runner.js etc) ===');
const rootFiles = ['proxy-runner.js', 'proxy-runner.cjs', 'proxy-runner.mjs'];
for (const f of rootFiles) {
  const p = path.join(repoRoot, f);
  if (fs.existsSync(p)) console.log('  ✓ ' + f + ' EXISTS at root (' + fs.statSync(p).size + ' B)');
  else console.log('  ✗ ' + f + ' MISSING from repo root');
}
// Look in archive or any other location
const altLocations = ['ag-doctor-ui/resources', 'archive'];
for (const loc of altLocations) {
  const fullLoc = path.join(repoRoot, loc);
  if (!fs.existsSync(fullLoc)) continue;
  const find = (dir) => {
    if (!fs.existsSync(dir)) return [];
    let r = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) r = r.concat(find(p));
      else if (/proxy-runner/.test(f.name)) r.push(p);
    }
    return r;
  };
  const found = find(fullLoc);
  if (found.length) found.forEach(f => console.log('  ✓ Found at: ' + f));
}

console.log('\n=== STEP 3: Check repo for the wrapper-original main.js (with proxy-runner) ===');
const repoMain = fs.readFileSync(path.join(repoDist, 'main.js'), 'utf8');
const proxyRunnerIdx = repoMain.indexOf('proxy-runner');
console.log('  repo main.js mentions "proxy-runner":', proxyRunnerIdx >= 0);
if (proxyRunnerIdx >= 0) {
  const lines = repoMain.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/proxy-runner|50999|TLS bypass|startProxy|app\.commandLine|certificateError/i.test(lines[i])) {
      console.log('    L' + (i+1) + ': ' + lines[i].trim().substring(0, 100));
    }
  }
}

console.log('\n=== STEP 4: Verify deployed main.js does NOT have proxy hooks ===');
const deployedMain = fs.readFileSync(path.join(base, 'dist', 'main.js'), 'utf8');
console.log('  proxy-runner mentions:', (deployedMain.match(/proxy-runner/g) || []).length);
console.log('  50999 mentions:', (deployedMain.match(/50999/g) || []).length);
console.log('  startProxy mentions:', (deployedMain.match(/startProxy/g) || []).length);

console.log('\n=== STEP 5: Verify languageServer.js startProxy call in repo ===');
const repoLS = fs.readFileSync(path.join(repoDist, 'languageServer.js'), 'utf8');
console.log('  startProxy call in repo LS:', repoLS.includes('startProxy'));
const proxyPortIdx = repoLS.indexOf('proxyPort = await');
if (proxyPortIdx >= 0) {
  console.log('  Context around startProxy:');
  console.log(repoLS.split('\n').slice(Math.max(0, repoLS.substring(0, proxyPortIdx).split('\n').length - 3), repoLS.substring(0, proxyPortIdx).split('\n').length + 5).map((l, i) => '    ' + l).join('\n'));
}

console.log('\n=== STEP 6: Check vendor dir for upstream patches ===');
const vendorDir = path.join(repoRoot, 'vendors', 'antigravity-proxy-main', 'antigravity-proxy-main');
if (fs.existsSync(vendorDir)) {
  const vFiles = listAll(vendorDir);
  console.log('  Vendored files:', vFiles.length);
  vFiles.slice(0, 30).forEach(f => console.log('    ' + f.path));
}