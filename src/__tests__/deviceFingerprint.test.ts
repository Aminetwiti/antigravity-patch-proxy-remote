import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  generateDeviceProfile,
  writeDeviceProfile,
  randomizeAllDevices,
  type DeviceProfile,
} from '../../ag-doctor/src/core/device-fingerprint';

describe('device-fingerprint module', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-device-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates valid compliant profile with correct formats', () => {
    const profile = generateDeviceProfile();
    expect(profile.machineId).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.macMachineId).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.devDeviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.sqmId).toMatch(/^\{[0-9A-F-]{36}\}$/);
  });

  it('writes profile to storage.json and creates backup', () => {
    const storagePath = path.join(tmpDir, 'storage.json');
    fs.writeFileSync(storagePath, JSON.stringify({ existingKey: 'value' }), 'utf8');

    const profile: DeviceProfile = {
      machineId: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      macMachineId: '12345678-1234-1234-1234-123456789abc',
      devDeviceId: 'abcdef12-abcd-abcd-abcd-abcdef123456',
      sqmId: '{ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456}',
    };

    const res = writeDeviceProfile(storagePath, profile);
    expect(res.success).toBe(true);
    expect(res.backupPath).toBeDefined();
    expect(fs.existsSync(res.backupPath!)).toBe(true);

    const updated = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    expect(updated.existingKey).toBe('value');
    expect(updated.telemetry.machineId).toBe(profile.machineId);
    expect(updated['telemetry.machineId']).toBe(profile.machineId);
    expect(updated['storage.serviceMachineId']).toBe(profile.devDeviceId);
  });

  it('randomizeAllDevices runs safely with fallback', () => {
    const res = randomizeAllDevices();
    expect(res.profile).toBeDefined();
    expect(res.profile.machineId).toHaveLength(64);
  });
});
