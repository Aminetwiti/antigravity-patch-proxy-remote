import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execSync, ChildProcess } from 'child_process';
import qrcode from 'qrcode';

let mainWindow: BrowserWindow | null = null;
let daemonProcess: ChildProcess | null = null;

function resolveDaemonPath(): { exePath: string; isGoRun: boolean } {
  // Check compiled exe first
  const candidates = [
    path.join(__dirname, '..', '..', 'daemon', 'daemon.exe'),
    path.join(__dirname, '..', '..', 'daemon', 'daemon'),
    path.join(__dirname, '..', 'daemon', 'daemon.exe'),
    path.join(process.resourcesPath || '', 'daemon', 'daemon.exe'),
    path.join(process.resourcesPath || '', 'remote', 'daemon', 'daemon.exe'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { exePath: candidate, isGoRun: false };
    }
  }

  // Check if main.go exists in daemon folder
  const goMain = path.join(__dirname, '..', '..', 'daemon', 'main.go');
  if (fs.existsSync(goMain)) {
    return { exePath: goMain, isGoRun: true };
  }

  return {
    exePath: path.join(__dirname, '..', '..', 'daemon', 'daemon.exe'),
    isGoRun: false,
  };
}

function killOrphanDaemonProcesses(): void {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM daemon.exe /T 2>nul & taskkill /F /IM cloudflared.exe /T 2>nul', {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      execSync('pkill -f "remote/daemon/daemon" || true', { stdio: 'ignore' });
    }
  } catch {
    /* ignore cleanup errors */
  }
}

function createWindow(): void {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 880,
    minHeight: 650,
    backgroundColor: '#09090b',
    title: 'Antigravity Remote Daemon',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ──────────────────────────────────────────
// IPC Handlers
// ──────────────────────────────────────────

ipcMain.handle('remote:getLocalIp', async () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
});

ipcMain.handle('remote:generateQr', async (_event, text: string) => {
  try {
    const dataUrl = await qrcode.toDataURL(text, {
      width: 260,
      margin: 2,
      color: { dark: '#000000FF', light: '#FFFFFFFF' },
    });
    return dataUrl;
  } catch (e: any) {
    throw new Error('Failed to generate QR code: ' + e.message);
  }
});

ipcMain.handle('remote:getDaemonStatus', async (_event, customPort?: number, token?: string) => {
  const port = customPort || 8090;
  const authToken = token || '11';
  let running = false;
  let diagData: any = {};
  let healthData: any = {};

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/diagnostic?token=${encodeURIComponent(authToken)}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      diagData = await res.json();
      running = true;
    }
  } catch {
    /* offline */
  }

  try {
    const hRes = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(1500),
    });
    if (hRes.ok) {
      healthData = await hRes.json();
      running = true;
    }
  } catch {
    /* ignore */
  }

  return { running, port, ...diagData, telemetry: healthData };
});

ipcMain.handle('remote:startDaemon', async (event, options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }) => {
  const port = options.port || 8090;
  const token = options.token && options.token.trim().length > 0 ? options.token.trim() : '11';

  // Check if daemon is already active on this port
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/diagnostic?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data: any = await res.json();
      event.sender.send('remote:daemonLog', `> Daemon déjà actif et opérationnel sur le port ${port} (PID ${data.pid || 'actif'})\n`);
      if (data.publicUrl) {
        event.sender.send('remote:daemonLog', `🚀 Tunnel public actif : ${data.publicUrl}\n`);
      }
      return { success: true, alreadyRunning: true, port, token, ...data };
    }
  } catch {
    /* not running, proceed to launch */
  }

  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch { /* ignore */ }
    daemonProcess = null;
  }

  killOrphanDaemonProcesses();

  const { exePath, isGoRun } = resolveDaemonPath();
  const daemonDir = isGoRun ? path.dirname(exePath) : path.dirname(exePath);
  const daemonBinDir = path.join(daemonDir, 'bin');
  const envPath = `${daemonDir}${path.delimiter}${daemonBinDir}${path.delimiter}${process.env.PATH || ''}`;

  const cliArgs: string[] = [];
  if (isGoRun) {
    cliArgs.push('run', 'main.go');
  }

  cliArgs.push('--port', port.toString());
  if (options.tunnel && options.tunnel !== 'none') {
    cliArgs.push('--tunnel', options.tunnel);
  }
  cliArgs.push('--auth-token', token);
  if (options.allowFirstAdmin) {
    cliArgs.push('--allow-first-admin');
  }

  const binaryToRun = isGoRun ? 'go' : exePath;
  event.sender.send('remote:daemonLog', `[Lancement du daemon : ${binaryToRun} ${cliArgs.join(' ')}]\n`);

  daemonProcess = spawn(binaryToRun, cliArgs, {
    cwd: daemonDir,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: envPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  daemonProcess.stdout?.on('data', (data: Buffer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:daemonLog', data.toString());
    }
  });

  daemonProcess.stderr?.on('data', (data: Buffer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:daemonLog', data.toString());
    }
  });

  daemonProcess.on('close', (code: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:daemonLog', `\n[Daemon terminé avec le code ${code}]\n`);
    }
    daemonProcess = null;
  });

  daemonProcess.on('error', (err: Error) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:daemonLog', `\n[Erreur de lancement : ${err.message}]\n`);
    }
  });

  return { success: true, alreadyRunning: false, port, token };
});

ipcMain.handle('remote:stopDaemon', async (event) => {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch { /* ignore */ }
    daemonProcess = null;
  }
  killOrphanDaemonProcesses();
  event.sender.send('remote:daemonLog', `> Daemon arrêté manuellement.\n`);
  return { success: true };
});

ipcMain.handle('remote:openExternal', async (_event, url: string) => {
  try {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('ws://') || url.startsWith('wss://'))) {
      await shell.openExternal(url);
    }
  } catch (err) {
    console.error('Failed to open URL externally:', err);
  }
});

// ──────────────────────────────────────────
// App Lifecycle
// ──────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch { /* ignore */ }
    daemonProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch { /* ignore */ }
    daemonProcess = null;
  }
});
