interface AgRemoteApi {
  startDaemon: (options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }) => Promise<any>;
  stopDaemon: () => Promise<{ success: boolean }>;
  getDaemonStatus: (port?: number, token?: string) => Promise<any>;
  generateQr: (text: string) => Promise<string>;
  getLocalIp: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  onDaemonLog: (callback: (data: string) => void) => () => void;
}

interface Window {
  agRemote: AgRemoteApi;
}
