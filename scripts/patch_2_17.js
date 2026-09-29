#!/usr/bin/env node
/**
 * patch_2_17.js — Pure surgical patcher for Antigravity v2.17.x app.asar.
 *
 * Preserves 100% of official Google 2.17 code (WSL integration, HostBridgeServer,
 * provisionSplash, deep linking, settingsService, etc.) and injects the custom-model
 * proxy runner, UI hooks, and ConnectRPC fetch interceptors via non-destructive surgery.
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

  if (!fs.existsSync(path.join(repoDist, 'proxy.js')) || !fs.existsSync(path.join(repoDist, 'config', 'providers.json'))) {
    console.log('[patch_2_17] Building dist/ modules...');
    const { execSync } = require('child_process');
    execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });
  }

  // 1. Extract official asar
  console.log('[patch_2_17] Step 1: Extracting official asar...');
  asar.extractAll(asarIn, buildDir);

  // Backup official settingsService so custom services don't overwrite it
  const officialSettingsServicePath = path.join(buildDir, 'dist', 'services', 'settingsService.js');
  let officialSettingsService = null;
  if (fs.existsSync(officialSettingsServicePath)) {
    officialSettingsService = fs.readFileSync(officialSettingsServicePath, 'utf8');
  }

  // 2. Inject missing custom proxy & service modules
  console.log('[patch_2_17] Step 2: Injecting proxy & custom modules...');

  // Directories to copy into dist/
  const dirsToCopy = [
    'proxy',
    'presets',
    'config',
    'services',
    'shared',
    'i18n',
    'wellKnown',
    'ipc',
    'preload',
  ];

  for (const dir of dirsToCopy) {
    const src = path.join(repoDist, dir);
    const dst = path.join(buildDir, 'dist', dir);
    if (fs.existsSync(src)) {
      copyRecursive(src, dst);
    }
  }

  // Ensure providers.json is present in dist/config and config
  const providersSrc = fs.existsSync(path.join(repoDist, 'config', 'providers.json'))
    ? path.join(repoDist, 'config', 'providers.json')
    : path.join(repoRoot, 'src', 'config', 'providers.json');
  if (fs.existsSync(providersSrc)) {
    ensureDir(path.join(buildDir, 'dist', 'config'));
    fs.copyFileSync(providersSrc, path.join(buildDir, 'dist', 'config', 'providers.json'));
    ensureDir(path.join(buildDir, 'config'));
    fs.copyFileSync(providersSrc, path.join(buildDir, 'config', 'providers.json'));
  }

  // Individual files to copy into dist/
  const filesToCopy = [
    'proxy.js',
    'presets.js',
    'constants.js',
    'cryptoStore.js',
    'customModelStore.js',
    'schemaValidator.js',
    'logger.js',
    'configExchange.js',
    'metrics.js',
    'rendererHook.js',
    'customIpcBridge.js',
  ];

  for (const file of filesToCopy) {
    const src = path.join(repoDist, file);
    const dst = path.join(buildDir, 'dist', file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }

  // Restore official settingsService
  if (officialSettingsService) {
    fs.writeFileSync(officialSettingsServicePath, officialSettingsService, 'utf8');
    console.log('[patch_2_17] Restored official 2.17 settingsService.js');
  }

  // Copy our repo's ipcHandlers as customIpcHandlers so customIpcBridge can use it
  const repoIpcHandlers = path.join(repoDist, 'ipcHandlers.js');
  if (fs.existsSync(repoIpcHandlers)) {
    fs.copyFileSync(repoIpcHandlers, path.join(buildDir, 'dist', 'customIpcHandlers.js'));
  }

  // Copy root runner & root constants
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

  fs.writeFileSync(mainJsPath, mainJs, 'utf8');

  // 3b. Surgical patch of dist/languageServer.js
  console.log('[patch_2_17] Step 3b: Surgical patch of dist/languageServer.js...');
  const lsJsPath = path.join(buildDir, 'dist', 'languageServer.js');
  if (fs.existsSync(lsJsPath)) {
    let lsJs = fs.readFileSync(lsJsPath, 'utf8');
    lsJs = lsJs.replace(
      /'https:\/\/daily-cloudcode-pa\.googleapis\.com'/,
      "process.env.AG_CLOUD_CODE_ENDPOINT || ('http://' + (process.env.AG_BIND_HOST || '127.0.0.1') + ':' + (process.env.AG_PROXY_PORT || '51074'))"
    );
    lsJs = lsJs.replace(
      /'https:\/\/generativelanguage\.googleapis\.com'/,
      "process.env.AG_API_SERVER_URL || ('http://' + (process.env.AG_BIND_HOST || '127.0.0.1') + ':' + (process.env.AG_PROXY_PORT || '51074'))"
    );
    fs.writeFileSync(lsJsPath, lsJs, 'utf8');
  }

  // 4. Surgical patch of dist/preload.js
  console.log('[patch_2_17] Step 4: Surgical patch of dist/preload.js...');
  const preloadJsPath = path.join(buildDir, 'dist', 'preload.js');
  let preloadJs = fs.readFileSync(preloadJsPath, 'utf8');

  // Extend storageAPI with custom model methods before it gets exposed by contextBridge
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

  // Fetch interceptor & UI hook
  const fetchInterceptorScript = `
// [v2.17 patch] Intercept GetUserStatus, GetAvailableModels, and RunCommand in renderer
try {
  electron_1.webFrame.executeJavaScript(\`
    (function() {
      if (window.__ag_fetch_hooked) return;
      window.__ag_fetch_hooked = true;
      const origFetch = window.fetch;

      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
        const isUserStatus = typeof url === 'string' && url.includes('LanguageServerService/GetUserStatus');
        const isAvailableModels = typeof url === 'string' && url.includes('LanguageServerService/GetAvailableModels');

        if (!isUserStatus && !isAvailableModels) {
          return origFetch.apply(this, args);
        }

        try {
          const response = await origFetch.apply(this, args);
          if (!response.ok) return response;
          const rawBuf = await response.arrayBuffer();
          let modifiedBytes = null;
          if (isUserStatus && window.nativeStorage && window.nativeStorage.injectUserStatus) {
            try {
              modifiedBytes = await window.nativeStorage.injectUserStatus(new Uint8Array(rawBuf));
            } catch (e) {
              console.warn('[AG] injectUserStatus IPC error:', e);
              modifiedBytes = null;
            }
          } else if (isAvailableModels && window.nativeStorage && window.nativeStorage.injectAvailableModels) {
            try {
              modifiedBytes = await window.nativeStorage.injectAvailableModels(new Uint8Array(rawBuf));
            } catch (e) {
              console.warn('[AG] injectAvailableModels IPC error:', e);
              modifiedBytes = null;
            }
          }
          if (modifiedBytes && modifiedBytes.length > 0) {
            const headers = new Headers(response.headers);
            headers.set('content-length', String(modifiedBytes.length));
            return new Response(modifiedBytes, {
              status: response.status,
              statusText: response.statusText,
              headers: headers,
            });
          }
          return new Response(rawBuf, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (err) {
          console.error('[AG] Fetch interceptor error:', err);
          return origFetch.apply(this, args);
        }
      };
    })();
  \`);
} catch (e) {
  console.warn('[v2.17 patch] Error installing fetch interceptor:', e);
}

// [v2.17 patch] Remote Agent & Custom Models UI Hook
try {
  electron_1.ipcRenderer.invoke('ag:get-renderer-hook').then(function(hookScript) {
    if (hookScript) {
      electron_1.webFrame.executeJavaScript(hookScript).catch(function() {});
    }
  }).catch(function() {});
} catch (e) {
  console.warn('[v2.17 patch] Non-fatal error requesting rendererHook:', e);
}
`;

  if (!preloadJs.includes('[v2.17 patch]')) {
    // Insert storageExtension right after storageAPI declaration
    const storageApiAnchor = 'const storageAPI = {';
    if (preloadJs.includes(storageApiAnchor)) {
      preloadJs = preloadJs.replace(
        /const storageAPI = \{[\s\S]*?\n\};/,
        (match) => `${match}\n${storageExtension}`,
      );
    } else {
      preloadJs += `\n${storageExtension}\n`;
    }
    preloadJs += `\n${fetchInterceptorScript}\n`;
    fs.writeFileSync(preloadJsPath, preloadJs, 'utf8');
  }

  // 5. Surgical patch of dist/ipcHandlers.js
  console.log('[patch_2_17] Step 5: Surgical patch of dist/ipcHandlers.js...');
  const ipcJsPath = path.join(buildDir, 'dist', 'ipcHandlers.js');
  let ipcJs = fs.readFileSync(ipcJsPath, 'utf8');

  // Strip any previous patch block so re-running patch_2_17 never nests wrappers
  const patchMarkerIndex = ipcJs.indexOf('// [v2.17 patch]');
  if (patchMarkerIndex !== -1) {
    ipcJs = ipcJs.substring(0, patchMarkerIndex).trimEnd() + '\n';
  }

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

  ipcJs += `\n${ipcHook}\n`;
  fs.writeFileSync(ipcJsPath, ipcJs, 'utf8');

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

  // 8. Clean up build directory
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } catch (_) {}

  console.log(`[patch_2_17] Patch applied successfully to: ${asarOut}`);
}

main().catch((err) => {
  console.error('[patch_2_17] Fatal error:', err);
  process.exit(1);
});
