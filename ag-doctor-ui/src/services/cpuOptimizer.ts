import * as fs from 'fs';
import * as path from 'path';

export interface ProfileCpuStatus {
  path: string;
  exists: boolean;
  optimized: boolean;
  hasWatcherExclude: boolean;
  hasSearchExclude: boolean;
  hasTsServerOpt: boolean;
  hasPythonOpt: boolean;
  backupExists: boolean;
  lastBackup?: string;
}

export interface CpuOptimizationStatus {
  isOptimized: boolean;
  profiles: ProfileCpuStatus[];
}

export const CPU_OPTIMIZATION_CONFIG: Record<string, unknown> = {
  'files.watcherExclude': {
    '**/.git/objects/**': true,
    '**/.git/subtree-cache/**': true,
    '**/node_modules/**': true,
    '**/.venv/**': true,
    '**/__pycache__/**': true,
    '**/dist/**': true,
    '**/build/**': true,
    '**/.next/**': true,
    '**/target/**': true,
    '**/.cache/**': true,
  },
  'search.exclude': {
    '**/node_modules': true,
    '**/venv': true,
    '**/.venv': true,
    '**/__pycache__': true,
    '**/dist': true,
    '**/build': true,
    '**/.next': true,
    '**/target': true,
    '**/.git': true,
    '**/.cache': true,
  },
  'search.followSymlinks': false,
  'search.useIgnoreFiles': true,
  'typescript.tsserver.maxTsServerMemory': 2048,
  'typescript.tsserver.watchOptions': {
    watchFile: 'useFsEvents',
    watchDirectory: 'useFsEvents',
    fallbackPolling: 'dynamicPriority',
    synchronousWatchDirectory: false,
  },
  'python.analysis.typeCheckingMode': 'basic',
  'python.analysis.autoImportCompletions': false,
  'python.analysis.diagnosticMode': 'workspace',
  'python.analysis.indexing': false,
};

/**
 * Returns candidate settings.json paths for Antigravity across platforms.
 */
export function getCandidateSettingsPaths(): string[] {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    return [
      path.join(appData, 'Antigravity IDE', 'User', 'settings.json'),
      path.join(appData, 'Antigravity', 'User', 'settings.json'),
    ];
  } else if (isMac) {
    const home = process.env.HOME || '';
    return [
      path.join(home, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'settings.json'),
      path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json'),
    ];
  } else {
    const home = process.env.HOME || '';
    return [
      path.join(home, '.config', 'Antigravity IDE', 'User', 'settings.json'),
      path.join(home, '.config', 'Antigravity', 'User', 'settings.json'),
    ];
  }
}

/**
 * Checks CPU optimization status for all candidate settings files.
 */
export function getCpuOptimizationStatus(customPaths?: string[]): CpuOptimizationStatus {
  const pathsToCheck = customPaths ?? getCandidateSettingsPaths();
  const profiles: ProfileCpuStatus[] = [];

  for (const filePath of pathsToCheck) {
    const exists = fs.existsSync(filePath);
    if (!exists) {
      profiles.push({
        path: filePath,
        exists: false,
        optimized: false,
        hasWatcherExclude: false,
        hasSearchExclude: false,
        hasTsServerOpt: false,
        hasPythonOpt: false,
        backupExists: false,
      });
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hasWatcherExclude = content.includes('files.watcherExclude');
      const hasSearchExclude = content.includes('search.exclude');
      const hasTsServerOpt = content.includes('typescript.tsserver.maxTsServerMemory');
      const hasPythonOpt = content.includes('python.analysis.indexing');

      const optimized = hasWatcherExclude && hasTsServerOpt;

      // Check for backups in the same folder
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      let backupExists = false;
      let lastBackup: string | undefined;

      try {
        const files = fs.readdirSync(dir);
        const backups = files
          .filter((f) => f.startsWith(`${base}.bak_`))
          .sort()
          .reverse();
        if (backups.length > 0) {
          backupExists = true;
          lastBackup = path.join(dir, backups[0]);
        }
      } catch {
        // readdir error ignored
      }

      profiles.push({
        path: filePath,
        exists: true,
        optimized,
        hasWatcherExclude,
        hasSearchExclude,
        hasTsServerOpt,
        hasPythonOpt,
        backupExists,
        lastBackup,
      });
    } catch {
      profiles.push({
        path: filePath,
        exists: true,
        optimized: false,
        hasWatcherExclude: false,
        hasSearchExclude: false,
        hasTsServerOpt: false,
        hasPythonOpt: false,
        backupExists: false,
      });
    }
  }

  const existingProfiles = profiles.filter((p) => p.exists);
  const isOptimized = existingProfiles.length > 0 && existingProfiles.every((p) => p.optimized);

  return {
    isOptimized,
    profiles,
  };
}

function parseJsonc(text: string): Record<string, unknown> | null {
  try {
    const clean = text
      .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(clean);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Applies CPU optimizations to all existing candidate settings files.
 */
export function applyCpuOptimizations(customPaths?: string[]): {
  success: boolean;
  modified: string[];
  skipped: string[];
  errors: string[];
} {
  const pathsToApply = customPaths ?? getCandidateSettingsPaths();
  const modified: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const filePath of pathsToApply) {
    if (!fs.existsSync(filePath)) {
      skipped.push(filePath);
      continue;
    }

    try {
      // 1. Create timestamped backup
      const backupPath = `${filePath}.bak_${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);

      // 2. Read existing content
      const raw = fs.readFileSync(filePath, 'utf-8');

      // Check if already optimized
      if (raw.includes('files.watcherExclude') && raw.includes('typescript.tsserver.maxTsServerMemory')) {
        skipped.push(filePath);
        continue;
      }

      const existing = parseJsonc(raw) || {};

      // Deep merge object configs (files.watcherExclude, search.exclude, watchOptions)
      const merged: Record<string, unknown> = { ...existing };
      for (const [key, val] of Object.entries(CPU_OPTIMIZATION_CONFIG)) {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const current = (typeof merged[key] === 'object' && merged[key] !== null && !Array.isArray(merged[key]))
            ? (merged[key] as Record<string, unknown>)
            : {};
          merged[key] = { ...current, ...(val as Record<string, unknown>) };
        } else {
          merged[key] = val;
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      modified.push(filePath);
    } catch (err) {
      errors.push(`${filePath}: ${(err as Error).message}`);
    }
  }

  return {
    success: errors.length === 0,
    modified,
    skipped,
    errors,
  };
}

/**
 * Reverts CPU optimizations using the most recent backup file.
 */
export function revertCpuOptimizations(customPaths?: string[]): {
  success: boolean;
  restored: string[];
  errors: string[];
} {
  const pathsToRevert = customPaths ?? getCandidateSettingsPaths();
  const restored: string[] = [];
  const errors: string[] = [];

  for (const filePath of pathsToRevert) {
    if (!fs.existsSync(filePath)) continue;

    try {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      const files = fs.readdirSync(dir);
      const backups = files
        .filter((f) => f.startsWith(`${base}.bak_`))
        .sort()
        .reverse();

      if (backups.length === 0) {
        errors.push(`${filePath}: No backup found to restore`);
        continue;
      }

      const latestBackup = path.join(dir, backups[0]);
      fs.copyFileSync(latestBackup, filePath);
      restored.push(filePath);
    } catch (err) {
      errors.push(`${filePath}: ${(err as Error).message}`);
    }
  }

  return {
    success: errors.length === 0 && restored.length > 0,
    restored,
    errors,
  };
}
