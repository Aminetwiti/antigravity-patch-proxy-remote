const a = require('@electron/asar');
const path = require('path');
const userProfile = process.env.USERPROFILE || process.env.HOME || '';
const defaultSrc = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local'), 'Programs', 'Antigravity', 'resources', 'app.asar')
  : `/mnt/c/Users/${process.env.USER || 'user'}/AppData/Local/Programs/Antigravity/resources/app.asar`;
const src = process.env.AG_ASAR_PATH || defaultSrc;
const dest = '/tmp/asar_inspect/current';
require('fs').rmSync(dest, { recursive: true, force: true });
require('fs').mkdirSync(dest, { recursive: true });
const files = a.extractAll(src, dest);
console.log('Extracted', files.length, 'files to', dest);
console.log('Version:', require(dest + '/package.json').version);
