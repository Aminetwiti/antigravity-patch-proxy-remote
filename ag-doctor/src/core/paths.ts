/**
 * Cross-platform path resolution for Antigravity installation and data dirs.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getPlatform, isWsl } from './platform';
import { getProfilePath } from './profile';

/** Resolve a Windows path to its WSL mount (e.g. C:\... -> /mnt/c/...). */
function winToWsl(winPath: string): string {
  const m = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return winPath;
  return path.join('/mnt', m[1].toLowerCase(), m[2].replace(/\\/g, '/'));
}

/** User data dir for the Antigravity app. */
export function getAntigravityDataDir(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity');
}

/** Path to the custom_models.json file. Profile-aware. */
export function getCustomModelsPath(): string {
  return getProfilePath('models');
}

/** Path to the active port file (if any). */
export function getActivePortFile(): string {
  return path.join(getAntigravityDataDir(), 'active_port');
}

/**
 * Possible install locations for Antigravity, ordered by likelihood.
 * Returns the first one that exists on disk.
 */
export function findAntigravityInstallDir(): string | null {
  const platform = getPlatform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      candidates.push(path.join(local, 'Programs', 'antigravity'));
    }
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity'));
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Antigravity.app');
    candidates.push(path.join(os.homedir(), 'Applications', 'Antigravity.app'));
  } else if (platform === 'linux') {
    candidates.push(path.join(os.homedir(), '.local', 'share', 'Programs', 'antigravity'));
    candidates.push('/opt/antigravity');
    candidates.push('/usr/lib/antigravity');
    candidates.push('/opt/Antigravity');
    candidates.push(path.join(os.homedir(), 'antigravity'));

    // WSL: also check the Windows-side install directories
    if (isWsl()) {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        candidates.push(winToWsl(path.join(localAppData, 'Programs', 'Antigravity')));
      }
      const wslUsername = process.env.USER || os.userInfo().username;
      candidates.push(`/mnt/c/Users/${wslUsername}/AppData/Local/Programs/Antigravity`);
      candidates.push('/mnt/c/Program Files/Antigravity');
      candidates.push('/mnt/c/Program Files (x86)/Antigravity');
    }
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Path to the language_server binary inside the Antigravity install.
 */
export function getLanguageServerBinary(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityInstallDir();
  if (!dir) return null;
  const platform = getPlatform();
  if (platform === 'win32') {
    return path.join(dir, 'resources', 'bin', 'language_server.exe');
  }
  return path.join(dir, 'resources', 'bin', 'language_server');
}

/**
 * Detect the newer VS Code-based "Antigravity IDE" product install.
 *
 * Since mid-2026 the desktop client ships as "Antigravity IDE" (a VS Code
 * fork, e.g. v1.107.0) at %LOCALAPPDATA%\Programs\Antigravity IDE. It is a
 * different product layout from the classic 2.x shell: no resources/app.asar,
 * and the language server lives inside the bundled extension:
 *   resources\app\extensions\antigravity\bin\language_server_windows_x64.exe
 *
 * The classic install (Programs\antigravity) is still the patch-tooling
 * primary; this helper lets the doctor/repair pipeline also see the IDE.
 */
export function findAntigravityIdeInstallDir(): string | null {
  const platform = getPlatform();
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const p = path.join(local, 'Programs', 'Antigravity IDE');
      if (fs.existsSync(p)) return p;
    }
    const fallback = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity IDE');
    if (fs.existsSync(fallback)) return fallback;
  } else if (platform === 'darwin') {
    const p = '/Applications/Antigravity IDE.app';
    if (fs.existsSync(p)) return p;
  } else if (platform === 'linux') {
    const p = path.join(os.homedir(), '.local', 'share', 'Programs', 'Antigravity IDE');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Executable inside the IDE install (Antigravity IDE.exe on Windows). */
export function getIdeExecutable(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityIdeInstallDir();
  if (!dir) return null;
  const platform = getPlatform();
  const exeName = platform === 'win32' ? 'Antigravity IDE.exe' : 'Antigravity IDE';
  const exe = path.join(dir, exeName);
  return fs.existsSync(exe) ? exe : null;
}

/**
 * Path to the IDE's bundled language server binary
 * (resources\app\extensions\antigravity\bin\language_server_windows_x64.exe).
 */
export function getIdeLanguageServerBinary(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityIdeInstallDir();
  if (!dir) return null;
  const platform = getPlatform();
  const name = platform === 'win32' ? 'language_server_windows_x64.exe' : 'language_server';
  const p = path.join(dir, 'resources', 'app', 'extensions', 'antigravity', 'bin', name);
  return fs.existsSync(p) ? p : null;
}

/**
 * Path to the IDE's VS Code user settings.json. The IDE patch (cloud endpoint
 * override) is a plain settings write, so this file is the patch target.
 */
export function getIdeSettingsJson(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityIdeInstallDir();
  if (!dir) return null;
  const platform = getPlatform();
  let base: string | null = null;
  if (platform === 'win32') {
    base = process.env.APPDATA ?? null;
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = path.join(os.homedir(), '.config');
  }
  if (!base) return null;
  const candidates = [
    path.join(base, 'Antigravity IDE', 'User', 'settings.json'),
    path.join(base, 'Antigravity', 'User', 'settings.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

/** Path to the backup of the original (unpatched) language server binary. */
export function getLanguageServerBackup(installDir?: string): string | null {
  const binary = getLanguageServerBinary(installDir);
  if (!binary) return null;
  return binary + '.bak';
}

/** Path to the app.asar archive inside the Antigravity install. */
export function getAppAsarPath(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityInstallDir();
  if (!dir) return null;
  return path.join(dir, 'resources', 'app.asar');
}

/** Path to the LS log file. */
export function getLsLogPath(): string {
  const platform = getPlatform();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? os.homedir(), 'Antigravity', 'logs', 'language_server.log');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'Antigravity', 'language_server.log');
  }
  if (isWsl()) {
    const username = process.env.USER || os.userInfo().username;
    return `/mnt/c/Users/${username}/AppData/Roaming/Antigravity/logs/language_server.log`;
  }
  return path.join(os.homedir(), '.config', 'Antigravity', 'logs', 'language_server.log');
}
