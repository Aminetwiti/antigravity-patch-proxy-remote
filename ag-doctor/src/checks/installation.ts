/**
 * Installation check — finds Antigravity on disk.
 */
import fs from 'fs';
import type { CheckResult } from '../types';
import { findAntigravityInstallDir, getLanguageServerBinary } from '../core/paths';

export function checkInstallation(): CheckResult {
  const dir = findAntigravityInstallDir();
  if (!dir) {
    return {
      id: 'install',
      title: 'Antigravity installation',
      status: 'error',
      message: 'Antigravity not found in standard locations',
      details:
        'Searched: %LOCALAPPDATA%\\Programs\\antigravity, /Applications/Antigravity.app, ~/.local/share/Programs/antigravity, /opt/antigravity, /usr/lib/antigravity',
      fixable: false,
    };
  }
  const binary = getLanguageServerBinary(dir);
  if (!binary || !fs.existsSync(binary)) {
    return {
      id: 'install.binary',
      title: 'Language server binary',
      status: 'error',
      message: `Found Antigravity at ${dir} but language_server binary is missing`,
      fixable: false,
    };
  }
  return {
    id: 'install',
    title: 'Antigravity installation',
    status: 'ok',
    message: `Found at ${dir}`,
    data: { installDir: dir, binaryPath: binary },
  };
}
