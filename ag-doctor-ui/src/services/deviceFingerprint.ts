/**
 * Device fingerprint randomizer & anti-syndication engine.
 *
 * Prevents mass-account bans caused by Google correlating 30+ accounts to a single machineId
 * and serviceMachineId across Antigravity, Antigravity IDE, and VS Code.
 *
 * Inspired by Antigravity-Manager device.rs
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
}

export interface RandomizeResult {
  success: boolean;
  profile: DeviceProfile;
  updatedFiles: string[];
  backups: string[];
  error?: string;
}

/**
 * Generate a fresh, valid device profile compliant with VS Code / Antigravity telemetry specs.
 */
export function generateDeviceProfile(): DeviceProfile {
  const machineId = crypto.randomBytes(32).toString('hex');
  const macMachineId = crypto.randomUUID();
  const devDeviceId = crypto.randomUUID();
  const sqmId = `{${crypto.randomUUID().toUpperCase()}}`;

  return {
    machineId,
    macMachineId,
    devDeviceId,
    sqmId,
  };
}

/**
 * Locate all candidate storage.json files across Antigravity, Antigravity IDE, and Code.
 */
export function findStoragePaths(): string[] {
  const candidates: string[] = [];
  const folderNames = ['Antigravity', 'Antigravity IDE', 'antigravity', 'antigravity-ide', 'Code'];

  const platform = process.platform;
  if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    for (const folder of folderNames) {
      candidates.push(path.join(appdata, folder, 'User', 'globalStorage', 'storage.json'));
    }
  } else if (platform === 'darwin') {
    const home = os.homedir();
    for (const folder of folderNames) {
      candidates.push(path.join(home, 'Library', 'Application Support', folder, 'User', 'globalStorage', 'storage.json'));
    }
  } else {
    // Linux
    const home = os.homedir();
    for (const folder of folderNames) {
      candidates.push(path.join(home, '.config', folder, 'User', 'globalStorage', 'storage.json'));
    }
  }

  // Filter existing files
  return Array.from(new Set(candidates.filter((p) => fs.existsSync(p))));
}

/**
 * Backup storage.json before writing.
 */
export function backupStorage(storagePath: string): string {
  const dir = path.dirname(storagePath);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupPath = path.join(dir, `storage.json.backup_${ts}`);
  fs.copyFileSync(storagePath, backupPath);
  return backupPath;
}

/**
 * Sync serviceMachineId into state.vscdb SQLite table ItemTable if present.
 */
export function syncStateVscdb(storagePath: string, serviceMachineId: string): boolean {
  const dir = path.dirname(storagePath);
  const dbPath = path.join(dir, 'state.vscdb');
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  try {
    // Attempt using built-in node:sqlite (Node 22+)
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT);');
      const stmt = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
      stmt.run('storage.serviceMachineId', serviceMachineId);
      db.close();
      return true;
    } catch {
      try {
        db.close();
      } catch {}
    }
  } catch {
    // If node:sqlite is not available, we continue without throwing
  }

  return false;
}

/**
 * Write device profile to a specific storage.json and sync state.vscdb.
 */
export function writeDeviceProfile(storagePath: string, profile: DeviceProfile): { success: boolean; backupPath?: string } {
  try {
    let backupPath: string | undefined;
    if (fs.existsSync(storagePath)) {
      backupPath = backupStorage(storagePath);
    } else {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    }

    let json: Record<string, any> = {};
    if (fs.existsSync(storagePath)) {
      try {
        const content = fs.readFileSync(storagePath, 'utf8');
        json = JSON.parse(content);
      } catch {
        json = {};
      }
    }

    // Telemetry nested object
    if (!json.telemetry || typeof json.telemetry !== 'object') {
      json.telemetry = {};
    }
    json.telemetry.machineId = profile.machineId;
    json.telemetry.macMachineId = profile.macMachineId;
    json.telemetry.devDeviceId = profile.devDeviceId;
    json.telemetry.sqmId = profile.sqmId;

    // Flat keys for backwards compatibility across VS Code forks
    json['telemetry.machineId'] = profile.machineId;
    json['telemetry.macMachineId'] = profile.macMachineId;
    json['telemetry.devDeviceId'] = profile.devDeviceId;
    json['telemetry.sqmId'] = profile.sqmId;

    // Root service machine ID
    json['storage.serviceMachineId'] = profile.devDeviceId;

    fs.writeFileSync(storagePath, JSON.stringify(json, null, 2) + '\n', 'utf8');

    // Sync state.vscdb
    syncStateVscdb(storagePath, profile.devDeviceId);

    return { success: true, backupPath };
  } catch (err: any) {
    return { success: false };
  }
}

/**
 * Execute full device fingerprint renewal across all detected Antigravity / Code instances.
 */
export function randomizeAllDevices(targetProfile?: DeviceProfile): RandomizeResult {
  const profile = targetProfile || generateDeviceProfile();
  const paths = findStoragePaths();

  if (paths.length === 0) {
    // Create baseline for default Antigravity path if none found
    const appdata = process.env.APPDATA || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
    const defaultStorage = path.join(appdata, 'Antigravity', 'User', 'globalStorage', 'storage.json');
    paths.push(defaultStorage);
  }

  const updatedFiles: string[] = [];
  const backups: string[] = [];

  for (const p of paths) {
    const res = writeDeviceProfile(p, profile);
    if (res.success) {
      updatedFiles.push(p);
      if (res.backupPath) backups.push(res.backupPath);
    }
  }

  return {
    success: updatedFiles.length > 0,
    profile,
    updatedFiles,
    backups,
  };
}
