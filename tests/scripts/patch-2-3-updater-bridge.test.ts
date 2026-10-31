import { describe, expect, it } from 'vitest';

const {
  addUpdaterStateBridgeToPreload,
} = require('../../scripts/lib/patch-2-3-source');

describe('addUpdaterStateBridgeToPreload', () => {
  it('adds getState to the updater bridge and is idempotent', () => {
    const source = `const updaterAPI = {
    checkForUpdates: () => electron_1.ipcRenderer.invoke('updater:check-for-updates'),
};`;

    const patched = addUpdaterStateBridgeToPreload(source);

    expect(patched).toContain("getState: () => electron_1.ipcRenderer.invoke('updater:get-state')");
    expect(addUpdaterStateBridgeToPreload(patched)).toBe(patched);
  });
});
