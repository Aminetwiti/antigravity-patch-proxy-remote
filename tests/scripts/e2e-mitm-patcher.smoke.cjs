// e2e-mitm-patcher.smoke.cjs — End-to-end smoke test for the MITM unpacked flow.
// NOT a Vitest test: run with `node tests/scripts/e2e-mitm-patcher.smoke.cjs`.
// Verifies the patch_2_3.js workflow:
//   1. builds a minimal asar simulating the deployed Antigravity 2.3.x shape
//   2. runs scripts/patch_2_3.js against it
//   3. asserts:
//      - the MITM files are NOT inside the asar
//      - app.asar.unpacked/mitm/ exists next to the output asar
//      - app.asar.unpacked/mitm/certs/ contains the .pem files
//      - proxy-runner.js is in the asar and contains the auto-launch code
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');
const { spawnSync } = require('child_process');

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-e2e-'));
  const srcdir = path.join(tmp, 'src');
  const asarin = path.join(tmp, 'in.asar');
  const outdir = path.join(tmp, 'out');
  const asarout = path.join(tmp, 'out.asar');

  // Build a stripped-down 2.3.x-like asar.
  fs.mkdirSync(path.join(srcdir, 'dist', 'proxy', 'translators'), { recursive: true });
  fs.writeFileSync(path.join(srcdir, 'dist', 'main.js'),
    '"use strict";\nconst e=require("electron");\napp.whenReady().then(()=>{});\n');
  fs.writeFileSync(path.join(srcdir, 'dist', 'languageServer.js'),
    'function start(){return Promise.resolve();}\nexports.start=start;\n');
  fs.writeFileSync(path.join(srcdir, 'dist', 'preload.js'), '"use strict";\n');
  fs.writeFileSync(path.join(srcdir, 'dist', 'constants.js'), 'module.exports={};\n');
  fs.writeFileSync(path.join(srcdir, 'dist', 'ipcHandlers.js'),
    'ipcMain.handle("storage:fetch-models",()=>{});\n');
  for (const mod of [
    'proxy.js', 'cryptoStore.js', 'customModelStore.js', 'schemaValidator.js',
  ]) {
    fs.writeFileSync(path.join(srcdir, 'dist', mod), 'module.exports={};\n');
  }
  for (const mod of [
    'idGenerator', 'errorClassifier', 'dnsResolver', 'jsonRepair',
    'modelLoader', 'modelUtils', 'protoInjector', 'protobuf',
    'registry', 'retryStrategy', 'shared', 'types', 'urlBuilder',
  ]) {
    fs.writeFileSync(path.join(srcdir, 'dist', 'proxy', mod + '.js'),
      'module.exports={};\n');
  }
  for (const t of ['anthropic', 'google', 'ollama', 'openai', 'utils']) {
    fs.writeFileSync(path.join(srcdir, 'dist', 'proxy', 'translators', t + '.js'),
      'module.exports={};\n');
  }
  fs.mkdirSync(outdir, { recursive: true });

  console.log('--- building input asar ---');
  await asar.createPackage(srcdir, asarin);
  console.log('  built:', asarin, fs.statSync(asarin).size, 'B');

  console.log('--- running patch_2_3 ---');
  const r = spawnSync(
    process.execPath,
    ['scripts/patch_2_3.js', asarin, outdir, asarout],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('patch_2_3 exited with', r.status);
    process.exit(1);
  }

  console.log('--- verifying output ---');
  const inv = asar.listPackage(asarout);
  const mitmInAsar = inv.filter((p) => p.toLowerCase().includes('app.asar.unpacked'));
  const proxyRunnerRaw = inv.find((p) => p.replaceAll('\\', '/').endsWith('proxy-runner.js'));
  const fails = [];
  if (mitmInAsar.length !== 0) fails.push('MITM leaked into asar: ' + mitmInAsar.join(', '));
  if (!proxyRunnerRaw) fails.push('proxy-runner.js missing from asar');
  else {
    const proxyRunnerPath = proxyRunnerRaw.replaceAll('\\', '/').replace(/^\/+/, '');
    const code = asar.extractFile(asarout, proxyRunnerPath).toString('utf8');
    if (!code.includes('spawnAntigravityMitm443')) {
      fails.push('proxy-runner.js missing spawnAntigravityMitm443');
    }
    if (!code.includes('-Verb RunAs')) {
      fails.push('proxy-runner.js missing Verb RunAs elevation');
    }
  }

  const asarSiblingDir = path.dirname(asarout);
  const unpackedRoot = path.join(asarSiblingDir, 'app.asar.unpacked');
  const unpackedMitm = path.join(unpackedRoot, 'mitm');
  const certsDir = path.join(unpackedMitm, 'certs');

  console.log('--- app.asar.unpacked structure ---');
  if (fs.existsSync(unpackedMitm)) {
    function walk(p, d) {
      fs.readdirSync(p).forEach((f) => {
        const fp = path.join(p, f);
        const stat = fs.statSync(fp);
        console.log('  ' + d + f, stat.isDirectory() ? '(dir)' : stat.size + 'B');
        if (stat.isDirectory()) walk(fp, d + '  ');
      });
    }
    walk(unpackedMitm, '  ');
  } else {
    fails.push('app.asar.unpacked/mitm/ missing next to out.asar');
  }
  for (const expected of [
    path.join(unpackedMitm, 'mitm_443.js'),
    path.join(unpackedMitm, 'start_mitm_443.ps1'),
    path.join(certsDir, 'ca-cert.pem'),
    path.join(certsDir, 'server-cert.pem'),
    path.join(certsDir, 'server-key.pem'),
  ]) {
    if (!fs.existsSync(expected)) {
      fails.push('missing expected unpacked file: ' + path.relative(asarSiblingDir, expected));
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  if (fails.length > 0) {
    console.error('--- E2E FAILED ---');
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('--- E2E PASSED ---');
  console.log('  asar does not contain MITM files');
  console.log('  app.asar.unpacked/mitm/{mitm_443.js, start_mitm_443.ps1, certs/*} present');
  console.log('  proxy-runner.js contains the spawnAntigravityMitm443 launcher with Verb RunAs elevation');
})();
