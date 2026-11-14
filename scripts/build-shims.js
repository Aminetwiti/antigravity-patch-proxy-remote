/**
 * Generates backward-compatible root facades in dist/ for legacy patchers & tests.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');

const shims = {
  'ipcHandlers.js': "module.exports = require('./ipc/index');\n",
  'cryptoStore.js': "module.exports = require('./services/security/cryptoStore');\n",
  'customModelStore.js': "module.exports = require('./services/storage/modelStore');\n",
  'configExchange.js': "module.exports = require('./services/security/configExchange');\n",
  'presets.js': "module.exports = require('./compat/presets');\n",
  'storage.js': "module.exports = require('./compat/storage');\n",
  'updater.js': "module.exports = require('./compat/updater');\n",
  'schemaValidator.js': "module.exports = require('./shared/schemaValidator');\n",
  'paths.js': "module.exports = require('./shared/paths');\n",
  'metrics.js': "module.exports = require('./shared/metrics');\n",
  'customScheme.js': "module.exports = require('./shared/customScheme');\n",
  'utils.js': "module.exports = require('./shared/utils');\n",
  'logger.js': "const log = require('electron-log'); module.exports = log.default || log;\n",
  'loadingOverlay.js': "module.exports = require('./ui/loadingOverlay');\n",
  'keybindings.js': "module.exports = require('./ui/keybindings');\n",
  'menu.js': "module.exports = require('./ui/menu');\n",
  'tray.js': "module.exports = require('./ui/tray');\n",
  'services/settingsService.js': "module.exports = require('./storage/settingsService');\n"
};

for (const [relPath, content] of Object.entries(shims)) {
  const target = path.join(distDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

console.log('✓ Root backward-compatibility shims generated');
