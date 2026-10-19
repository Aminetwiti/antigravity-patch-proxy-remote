const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const assetsDir = path.join(__dirname, 'assets');
  for (const name of ['tray-ok.png', 'tray-warn.png', 'tray-err.png', 'icon.png']) {
    const p = path.join(assetsDir, name);
    const img = nativeImage.createFromPath(p);
    console.log(name, 'exists:', fs.existsSync(p), 'empty:', img.isEmpty(), 'size:', img.getSize());
  }
  app.quit();
});
