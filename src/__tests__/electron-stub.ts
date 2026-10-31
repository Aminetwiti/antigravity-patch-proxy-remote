// Minimal stub for the `electron` module so proxy/modelLoader can be tested in vitest
// (which runs in plain Node without the Electron runtime).
const noop = () => undefined;

const stub = {
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    getName: () => 'antigravity-add-model',
    on: noop,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: noop, on: noop },
  ipcRenderer: { invoke: noop, on: noop, send: noop },
  BrowserWindow: class {
    loadURL = noop;
    on = noop;
    webContents = { on: noop, send: noop, session: { on: noop } };
  },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  shell: { openExternal: noop },
  contextBridge: { exposeInMainWorld: noop },
  webRequest: {},
};

export = stub;
