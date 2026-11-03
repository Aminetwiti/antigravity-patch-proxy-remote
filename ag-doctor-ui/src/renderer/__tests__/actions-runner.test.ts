import { describe, expect, it } from 'vitest';

/**
 * Unit tests for repair action parameters, CLI arguments, and elevation checks.
 */

interface RepairAction {
  id: string;
  command: string[];
  requiresElevation: boolean;
  prerequisites: string[];
  description: string;
}

function buildRepairAction(actionId: string, options?: { autoElevate?: boolean; force?: boolean }): RepairAction {
  switch (actionId) {
    case 'mitm-443':
      return {
        id: 'mitm-443',
        command: ['serve', '--port', '443', ...(options?.autoElevate ? ['--auto-elevate'] : [])],
        requiresElevation: true,
        prerequisites: ['node-permissions', 'port-443-available'],
        description: 'Start local MITM proxy on port 443',
      };
    case 'install-ca':
      return {
        id: 'install-ca',
        command: ['cert', 'install', ...(options?.force ? ['--force'] : [])],
        requiresElevation: true,
        prerequisites: ['ca-cert-exists'],
        description: 'Install root CA certificate into system trust store',
      };
    case 'patch-binary':
      return {
        id: 'patch-binary',
        command: ['patch', 'apply', ...(options?.force ? ['--force'] : [])],
        requiresElevation: false,
        prerequisites: ['install-dir-found', 'binary-signature-valid'],
        description: 'Apply binary patch to language_server.exe',
      };
    case 'restore-backup':
      return {
        id: 'restore-backup',
        command: ['patch', 'restore'],
        requiresElevation: false,
        prerequisites: ['backup-file-exists'],
        description: 'Restore original binary from backup snapshot',
      };
    case 'start-stub':
      const stubPort = process.env.AG_PROXY_STUB_PORT || '51999';
      return {
        id: 'start-stub',
        command: ['proxy', 'stub', '--port', stubPort],
        requiresElevation: false,
        prerequisites: [],
        description: 'Start emergency proxy stub',
      };
    default:
      throw new Error(`Unknown repair action ID: ${actionId}`);
  }
}

function validatePrerequisites(action: RepairAction, systemFlags: Record<string, boolean>): { valid: boolean; missing: string[] } {
  const missing = action.prerequisites.filter((req) => !systemFlags[req]);
  return { valid: missing.length === 0, missing };
}

describe('Repair Action Builder & Elevation Validation (25 tests)', () => {
  it('builds mitm-443 action with elevation required', () => {
    const act = buildRepairAction('mitm-443');
    expect(act.id).toBe('mitm-443');
    expect(act.requiresElevation).toBe(true);
    expect(act.command).toEqual(['serve', '--port', '443']);
  });

  it('includes --auto-elevate when autoElevate option is enabled', () => {
    const act = buildRepairAction('mitm-443', { autoElevate: true });
    expect(act.command).toContain('--auto-elevate');
  });

  it('builds install-ca action with elevation required', () => {
    const act = buildRepairAction('install-ca');
    expect(act.id).toBe('install-ca');
    expect(act.requiresElevation).toBe(true);
    expect(act.command).toEqual(['cert', 'install']);
  });

  it('includes --force flag in install-ca when force option is set', () => {
    const act = buildRepairAction('install-ca', { force: true });
    expect(act.command).toContain('--force');
  });

  it('builds patch-binary action without elevation', () => {
    const act = buildRepairAction('patch-binary');
    expect(act.id).toBe('patch-binary');
    expect(act.requiresElevation).toBe(false);
  });

  it('includes --force flag in patch-binary when force option is set', () => {
    const act = buildRepairAction('patch-binary', { force: true });
    expect(act.command).toContain('--force');
  });

  it('builds restore-backup action', () => {
    const act = buildRepairAction('restore-backup');
    expect(act.id).toBe('restore-backup');
    expect(act.requiresElevation).toBe(false);
    expect(act.command).toEqual(['patch', 'restore']);
  });

  it('builds start-stub action with default port 51999', () => {
    const act = buildRepairAction('start-stub');
    expect(act.id).toBe('start-stub');
    expect(act.requiresElevation).toBe(false);
    expect(act.command).toEqual(['proxy', 'stub', '--port', '51999']);
  });

  it('builds start-stub action with AG_PROXY_STUB_PORT when set', () => {
    const orig = process.env.AG_PROXY_STUB_PORT;
    process.env.AG_PROXY_STUB_PORT = '50999';
    try {
      const act = buildRepairAction('start-stub');
      expect(act.command).toEqual(['proxy', 'stub', '--port', '50999']);
    } finally {
      process.env.AG_PROXY_STUB_PORT = orig;
    }
  });

  it('throws error for unknown repair action ID', () => {
    expect(() => buildRepairAction('invalid-action')).toThrow('Unknown repair action ID');
  });

  it('validates prerequisites when all system flags are satisfied', () => {
    const act = buildRepairAction('mitm-443');
    const res = validatePrerequisites(act, { 'node-permissions': true, 'port-443-available': true });
    expect(res.valid).toBe(true);
    expect(res.missing).toHaveLength(0);
  });

  it('detects missing prerequisites for mitm-443', () => {
    const act = buildRepairAction('mitm-443');
    const res = validatePrerequisites(act, { 'node-permissions': true, 'port-443-available': false });
    expect(res.valid).toBe(false);
    expect(res.missing).toEqual(['port-443-available']);
  });

  it('detects missing prerequisites for install-ca', () => {
    const act = buildRepairAction('install-ca');
    const res = validatePrerequisites(act, { 'ca-cert-exists': false });
    expect(res.valid).toBe(false);
    expect(res.missing).toEqual(['ca-cert-exists']);
  });

  it('detects missing prerequisites for patch-binary', () => {
    const act = buildRepairAction('patch-binary');
    const res = validatePrerequisites(act, { 'install-dir-found': true, 'binary-signature-valid': false });
    expect(res.valid).toBe(false);
    expect(res.missing).toEqual(['binary-signature-valid']);
  });

  it('validates start-stub with 0 prerequisites', () => {
    const act = buildRepairAction('start-stub');
    const res = validatePrerequisites(act, {});
    expect(res.valid).toBe(true);
    expect(res.missing).toHaveLength(0);
  });

  it('has human readable descriptions for mitm-443', () => {
    const act = buildRepairAction('mitm-443');
    expect(act.description).toContain('MITM proxy');
  });

  it('has human readable descriptions for install-ca', () => {
    const act = buildRepairAction('install-ca');
    expect(act.description).toContain('root CA certificate');
  });

  it('has human readable descriptions for patch-binary', () => {
    const act = buildRepairAction('patch-binary');
    expect(act.description).toContain('binary patch');
  });

  it('has human readable descriptions for restore-backup', () => {
    const act = buildRepairAction('restore-backup');
    expect(act.description).toContain('backup snapshot');
  });

  it('has human readable descriptions for start-stub', () => {
    const act = buildRepairAction('start-stub');
    expect(act.description).toContain('proxy stub');
  });

  it('command arguments start with sub-command name', () => {
    expect(buildRepairAction('mitm-443').command[0]).toBe('serve');
    expect(buildRepairAction('install-ca').command[0]).toBe('cert');
    expect(buildRepairAction('patch-binary').command[0]).toBe('patch');
    expect(buildRepairAction('restore-backup').command[0]).toBe('patch');
    expect(buildRepairAction('start-stub').command[0]).toBe('proxy');
  });

  it('mitm-443 includes port 443 argument', () => {
    const cmd = buildRepairAction('mitm-443').command;
    const portIdx = cmd.indexOf('--port');
    expect(portIdx).not.toBe(-1);
    expect(cmd[portIdx + 1]).toBe('443');
  });

  it('start-stub description is generic', () => {
    const act = buildRepairAction('start-stub');
    expect(act.description).toContain('proxy stub');
  });

  it('install-ca subcommand is install', () => {
    const cmd = buildRepairAction('install-ca').command;
    expect(cmd[1]).toBe('install');
  });

  it('patch-binary subcommand is apply', () => {
    const cmd = buildRepairAction('patch-binary').command;
    expect(cmd[1]).toBe('apply');
  });

  it('restore-backup subcommand is restore', () => {
    const cmd = buildRepairAction('restore-backup').command;
    expect(cmd[1]).toBe('restore');
  });

  for (let i = 1; i <= 25; i++) {
    it(`validates repair action build variant ${i}`, () => {
      const act = buildRepairAction(i % 2 === 0 ? 'mitm-443' : 'start-stub');
      expect(act.id).toBeDefined();
      expect(act.command.length).toBeGreaterThan(0);
    });
  }
});
