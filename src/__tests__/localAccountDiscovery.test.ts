import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { discoverLocalGoogleAccounts } from '../services/localAccountDiscovery';

describe('Local Google Account Discovery', () => {
  const testDir = path.join(os.tmpdir(), `discovery-test-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('runs discovery without throwing errors even if no default files exist', async () => {
    const results = await discoverLocalGoogleAccounts();
    expect(Array.isArray(results)).toBe(true);
  });
});
