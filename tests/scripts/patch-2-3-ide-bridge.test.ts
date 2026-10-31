import { describe, expect, it } from 'vitest';

const {
  addIdeBridgeToPreload,
} = require('../../scripts/lib/patch-2-3-source');

describe('addIdeBridgeToPreload', () => {
  it('adds the 2.3.1 IDE bridge and is idempotent', () => {
    const source = `const electronNativeAPI = {};
electron_1.contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);
window.addEventListener('DOMContentLoaded', () => {});`;

    const patched = addIdeBridgeToPreload(source);

    expect(patched).toContain("const ideAPI = { isInstalled: () => electron_1.ipcRenderer.invoke('ide:is-installed') }");
    expect(patched).toContain("exposeInMainWorld('ide', ideAPI)");
    expect(addIdeBridgeToPreload(patched)).toBe(patched);
  });
});
