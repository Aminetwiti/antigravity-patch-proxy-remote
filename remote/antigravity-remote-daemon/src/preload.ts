import { contextBridge, ipcRenderer } from 'electron';

export interface DaemonStartOptions {
  port: number;
  tunnel: string;
  token: string;
  allowFirstAdmin?: boolean;
}

export interface DaemonStatus {
  running: boolean;
  port?: number;
  token?: string;
  publicUrl?: string;
  pid?: number;
  telemetry?: {
    clients?: number;
    sessions?: number;
    uptime?: string;
  };
}

const agRemoteApi = {
  startDaemon: (options: DaemonStartOptions): Promise<any> =>
    ipcRenderer.invoke('remote:startDaemon', options),

  stopDaemon: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('remote:stopDaemon'),

  getDaemonStatus: (port?: number, token?: string): Promise<DaemonStatus> =>
    ipcRenderer.invoke('remote:getDaemonStatus', port, token),

  generateQr: (text: string): Promise<string> =>
    ipcRenderer.invoke('remote:generateQr', text),

  getLocalIp: (): Promise<string> =>
    ipcRenderer.invoke('remote:getLocalIp'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('remote:openExternal', url),

  onDaemonLog: (callback: (data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('remote:daemonLog', handler);
    return () => {
      ipcRenderer.removeListener('remote:daemonLog', handler);
    };
  },
};

contextBridge.exposeInMainWorld('agRemote', agRemoteApi);
