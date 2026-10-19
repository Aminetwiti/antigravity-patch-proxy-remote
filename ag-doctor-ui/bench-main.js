const t0 = Date.now();
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(() => {
  console.log('[BENCH] app.whenReady:', Date.now() - t0, 'ms');
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#09090b', symbolColor: '#e8eef9', height: 36 },
    webPreferences: {
      preload: path.resolve('dist/preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    }
  });

  win.loadFile(path.resolve('dist/renderer/index.html'));
  win.webContents.on('dom-ready', () => console.log('[BENCH] dom-ready:', Date.now() - t0, 'ms'));
  win.once('ready-to-show', () => {
    console.log('[BENCH] ready-to-show:', Date.now() - t0, 'ms');
    setTimeout(() => app.quit(), 200);
  });
});
