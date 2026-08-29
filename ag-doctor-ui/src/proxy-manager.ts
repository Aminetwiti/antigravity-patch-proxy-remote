/**
 * MITM Proxy Server Manager
 * 
 * Manages the lifecycle of the MITM proxy server:
 * - Start/stop the proxy server process
 * - Monitor server health
 * - Handle errors and automatic restarts
 */

import { BrowserWindow } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import net from 'net';
import { EnvironmentConfig } from './config/environment';
import log from 'electron-log';

export interface ProxyServerStatus {
  running: boolean;
  port: number;
  pid?: number;
  error?: string;
}

class ProxyManager {
  private proxyProcess: ChildProcess | null = null;
  private port: number = EnvironmentConfig.proxyPort;
  private host: string = EnvironmentConfig.bindHost;
  private scriptPath: string;
  
  constructor() {
    // Path to the MITM proxy script
    this.scriptPath = path.join(__dirname, '..', '..', 'scripts', 'mitm', 'mitm_443.js');
  }

  /**
   * Check if the proxy server is listening on the configured port
   */
  async isListening(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Get the current status of the proxy server
   */
  async getStatus(): Promise<ProxyServerStatus> {
    const running = this.proxyProcess !== null && this.proxyProcess.exitCode === null;
    const listening = await this.isListening();
    
    return {
      running: running && listening,
      port: this.port,
      pid: this.proxyProcess?.pid,
      error: running && !listening ? 'Server process running but not listening' : undefined,
    };
  }

  /**
   * Start the proxy server
   */
  async start(): Promise<{ ok: boolean; message: string; pid?: number }> {
    log.info('[ProxyManager] Starting proxy server...');
    
    // Check if already running
    if (this.proxyProcess && this.proxyProcess.exitCode === null) {
      const listening = await this.isListening();
      if (listening) {
        return { 
          ok: true, 
          message: 'Proxy server already running', 
          pid: this.proxyProcess.pid 
        };
      }
    }

    return new Promise((resolve) => {
      try {
        log.info(`[ProxyManager] Spawning: node "${this.scriptPath}"`);
        
        // Environment variables for the proxy script
        const env = {
          ...process.env,
          AG_MITM_PORT: String(this.port),
          AG_MITM_HOST: this.host,
          AG_PROXY_TARGET: EnvironmentConfig.proxyTarget,
        };

        // Spawn the proxy server process
        this.proxyProcess = spawn('node', [this.scriptPath], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true,
        });

        const pid = this.proxyProcess.pid;
        log.info(`[ProxyManager] Spawned proxy process with PID: ${pid}`);

        // Capture stdout — MITM uses this channel to emit one JSON line per
        // intercepted request (`kind: 'mitm:traffic'`). We fan it out to every
        // BrowserWindow as `mitm:traffic` IPC so the Traffic Inspector view can
        // paint in real time. Non-JSON lines are passed through to the console.
        this.proxyProcess.stdout?.on('data', (data) => {
          const output = data.toString();
          for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('{')) {
              try {
                const payload = JSON.parse(trimmed);
                if (payload && payload.kind === 'mitm:traffic') {
                  for (const win of BrowserWindow.getAllWindows()) {
                    if (!win.isDestroyed()) win.webContents.send('mitm:traffic', payload);
                  }
                  continue;
                }
              } catch {
                // Not valid JSON — fall through to the console log below.
              }
            }
            log.info(`[ProxyServer] ${trimmed}`);
          }
        });

        // Capture stderr — the proxy uses this channel to emit structured
        // JSON proxy errors (one per line) so the tray/renderer can react.
        this.proxyProcess.stderr?.on('data', (data) => {
          const output = data.toString().trim();
          log.error(`[ProxyServer] ERROR: ${output}`);
          for (const line of output.split('\n')) {
            if (!line.startsWith('{')) continue;
            try {
              const payload = JSON.parse(line);
              if (payload && payload.provider && payload.title) {
                for (const win of BrowserWindow.getAllWindows()) {
                  if (!win.isDestroyed()) win.webContents.send('proxy:error', payload);
                }
              }
            } catch {
              // Not JSON — leave it for the console log.
            }
          }
        });

        // Handle process exit
        this.proxyProcess.on('exit', (code, signal) => {
          log.info(`[ProxyManager] Proxy process exited with code ${code}, signal ${signal}`);
          this.proxyProcess = null;
        });

        // Handle process errors
        this.proxyProcess.on('error', (err) => {
          log.error('[ProxyManager] Failed to start proxy process:', err);
          this.proxyProcess = null;
          resolve({ 
            ok: false, 
            message: `Failed to start proxy: ${err.message}` 
          });
        });

        // Wait a moment for the server to start listening
        setTimeout(async () => {
          const listening = await this.isListening();
          if (listening) {
            resolve({ 
              ok: true, 
              message: `Proxy server started on ${this.host}:${this.port}`, 
              pid 
            });
          } else {
            resolve({ 
              ok: false, 
              message: 'Proxy server started but not listening on expected port' 
            });
          }
        }, 1500);

      } catch (err) {
        log.error('[ProxyManager] Exception starting proxy:', err);
        resolve({ 
          ok: false, 
          message: `Failed to start proxy: ${(err as Error).message}` 
        });
      }
    });
  }

  /**
   * Stop the proxy server
   */
  async stop(): Promise<{ ok: boolean; message: string }> {
    log.info('[ProxyManager] Stopping proxy server...');
    
    if (!this.proxyProcess || this.proxyProcess.exitCode !== null) {
      return { ok: true, message: 'Proxy server not running' };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.proxyProcess && this.proxyProcess.exitCode === null) {
          log.info('[ProxyManager] Force killing proxy process');
          this.proxyProcess.kill('SIGKILL');
        }
        resolve({ ok: true, message: 'Proxy server force stopped' });
      }, 5000);

      this.proxyProcess!.once('exit', () => {
        clearTimeout(timeout);
        this.proxyProcess = null;
        log.info('[ProxyManager] Proxy server stopped gracefully');
        resolve({ ok: true, message: 'Proxy server stopped' });
      });

      // Try graceful shutdown first
      this.proxyProcess!.kill('SIGTERM');
    });
  }

  /**
   * Restart the proxy server
   */
  async restart(): Promise<{ ok: boolean; message: string }> {
    log.info('[ProxyManager] Restarting proxy server...');
    const stopResult = await this.stop();
    if (!stopResult.ok) {
      return stopResult;
    }
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return this.start();
  }

  /**
   * Clean up resources on shutdown
   */
  cleanup(): void {
    if (this.proxyProcess && this.proxyProcess.exitCode === null) {
      log.info('[ProxyManager] Cleanup: killing proxy process');
      this.proxyProcess.kill('SIGKILL');
      this.proxyProcess = null;
    }
  }
}

// Singleton instance
let proxyManagerInstance: ProxyManager | null = null;

export function getProxyManager(): ProxyManager {
  if (!proxyManagerInstance) {
    proxyManagerInstance = new ProxyManager();
  }
  return proxyManagerInstance;
}
