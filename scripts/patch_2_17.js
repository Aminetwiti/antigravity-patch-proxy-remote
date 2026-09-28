#!/usr/bin/env node
/**
 * patch_2_17.js — Pure surgical patcher for Antigravity v2.17.x app.asar.
 *
 * Preserves 100% of official Google 2.17 code (WSL integration, HostBridgeServer,
 * provisionSplash, deep linking, etc.) and injects only the custom-model proxy
 * runner and UI hooks via non-destructive AST/source surgery.
 *
 * Usage:
 *   node patch_2_17.js <asar-in> <build-dir> <asar-out>
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Monkey-patch fs.readFileSync to bypass ENOENT on unpacked files missing from header
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(pathStr, options) {
  try {
    return originalReadFileSync.apply(this, arguments);
  } catch (err) {
    if (err.code === 'ENOENT' && typeof pathStr === 'string' && pathStr.includes('.unpacked')) {
      return Buffer.alloc(0);
    }
    throw err;
  }
};

const asar = require('@electron/asar');

const [, , asarIn, buildDir, asarOut] = process.argv;
if (!asarIn || !buildDir || !asarOut) {
  console.error('usage: node patch_2_17.js <asar-in> <build-dir> <asar-out>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const repoDist = path.join(repoRoot, 'dist');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dst);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

async function main() {
  console.log(`[patch_2_17] Surgical patch for Antigravity 2.17.x`);
  console.log(`  in:  ${asarIn}`);
  console.log(`  out: ${asarOut}`);

  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  ensureDir(buildDir);

  // 1. Extract official asar
  console.log('[patch_2_17] Step 1: Extracting official asar...');
  asar.extractAll(asarIn, buildDir);

  // 2. Inject missing custom proxy & service modules
  console.log('[patch_2_17] Step 2: Injecting proxy & custom modules...');
  const modulesToCopy = [
    'proxy',
    'services',
    'shared',
    'i18n',
    'wellKnown',
    'presets',
    'cryptoStore.js',
    'customModelStore.js',
    'schemaValidator.js',
    'logger.js',
    'configExchange.js',
    'metrics.js',
    'rendererHook.js',
    'customIpcBridge.js',
  ];

  for (const mod of modulesToCopy) {
    const src = path.join(repoDist, mod);
    const dst = path.join(buildDir, 'dist', mod);
    copyRecursive(src, dst);
  }

  // Copy our repo's ipcHandlers as customIpcHandlers so customIpcBridge can use it
  const repoIpcHandlers = path.join(repoDist, 'ipcHandlers.js');
  if (fs.existsSync(repoIpcHandlers)) {
    fs.copyFileSync(repoIpcHandlers, path.join(buildDir, 'dist', 'customIpcHandlers.js'));
  }

  // Copy root runner & constants
  fs.copyFileSync(path.join(repoRoot, 'proxy-runner.js'), path.join(buildDir, 'proxy-runner.js'));
  const rootConstants = path.join(repoDist, 'constants.js');
  if (fs.existsSync(rootConstants)) {
    fs.copyFileSync(rootConstants, path.join(buildDir, 'constants.js'));
  }

  // 3. Surgical patch of dist/main.js
  console.log('[patch_2_17] Step 3: Surgical patch of dist/main.js...');
  const mainJsPath = path.join(buildDir, 'dist', 'main.js');
  let mainJs = fs.readFileSync(mainJsPath, 'utf8');

  // Insert TLS bypass & proxy runner at top
  if (!mainJs.includes('proxy-runner')) {
    const hook = [
      '// [v2.17 patch] Local proxy runner + TLS bypass',
      "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      "try { require('../proxy-runner'); } catch (e) { console.error('[v2.17 patch] proxy-runner error:', e); }",
    ].join('\n');

    mainJs = mainJs.replace(/^"use strict";\r?\n/, `"use strict";\n${hook}\n`);
  }

  // Wrap main_1.default.initialize() in try/catch to avoid collision with electron-log
  mainJs = mainJs.replace(
    /main_1\.default\.initialize\(\);/,
    'try { main_1.default.initialize(); } catch (e) { /* electron-log already initialized */ }',
  );

  // Disable hardware acceleration to prevent black screens
  if (!mainJs.includes('disableHardwareAcceleration')) {
    mainJs = mainJs.replace(
      /const gotTheLock = electron_1\.app\.requestSingleInstanceLock\(\);/,
      [
        '// [v2.17 patch] Disable hardware acceleration (black screen fix)',
        'electron_1.app.disableHardwareAcceleration();',
        "electron_1.app.commandLine.appendSwitch('disable-gpu');",
        "electron_1.app.commandLine.appendSwitch('disable-gpu-compositing');",
        'const gotTheLock = electron_1.app.requestSingleInstanceLock();',
      ].join('\n'),
    );
  }

  // Bypass IDE wizard
  mainJs = mainJs.replace(
    /if \(!HEADLESS\) \{\s*await \(0, ideInstall_1\.maybeShowIdeInstallWizard\)\(storageManager\);\s*\}/,
    '/* [v2.17 patch] IDE wizard bypassed */\n    if (false && !HEADLESS) {\n        await (0, ideInstall_1.maybeShowIdeInstallWizard)(storageManager);\n    }',
  );

  fs.writeFileSync(mainJsPath, mainJs, 'utf8');

  // 4. Surgical patch of dist/preload.js
  console.log('[patch_2_17] Step 4: Surgical patch of dist/preload.js...');
  const preloadJsPath = path.join(buildDir, 'dist', 'preload.js');
  let preloadJs = fs.readFileSync(preloadJsPath, 'utf8');

  // Extend storageAPI with custom model methods
  const storageExtension = `
// [v2.17 patch] Extend storageAPI with Custom Model methods
if (typeof storageAPI === 'object' && storageAPI !== null) {
  Object.assign(storageAPI, {
    getCustomModels: () => electron_1.ipcRenderer.invoke('storage:get-custom-models'),
    saveCustomModel: (m) => electron_1.ipcRenderer.invoke('storage:save-custom-model', m),
    deleteCustomModel: (n) => electron_1.ipcRenderer.invoke('storage:delete-custom-model', n),
    testModelConnection: (m) => electron_1.ipcRenderer.invoke('storage:test-model-connection', m),
    fetchModels: (p) => electron_1.ipcRenderer.invoke('storage:fetch-models', p),
    getProviders: () => electron_1.ipcRenderer.invoke('storage:get-providers'),
    saveProvider: (p) => electron_1.ipcRenderer.invoke('storage:save-provider', p),
    deleteProvider: (id) => electron_1.ipcRenderer.invoke('storage:delete-provider', id),
    discoverLocalAntigravityAccount: () => electron_1.ipcRenderer.invoke('storage:discover-local-account'),
    exportProviders: () => electron_1.ipcRenderer.invoke('storage:export-providers-base64'),
    importProviders: (c) => c ? electron_1.ipcRenderer.invoke('storage:import-providers-base64', c) : electron_1.ipcRenderer.invoke('storage:import-providers'),
    getDoctorDiagnostics: () => electron_1.ipcRenderer.invoke('storage:get-doctor-diagnostics'),
    testRemoteHealth: (p) => electron_1.ipcRenderer.invoke('remote:test-health', p),
    executeRemoteCommand: (p) => electron_1.ipcRenderer.invoke('remote:execute-command', p),
    listRemoteSessions: (p) => electron_1.ipcRenderer.invoke('remote:list-sessions', p),
    createRemoteSession: (p) => electron_1.ipcRenderer.invoke('remote:create-session', p),
    getRemoteWorkspaces: (p) => electron_1.ipcRenderer.invoke('remote:get-workspaces', p),
    injectUserStatus: (b) => electron_1.ipcRenderer.invoke('proto:inject-user-status', b),
    injectAvailableModels: (b) => electron_1.ipcRenderer.invoke('proto:inject-available-models', b),
    setRemoteState: (p) => electron_1.ipcRenderer.invoke('remote:set-state', p),
    getRemoteState: () => electron_1.ipcRenderer.invoke('remote:get-state'),
  });
}
`;

  // Inject Remote Agent & Custom Models UI Hook
  const remoteHookInjection = `
// [v2.17 patch] Remote Agent & Custom Models UI Hook
try {
  const _fs = require('fs');
  const _path = require('path');
  const _hookPath = _path.join(__dirname, 'rendererHook.js');
  if (_fs.existsSync(_hookPath)) {
    const _hookScript = _fs.readFileSync(_hookPath, 'utf8');
    electron_1.webFrame.executeJavaScript(_hookScript).catch(() => {});
  }
} catch (e) {
  console.warn('[v2.17 patch] Non-fatal error loading rendererHook:', e);
}
`;

  if (!preloadJs.includes('[v2.17 patch]')) {
    preloadJs += `\n${storageExtension}\n${remoteHookInjection}\n`;
    fs.writeFileSync(preloadJsPath, preloadJs, 'utf8');
  }

  // 5. Surgical patch of dist/ipcHandlers.js
  console.log('[patch_2_17] Step 5: Surgical patch of dist/ipcHandlers.js...');
  const ipcJsPath = path.join(buildDir, 'dist', 'ipcHandlers.js');
  let ipcJs = fs.readFileSync(ipcJsPath, 'utf8');

  const ipcHook = `
// [v2.17 patch] Attach custom model & remote IPC handlers
const _origOfficialRegisterIpcHandlers = exports.registerIpcHandlers;
exports.registerIpcHandlers = function(storageManager) {
  if (typeof _origOfficialRegisterIpcHandlers === 'function') {
    _origOfficialRegisterIpcHandlers(storageManager);
  }
  try {
    const customBridge = require('./customIpcBridge');
    if (customBridge && typeof customBridge.registerCustomIpcHandlers === 'function') {
      customBridge.registerCustomIpcHandlers(storageManager);
      console.log('[v2.17 patch] Custom model IPC handlers registered successfully.');
    }
  } catch (err) {
    console.error('[v2.17 patch] Failed to register custom IPC handlers:', err);
  }
};
`;

  if (!ipcJs.includes('[v2.17 patch]')) {
    ipcJs += `\n${ipcHook}\n`;
    fs.writeFileSync(ipcJsPath, ipcJs, 'utf8');
  }

  // 6. Stage unpacked files if needed
  const unpackedIn = `${asarIn}.unpacked`;
  const unpackedOut = `${asarOut}.unpacked`;
  if (fs.existsSync(unpackedIn)) {
    console.log('[patch_2_17] Syncing app.asar.unpacked...');
    copyRecursive(unpackedIn, unpackedOut);
  }

  // 7. Repack asar
  console.log('[patch_2_17] Step 6: Repacking app.asar...');
  await asar.createPackage(buildDir, asarOut);

  // Cleanup build dir
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch (_) {}

  console.log(`[patch_2_17] SUCCESS: Patched asar created at ${asarOut}`);
}

main().catch((err) => {
  console.error('[patch_2_17] FATAL:', err);
  process.exit(1);
});
