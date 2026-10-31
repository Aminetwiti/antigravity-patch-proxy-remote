/**
 * Profile system — isolated configuration & data per profile.
 *
 * Each profile lives in its own directory:
 *   ~/.gemini/antigravity/profiles/<name>/
 *     ├── config.json          (overrides global config)
 *     ├── custom_models.json   (overrides global models)
 *     ├── checks/              (additive to global plugins)
 *     ├── history/             (isolated history)
 *     └── snapshots/           (isolated snapshots)
 *
 * The active profile name is stored in:
 *   ~/.gemini/antigravity/active_profile
 *
 * Resolution order (highest priority first):
 *   1. CLI flag: --profile <name>
 *   2. Env var:  AG_DOCTOR_PROFILE=<name>
 *   3. Active profile file
 *   4. Default (no profile) — uses global paths
 *
 * Commands:
 *   ag-doctor profile list
 *   ag-doctor profile use <name>
 *   ag-doctor profile create <name>
 *   ag-doctor profile delete <name>
 *   ag-doctor profile show
 *   ag-doctor profile path
 *   ag-doctor profile copy <src> <dst>
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export const PROFILES_DIR_NAME = 'profiles';
export const ACTIVE_PROFILE_FILE = 'active_profile';

/** Local copy to avoid circular dep with paths.ts */
function getAntigravityDataDir(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity');
}

export interface ProfileInfo {
  name: string;
  path: string;
  hasConfig: boolean;
  hasModels: boolean;
  hasChecks: boolean;
  hasHistory: boolean;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
}

/** Path to the profiles directory. */
export function getProfilesDir(): string {
  return path.join(getAntigravityDataDir(), PROFILES_DIR_NAME);
}

/** Path to the active profile marker file. */
export function getActiveProfileFile(): string {
  return path.join(getAntigravityDataDir(), ACTIVE_PROFILE_FILE);
}

/** Ensure profiles directory exists. */
export function ensureProfilesDir(): string {
  const dir = getProfilesDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Validate profile name. */
export function validateProfileName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Profile name is required');
  }
  if (name.length > 64) {
    throw new Error('Profile name too long (max 64 chars)');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error(
      'Profile name must start with alphanumeric and contain only [a-zA-Z0-9._-]',
    );
  }
  if (name === 'default' || name === 'global') {
    throw new Error(`Profile name "${name}" is reserved`);
  }
}

/** Get the directory for a specific profile. */
export function getProfileDir(name: string): string {
  validateProfileName(name);
  return path.join(getProfilesDir(), name);
}

/** Check if a profile exists. */
export function profileExists(name: string): boolean {
  try {
    validateProfileName(name);
  } catch {
    return false;
  }
  return fs.existsSync(getProfileDir(name));
}

/**
 * Resolve the active profile name from CLI flag, env var, or active file.
 * Returns null if no profile is active (use global paths).
 */
export function resolveActiveProfile(cliFlag?: string): string | null {
  // 1. CLI flag
  if (cliFlag && cliFlag !== 'default' && cliFlag !== 'global') {
    return cliFlag;
  }

  // 2. Env var
  const env = process.env.AG_DOCTOR_PROFILE;
  if (env && env !== 'default' && env !== 'global') {
    return env;
  }

  // 3. Active profile file
  const file = getActiveProfileFile();
  if (fs.existsSync(file)) {
    try {
      const name = fs.readFileSync(file, 'utf-8').trim();
      if (name && name !== 'default' && name !== 'global' && profileExists(name)) {
        return name;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/** Get the active profile name (or null). */
export function getActiveProfile(): string | null {
  return resolveActiveProfile();
}

/** Set the active profile. Writes to active_profile file. */
export function setActiveProfile(name: string | null): void {
  if (name === null) {
    // Clear active profile
    const file = getActiveProfileFile();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  validateProfileName(name);
  if (!profileExists(name)) {
    throw new Error(`Profile "${name}" does not exist. Create it first with \`ag-doctor profile create\``);
  }
  fs.mkdirSync(path.dirname(getActiveProfileFile()), { recursive: true });
  fs.writeFileSync(getActiveProfileFile(), name + '\n', 'utf-8');
}

/** Create a new profile. */
export function createProfile(name: string, options: { fromActive?: boolean } = {}): string {
  validateProfileName(name);
  const dir = getProfileDir(name);
  if (fs.existsSync(dir)) {
    throw new Error(`Profile "${name}" already exists at ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'checks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });

  // Optionally copy from currently active profile
  if (options.fromActive) {
    const active = getActiveProfile();
    if (active) {
      const srcDir = getProfileDir(active);
      copyDirContents(srcDir, dir, ['config.json', 'custom_models.json']);
    }
  }

  return dir;
}

/** Delete a profile. */
export function deleteProfile(name: string, options: { force?: boolean } = {}): boolean {
  validateProfileName(name);
  const dir = getProfileDir(name);
  if (!fs.existsSync(dir)) return false;

  // If this is the active profile, refuse unless --force
  if (getActiveProfile() === name && !options.force) {
    throw new Error(
      `Cannot delete active profile "${name}". Use \`ag-doctor profile use default\` first, or pass --force.`,
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** List all profiles. */
export function listProfiles(): ProfileInfo[] {
  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) return [];

  const active = getActiveProfile();
  const profiles: ProfileInfo[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    try {
      validateProfileName(name);
    } catch {
      continue;
    }

    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    const configPath = path.join(p, 'config.json');
    const modelsPath = path.join(p, 'custom_models.json');
    const checksDir = path.join(p, 'checks');
    const historyDir = path.join(p, 'history');

    profiles.push({
      name,
      path: p,
      hasConfig: fs.existsSync(configPath),
      hasModels: fs.existsSync(modelsPath),
      hasChecks: fs.existsSync(checksDir) && fs.readdirSync(checksDir).some((f) => f.endsWith('.json')),
      hasHistory: fs.existsSync(historyDir) && fs.readdirSync(historyDir).some((f) => f.endsWith('.json')),
      sizeBytes: dirSize(p),
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  // Sort: active first, then alphabetical
  profiles.sort((a, b) => {
    if (a.name === active) return -1;
    if (b.name === active) return 1;
    return a.name.localeCompare(b.name);
  });

  return profiles;
}

/** Copy a profile to a new name. */
export function copyProfile(src: string, dst: string): string {
  validateProfileName(src);
  validateProfileName(dst);
  const srcDir = getProfileDir(src);
  const dstDir = getProfileDir(dst);

  if (!fs.existsSync(srcDir)) {
    throw new Error(`Source profile "${src}" does not exist`);
  }
  if (fs.existsSync(dstDir)) {
    throw new Error(`Destination profile "${dst}" already exists`);
  }

  fs.mkdirSync(dstDir, { recursive: true });
  copyDirContents(srcDir, dstDir);
  return dstDir;
}

/** Get profile-aware path for a given resource. */
export function getProfilePath(resource: 'config' | 'models' | 'checks' | 'history' | 'snapshots', profileName?: string | null): string {
  const name = profileName ?? getActiveProfile();
  if (!name) {
    // No profile — return global path
    const base = getAntigravityDataDir();
    switch (resource) {
      case 'config': return path.join(base, 'config.json');
      case 'models': return path.join(base, 'custom_models.json');
      case 'checks': return path.join(base, 'checks');
      case 'history': return path.join(base, 'history');
      case 'snapshots': return path.join(base, 'snapshots');
    }
  }

  const dir = getProfileDir(name);
  switch (resource) {
    case 'config': return path.join(dir, 'config.json');
    case 'models': return path.join(dir, 'custom_models.json');
    case 'checks': return path.join(dir, 'checks');
    case 'history': return path.join(dir, 'history');
    case 'snapshots': return path.join(dir, 'snapshots');
  }
}

/** Load profile-specific config if it exists, else return null (caller falls back to global). */
export function loadProfileConfig(profileName?: string | null): Record<string, unknown> | null {
  const configPath = getProfilePath('config', profileName);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(p);
      } else if (entry.isFile()) {
        total += fs.statSync(p).size;
      }
    }
  } catch {
    // ignore
  }
  return total;
}

function copyDirContents(src: string, dst: string, onlyFiles: string[] | null = null): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (onlyFiles && !onlyFiles.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDirContents(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Re-export for convenience
export { formatBytes };
