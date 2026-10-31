/**
 * Core device profile management for Antigravity IDE.
 * Inspired by Antigravity-Manager's device module.
 *
 * Reads, displays, and resets telemetry identifiers (`machineId`, `macMachineId`,
 * `devDeviceId`, `sqmId`) in `storage.json` to bypass hardware/device rate limits
 * and shadow bans.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface DeviceProfile {
  machineId: string;
  macMachineId: string;
  devDeviceId: string;
  sqmId: string;
  serviceMachineId?: string;
}

export interface ResetResult {
  path: string;
  backupPath?: string;
  oldProfile?: DeviceProfile;
  newProfile: DeviceProfile;
}

/**
 * Returns all potential storage.json paths across Windows, macOS, and Linux.
 */
export function findStorageJsonPaths(): string[] {
  const paths: string[] = [];
  const folderNames = ['Antigravity', 'Antigravity IDE', 'antigravity-ide', 'antigravity'];

  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    for (const folder of folderNames) {
      paths.push(path.join(appdata, folder, 'User', 'globalStorage', 'storage.json'));
    }
  } else if (process.platform === 'darwin') {
    const home = os.homedir();
    for (const folder of folderNames) {
      paths.push(path.join(home, 'Library', 'Application Support', folder, 'User', 'globalStorage', 'storage.json'));
    }
  } else {
    // Linux / other
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    for (const folder of folderNames) {
      paths.push(path.join(configHome, folder, 'User', 'globalStorage', 'storage.json'));
    }
  }

  return paths.filter((p) => fs.existsSync(p));
}

/**
 * Reads the device profile from storage.json.
 */
export function readDeviceProfile(storagePath: string): DeviceProfile | null {
  try {
    if (!fs.existsSync(storagePath)) return null;
    const content = fs.readFileSync(storagePath, 'utf-8');
    const json = JSON.parse(content);

    const getField = (key: string): string | undefined => {
      if (json.telemetry && typeof json.telemetry === 'object' && json.telemetry[key]) {
        return String(json.telemetry[key]);
      }
      if (json[`telemetry.${key}`]) {
        return String(json[`telemetry.${key}`]);
      }
      return undefined;
    };

    return {
      machineId: getField('machineId') || '',
      macMachineId: getField('macMachineId') || '',
      devDeviceId: getField('devDeviceId') || '',
      sqmId: getField('sqmId') || '',
      serviceMachineId: json['storage.serviceMachineId'] ? String(json['storage.serviceMachineId']) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Generates fresh, realistic random telemetry identifiers.
 */
export function generateDeviceProfile(): DeviceProfile {
  return {
    machineId: crypto.randomBytes(32).toString('hex'),
    macMachineId: crypto.randomBytes(32).toString('hex'),
    devDeviceId: crypto.randomUUID(),
    sqmId: `{${crypto.randomUUID().toUpperCase()}}`,
    serviceMachineId: crypto.randomUUID(),
  };
}

/**
 * Creates a timestamped backup of storage.json.
 */
export function backupStorageJson(storagePath: string): string {
  const dir = path.dirname(storagePath);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupPath = path.join(dir, `storage.json.backup_${timestamp}`);
  fs.copyFileSync(storagePath, backupPath);
  return backupPath;
}

/**
 * Writes the device profile into storage.json, updating both nested and flat telemetry keys.
 */
export function writeDeviceProfile(storagePath: string, profile: DeviceProfile): void {
  let json: Record<string, any> = {};
  if (fs.existsSync(storagePath)) {
    try {
      json = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
    } catch {
      json = {};
    }
  }

  if (!json.telemetry || typeof json.telemetry !== 'object') {
    json.telemetry = {};
  }

  json.telemetry.machineId = profile.machineId;
  json.telemetry.macMachineId = profile.macMachineId;
  json.telemetry.devDeviceId = profile.devDeviceId;
  json.telemetry.sqmId = profile.sqmId;

  json['telemetry.machineId'] = profile.machineId;
  json['telemetry.macMachineId'] = profile.macMachineId;
  json['telemetry.devDeviceId'] = profile.devDeviceId;
  json['telemetry.sqmId'] = profile.sqmId;

  if (profile.serviceMachineId) {
    json['storage.serviceMachineId'] = profile.serviceMachineId;
  }

  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify(json, null, 4), 'utf-8');
}

/**
 * Resets device profile across all discovered storage.json instances.
 */
export function resetDeviceProfiles(dryRun = false): ResetResult[] {
  const paths = findStorageJsonPaths();
  const results: ResetResult[] = [];

  for (const storagePath of paths) {
    const oldProfile = readDeviceProfile(storagePath) || undefined;
    const newProfile = generateDeviceProfile();

    if (dryRun) {
      results.push({ path: storagePath, oldProfile, newProfile });
      continue;
    }

    const backupPath = backupStorageJson(storagePath);
    writeDeviceProfile(storagePath, newProfile);
    results.push({ path: storagePath, backupPath, oldProfile, newProfile });
  }

  return results;
}
