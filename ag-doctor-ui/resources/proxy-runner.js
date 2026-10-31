/**
 * Standalone proxy runner.
 * Used as a fallback if the main Antigravity app fails to launch the proxy.
 * Note: Must be run with a standard Electron or Node binary, NOT Antigravity.exe
 * (which ignores scripts passed as arguments).
 */
const path = require('path');
const fs = require('fs');

// Attempt to load the built proxy from the antigravity dist/ folder
const proxyPath = path.join(__dirname, '..', '..', 'dist', 'proxy.js');

if (!fs.existsSync(proxyPath)) {
  console.error(`[Runner] Error: proxy.js not found at ${proxyPath}`);
  console.error('[Runner] Please run "npm run build" in the root directory.');
  process.exit(1);
}

try {
  const { startProxy } = require(proxyPath);
  console.log('[Runner] Starting standalone proxy...');
  startProxy().then(port => {
    console.log(`[Runner] Standalone proxy started on port ${port}`);
  }).catch(err => {
    console.error('[Runner] Failed to start proxy:', err);
    process.exit(1);
  });
} catch (err) {
  console.error('[Runner] Failed to load proxy.js:', err);
  process.exit(1);
}
