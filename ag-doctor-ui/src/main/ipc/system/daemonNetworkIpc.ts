import { app, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';
import { EnvironmentConfig } from '../../../config/environment';
import type { MainContext } from '../../types';

let daemonProcess: ChildProcess | null = null;

export function isValidDaemonPort(val: any): boolean {
  const p = Number(val);
  return Number.isInteger(p) && p >= 1024 && p <= 65535;
}

export function getPhysicalLanIp(): string {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const virtualNameRegex = /vethernet|wsl|docker|virtualbox|vbox|vmware|tap|tun|loopback|npcap|hyper-v|tailscale|zerotier/i;

  const isVirtualIp = (ip: string): boolean => {
    if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) return true;
    if (ip.startsWith('192.168.56.') || ip.startsWith('192.168.152.') || ip.startsWith('192.168.233.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  };

  for (const name of Object.keys(interfaces)) {
    if (virtualNameRegex.test(name)) continue;
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !isVirtualIp(iface.address)) {
        return iface.address;
      }
    }
  }

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.') && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }

  return EnvironmentConfig.bindHost || '127.0.0.1';
}

export function getDaemonExePath(): string {
  const resPath = (process as any).resourcesPath;
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : null;
  const candidates = [
    ...(resPath ? [path.join(resPath, 'remote', 'daemon', 'daemon.exe')] : []),
    ...(appPath ? [
      path.join(appPath, '..', 'remote', 'daemon', 'daemon.exe'),
      path.join(appPath, 'remote', 'daemon', 'daemon.exe'),
    ] : []),
    path.join(__dirname, '..', '..', '..', '..', '..', 'remote', 'daemon', 'daemon.exe'),
    path.join(__dirname, '..', '..', '..', 'remote', 'daemon', 'daemon.exe'),
    path.join(process.cwd(), 'remote', 'daemon', 'daemon.exe'),
    path.join(process.cwd(), '..', 'remote', 'daemon', 'daemon.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.normalize(c);
  }
  return path.normalize(candidates[0] || path.join(process.cwd(), 'remote', 'daemon', 'daemon.exe'));
}

export function killOrphanDaemonProcesses(port?: number): void {
  try {
    if (port && isValidDaemonPort(port)) {
      execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr ":${port}" ^| findstr LISTENING') do taskkill /F /PID %a 2>nul`,
        { stdio: 'ignore', windowsHide: true, shell: 'cmd.exe' }
      );
    }
  } catch { /* ignore */ }
}

export function cleanupDaemonProcess(): void {
  if (daemonProcess) {
    try { daemonProcess.kill(); } catch { /* ignore */ }
    daemonProcess = null;
  }
  try {
    killOrphanDaemonProcesses();
  } catch { /* ignore */ }
}

export function registerDaemonNetworkIpc(_ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GET_LOCAL_IP, async () => {
    return getPhysicalLanIp();
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GENERATE_QR, async (_event, text: string) => {
    const qrcode = require('qrcode');
    try {
      const dataUrl = await qrcode.toDataURL(text, { width: 256, margin: 2, color: { dark: '#000000FF', light: '#FFFFFFFF' } });
      return dataUrl;
    } catch (e: any) {
      throw new Error('Failed to generate QR code: ' + e.message);
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GET_DAEMON_STATUS, async (_event, customPort?: number, token?: string) => {
    const rawPort = Number(customPort);
    const port = isValidDaemonPort(rawPort) ? rawPort : (EnvironmentConfig.daemonPort || 8090);
    const authToken = (typeof token === 'string' && token.trim().length > 0)
      ? token.trim()
      : EnvironmentConfig.daemonToken;
    if (!authToken) {
      return { running: false, port, error: 'Daemon auth token is required' };
    }
    let running = false;
    let diagData: any = {};
    let healthData: any = {};

    try {
      const res = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health/diagnostic?token=${encodeURIComponent(authToken)}`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        diagData = await res.json();
        running = true;
      }
    } catch { /* offline */ }

    try {
      const hRes = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(1500),
      });
      if (hRes.ok) {
        healthData = await hRes.json();
        running = true;
      }
    } catch { /* ignore */ }

    return { running, port, ...diagData, telemetry: healthData };
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_START_DAEMON, async (event, options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }) => {
    const rawPort = Number(options?.port);
    const port = isValidDaemonPort(rawPort) ? rawPort : (EnvironmentConfig.daemonPort || 8090);
    const token = (typeof options?.token === 'string' && options.token.trim().length > 0)
      ? options.token.trim()
      : EnvironmentConfig.daemonToken;
    if (!token) {
      return { success: false, error: 'Daemon auth token is required' };
    }

    try {
      const res = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health/diagnostic?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data: any = await res.json();
        event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `> Daemon déjà actif et opérationnel sur le port ${port} (PID ${data.pid || 'actif'})\n`);
        if (data.publicUrl) {
          event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `🚀 Tunnel public actif : ${data.publicUrl}\n`);
        }
        return { success: true, alreadyRunning: true, port, token, ...data };
      }
    } catch { /* Daemon non démarré sur ce port */ }

    if (daemonProcess) {
      try { daemonProcess.kill(); } catch { /* ignore */ }
      daemonProcess = null;
    }

    killOrphanDaemonProcesses(port);

    const daemonExePath = getDaemonExePath();
    if (!fs.existsSync(daemonExePath)) {
      const errMsg = `Binaire daemon introuvable: ${daemonExePath}`;
      console.error(`[Remote Daemon] ${errMsg}`);
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `[Erreur: ${errMsg}]\n`);
      return { success: false, error: errMsg };
    }

    const args = ['--port', port.toString()];
    const allowedTunnels = ['pinggy', 'cloudflare', 'pangolin', 'ngrok'];
    if (options?.tunnel && allowedTunnels.includes(options.tunnel)) {
      args.push('--tunnel', options.tunnel);
    }
    if (options?.allowFirstAdmin) {
      args.push('--allow-first-admin');
    }

    const daemonDir = path.dirname(daemonExePath);
    const daemonBinDir = path.join(daemonDir, 'bin');
    const envPath = `${daemonDir}${path.delimiter}${daemonBinDir}${path.delimiter}${process.env.PATH || ''}`;

    try {
      daemonProcess = spawn(daemonExePath, args, {
        cwd: daemonDir,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: envPath,
          AG_AUTH_TOKEN: token,
          AG_DAEMON_AUTH_TOKEN: token,
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err: any) {
      console.error('[Remote Daemon] Spawn failure:', err);
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `[Erreur d'exécution du daemon: ${err.message}]\n`);
      return { success: false, error: err.message };
    }

    daemonProcess.on('error', (err: Error) => {
      console.error('[Remote Daemon] Process error:', err);
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `[Erreur processus daemon: ${err.message}]\n`);
      daemonProcess = null;
    });

    daemonProcess.stdout?.on('data', (data: Buffer) => {
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, data.toString());
    });

    daemonProcess.stderr?.on('data', (data: Buffer) => {
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, data.toString());
    });

    daemonProcess.on('close', (code: number) => {
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `[Daemon terminé avec le code ${code}]\n`);
      daemonProcess = null;
    });

    return { success: true, alreadyRunning: false, port, token };
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_STOP_DAEMON, async (event, customPort?: number) => {
    if (daemonProcess) {
      try { daemonProcess.kill(); } catch { /* ignore */ }
      daemonProcess = null;
    }
    const rawPort = Number(customPort);
    const port = isValidDaemonPort(rawPort) ? rawPort : (EnvironmentConfig.daemonPort || 8090);
    killOrphanDaemonProcesses(port);
    event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `> Daemon arrêté manuellement.\n`);
    return { success: true };
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    try {
      if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked unsafe external URL opening attempt: ${url}`);
      }
    } catch (err) {
      console.error('[IPC] Failed to open external URL:', err);
    }
  });
}
