const path = require('path');
const fs = require('fs');

// Prefer the freshly built proxy in this repo's dist/ — the copy bundled
// inside a (possibly stale/legacy) app.asar is only a fallback.
let proxyPath = path.resolve(__dirname, '..', '..', '..', 'dist', 'proxy.js');

if (!fs.existsSync(proxyPath)) {
  proxyPath = path.join(__dirname, 'proxy.js');
}

if (!fs.existsSync(proxyPath) && process.env.LOCALAPPDATA) {
  proxyPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar', 'dist', 'proxy.js');
}

if (!fs.existsSync(proxyPath)) {
  console.error(`[StandaloneProxy] Could not find proxy.js at ${proxyPath}`);
  process.exit(1);
}

console.log(`[StandaloneProxy] Loading proxy from ${proxyPath}`);

// Setup minimal Electron app mock if we are running in pure node
if (!process.versions.electron) {
  const os = require('os');
  const mockApp = {
    isPackaged: true,
    getVersion: () => '2.1.0',
    getPath: (name) => {
      if (name === 'userData') {
        const p = path.join(process.env.APPDATA || os.homedir(), 'Antigravity');
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        return p;
      }
      if (name === 'home') {
        return process.env.USERPROFILE || process.env.HOME || os.homedir();
      }
      if (name === 'logs') {
        const p = path.join(os.homedir(), '.gemini', 'antigravity');
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        return p;
      }
      return '';
    }
  };

  const electronMock = {
    app: mockApp,
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString()
    }
  };

  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(mod) {
    if (mod === 'electron') return electronMock;
    return originalRequire.apply(this, arguments);
  };
}

process.on('uncaughtException', (err) => {
  console.error('[StandaloneProxy] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[StandaloneProxy] Unhandled rejection:', reason);
});

function run() {
  const proxy = require(proxyPath);
  proxy.startProxy().then((port) => {
    console.log(`[StandaloneProxy] Proxy started successfully on port ${port}`);
  }).catch(err => {
    console.error('[StandaloneProxy] Failed to start proxy:', err);
    process.exit(1);
  });
}

// Under a real Electron binary (recommended: ag-doctor-ui/node_modules/electron)
// safeStorage is available, so DPAPI-encrypted API keys (`enc:`) can be
// decrypted. safeStorage requires the app to be ready first.
if (process.versions.electron) {
  try {
    const electron = require('electron');
    if (electron.app && typeof electron.app.whenReady === 'function') {
      electron.app.whenReady().then(run).catch((err) => {
        console.error('[StandaloneProxy] app.whenReady failed:', err);
        process.exit(1);
      });
      return;
    }
  } catch (e) {
    console.error('[StandaloneProxy] electron bootstrap failed:', e.message);
    if (process.env.ELECTRON_RUN_AS_NODE) {
      console.error('[StandaloneProxy] ELECTRON_RUN_AS_NODE is set — unset it and relaunch, or spawn via `ag-doctor proxy start` which clears it automatically.');
    }
    process.exit(1);
  }
}
run();
