const { app, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const assetsDir = path.join(__dirname, 'dist', 'assets');
  console.log('dist/assets exists:', fs.existsSync(assetsDir));

  for (const st of ['ok', 'warn', 'err']) {
    const p = path.join(assetsDir, `tray-${st}.png`);
    const img = nativeImage.createFromPath(p);
    console.log(`tray-${st}.png:`, 'exists:', fs.existsSync(p), 'empty:', img.isEmpty(), 'size:', img.getSize());
  }

  const trayOkImg = nativeImage.createFromPath(path.join(assetsDir, 'tray-ok.png'));
  const tray = new Tray(trayOkImg);
  tray.setToolTip('ag-doctor test');
  console.log('Tray created successfully! isDestroyed:', tray.isDestroyed());
  tray.destroy();

  app.quit();
});
