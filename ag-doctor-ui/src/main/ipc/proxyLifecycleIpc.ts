import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, execSync, execFile } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from '../../ipc/channels';
import { EnvironmentConfig } from '../../config/environment';
import { getProxyManager } from '../../proxy-manager';
import type { MainContext } from '../types';

export async function isPortInUse(port: number, host = EnvironmentConfig.bindHost): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net');
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, host);
  });
}

export function registerProxyLifecycleIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_START, async () => {
    try {
      const proxyManager = getProxyManager();
      return await proxyManager.start();
    } catch (err) {
      return { ok: false, message: `Failed to start proxy: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STOP, async () => {
    try {
      const proxyManager = getProxyManager();
      return await proxyManager.stop();
    } catch (err) {
      return { ok: false, message: `Failed to stop proxy: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STATUS, async () => {
    try {
      const proxyManager = getProxyManager();
      const status = await proxyManager.getStatus();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_RESTART, async () => {
    try {
      const proxyManager = getProxyManager();
      return await proxyManager.restart();
    } catch (err) {
      return { ok: false, message: `Failed to restart proxy: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_START_STUB, async () => {
    try {
      const stubPath = path.join(ctx.getCliPath(), '..', '..', 'scripts', 'proxy', 'proxy-stub.js');
      const resolved = path.resolve(stubPath);
      if (!fs.existsSync(resolved)) {
        return { ok: false, error: `proxy-stub.js not found at ${resolved}` };
      }
      const child = spawn(process.execPath, [resolved], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AG_STUB_PORT: String(EnvironmentConfig.stubPort) },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 200));
        const alive = await new Promise<boolean>((resolve) => {
          const req = require('http').request(
            { hostname: EnvironmentConfig.bindHost, port: EnvironmentConfig.stubPort, path: '/health', method: 'GET', timeout: 1000 },
            (res: { resume: () => void }) => { res.resume(); resolve(true); },
          );
          req.on('error', () => resolve(false));
          req.end();
        });
        if (alive) return { ok: true, pid: child.pid, port: EnvironmentConfig.stubPort };
      }
      return { ok: false, pid: child.pid, port: EnvironmentConfig.stubPort, error: 'started but port not yet open' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_CHECK_MAIN_PORT, async () => {
    try {
      const MAIN_PORT = EnvironmentConfig.proxyPort;
      const inUse = await isPortInUse(MAIN_PORT);
      if (inUse) {
        let processInfo = 'unknown';
        try {
          if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${MAIN_PORT}`, { encoding: 'utf-8', windowsHide: true });
            processInfo = out.trim().split('\n')[0] || 'unknown';
          } else {
            const out = execSync(`lsof -i :${MAIN_PORT} -P -n 2>/dev/null | tail -n +2 | head -n 1`, { encoding: 'utf-8' });
            processInfo = out.trim() || 'unknown';
          }
        } catch { /* best effort */ }
        return { ok: true, inUse: true, port: MAIN_PORT, process: processInfo };
      }
      return { ok: true, inUse: false, port: MAIN_PORT };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_KILL_MAIN_PORT, async () => {
    try {
      const MAIN_PORT = EnvironmentConfig.proxyPort;
      return await new Promise<{ ok: boolean; killed?: string; error?: string }>((resolve) => {
        if (process.platform === 'win32') {
          try {
            const netstatOut = execSync(`netstat -ano | findstr :${MAIN_PORT}`, { encoding: 'utf-8', windowsHide: true });
            const pids = new Set<string>();
            for (const l of netstatOut.trim().split('\n')) {
              const match = l.trim().match(/\s+(\d+)$/);
              if (match && match[1] && match[1] !== '0') pids.add(match[1]);
            }
            for (const pid of pids) {
              execFile('taskkill', ['/F', '/PID', pid], () => {});
            }
            resolve({ ok: true, killed: `PIDs: ${Array.from(pids).join(', ')}` });
          } catch (e) {
            resolve({ ok: false, error: (e as Error).message });
          }
        } else {
          const { exec } = require('child_process');
          exec(`lsof -ti :${MAIN_PORT} | xargs -r kill -9`, (err: Error | null, stdout: string) => {
            if (err) resolve({ ok: false, error: err.message });
            else resolve({ ok: true, killed: stdout.trim() || 'no process found' });
          });
        }
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.REPAIR_RUN, async () => {
    try {
      const isWin = process.platform === 'win32';
      const scriptName = isWin ? 'repair-all.ps1' : 'repair-all.sh';
      const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, scriptName)
        : path.join(__dirname, '..', '..', '..', 'resources', scriptName);

      if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: `Repair script not found at ${scriptPath}` };
      }

      const tempFile = isWin ? path.join(process.env.TEMP || '', 'ag-repair-result.json') : '/tmp/ag-repair-result.json';
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

      await new Promise<void>((resolve, reject) => {
        let proc;
        if (isWin) {
          proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"' -Verb RunAs -Wait -WindowStyle Hidden`], {
            windowsHide: true,
            stdio: 'ignore'
          });
        } else {
          proc = spawn('bash', [scriptPath], {
            stdio: 'ignore'
          });
        }

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Repair script exited with code ${code}`));
        });
        proc.on('error', reject);
      });

      if (fs.existsSync(tempFile)) {
        const data = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
        fs.unlinkSync(tempFile);
        const isOk = Boolean(data.proxy && data.ca);
        return { ok: isOk, ...data, ...(isOk ? {} : { error: !data.proxy && !data.ca ? 'Proxy and CA repair failed' : !data.proxy ? 'Proxy configuration failed' : 'CA installation failed' }) };
      }
      return { ok: false, proxy: false, ca: false, error: 'Result file not found (UAC prompt may have been declined)' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
