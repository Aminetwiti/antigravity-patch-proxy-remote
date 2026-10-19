import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readDeviceProfile,
  generateDeviceProfile,
  writeDeviceProfile,
  backupStorageJson,
  DeviceProfile,
} from '../core/device';
import { runDevice } from './device';
import type { CommandContext } from '../types';

describe('ag-doctor device management', () => {
  let tempDir: string;
  let mockStoragePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-device-'));
    mockStoragePath = path.join(tempDir, 'storage.json');

    const initialJson = {
      'storage.serviceMachineId': '053a94e0-0e40-440d-8238-42a3004b1cdf',
      telemetry: {
        devDeviceId: 'dev-id-old',
        macMachineId: 'mac-id-old',
        machineId: 'machine-id-old',
        sqmId: '{SQM-OLD}',
      },
      'telemetry.devDeviceId': 'dev-id-old',
      'telemetry.macMachineId': 'mac-id-old',
      'telemetry.machineId': 'machine-id-old',
      'telemetry.sqmId': '{SQM-OLD}',
      theme: 'vs-dark',
    };
    fs.writeFileSync(mockStoragePath, JSON.stringify(initialJson, null, 2), 'utf-8');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reads device profile from storage.json accurately', () => {
    const profile = readDeviceProfile(mockStoragePath);
    expect(profile).not.toBeNull();
    expect(profile?.machineId).toBe('machine-id-old');
    expect(profile?.macMachineId).toBe('mac-id-old');
    expect(profile?.devDeviceId).toBe('dev-id-old');
    expect(profile?.sqmId).toBe('{SQM-OLD}');
    expect(profile?.serviceMachineId).toBe('053a94e0-0e40-440d-8238-42a3004b1cdf');
  });

  it('generates valid fresh device profiles', () => {
    const prof = generateDeviceProfile();
    expect(prof.machineId).toHaveLength(64);
    expect(prof.macMachineId).toHaveLength(64);
    expect(prof.devDeviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(prof.sqmId).toMatch(/^\{[0-9A-F-]{36}\}$/);
    expect(prof.serviceMachineId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates timestamped backups of storage.json', () => {
    const backupPath = backupStorageJson(mockStoragePath);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(backupPath).toContain('storage.json.backup_');
    const content = fs.readFileSync(backupPath, 'utf-8');
    expect(content).toContain('machine-id-old');
  });

  it('writes updated device profile into storage.json preserving existing keys', () => {
    const newProfile: DeviceProfile = {
      machineId: 'new-machine-123',
      macMachineId: 'new-mac-456',
      devDeviceId: 'new-dev-789',
      sqmId: '{NEW-SQM-000}',
      serviceMachineId: 'new-service-id',
    };

    writeDeviceProfile(mockStoragePath, newProfile);

    const updated = JSON.parse(fs.readFileSync(mockStoragePath, 'utf-8'));
    expect(updated.theme).toBe('vs-dark');
    expect(updated.telemetry.machineId).toBe('new-machine-123');
    expect(updated.telemetry.macMachineId).toBe('new-mac-456');
    expect(updated['telemetry.machineId']).toBe('new-machine-123');
    expect(updated['storage.serviceMachineId']).toBe('new-service-id');
  });

  it('returns error when unknown subcommand is passed to runDevice', async () => {
    const ctx: CommandContext = {
      cwd: tempDir,
      json: true,
      verbose: false,
      yes: false,
      options: {},
    };
    const code = await runDevice(ctx, 'invalidSub');
    expect(code).toBe(1);
  });
});
