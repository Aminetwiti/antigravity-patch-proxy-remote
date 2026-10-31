import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadRemoteState, saveRemoteState } from '../proxy';

describe('Remote VPS State Atomic Persistence', () => {
  const homeDir = os.homedir();
  const remoteStateDir = path.join(homeDir, '.gemini', 'antigravity');
  const remoteStatePath = path.join(remoteStateDir, 'remote_vps_state.json');
  let originalContent: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(remoteStatePath)) {
      originalContent = fs.readFileSync(remoteStatePath, 'utf-8');
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      fs.writeFileSync(remoteStatePath, originalContent, 'utf-8');
    }
  });

  it('saveRemoteState writes valid parseable JSON', () => {
    saveRemoteState();
    expect(fs.existsSync(remoteStatePath)).toBe(true);
    const content = fs.readFileSync(remoteStatePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty('active');
    expect(parsed).toHaveProperty('host');
  });

  it('loadRemoteState self-heals files with corrupted trailing bytes', () => {
    const validJson = JSON.stringify({
      active: true,
      host: 'http://127.0.0.1:8090',
      token: 'test-token',
      remoteSessions: {},
    });
    // Simulate torn write where extra characters or braces were left at the end
    fs.writeFileSync(remoteStatePath, validJson + '}{"trailing": "garbage"', 'utf-8');

    expect(() => loadRemoteState()).not.toThrow();
  });

  it('handles rapid sequential saves without throwing or file corruption', () => {
    for (let i = 0; i < 10; i++) {
      saveRemoteState();
    }
    const content = fs.readFileSync(remoteStatePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
