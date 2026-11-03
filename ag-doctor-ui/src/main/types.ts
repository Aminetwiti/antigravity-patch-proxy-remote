import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';
import type { CliWorkerPool } from './cliWorkerPool';

export interface ProxyErrorEntry {
  traceId: string;
  provider: string;
  status?: number;
  errorType: string;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
  at: number;
}

export interface MainContext {
  getMainWindow: () => BrowserWindow | null;
  createWindow: () => BrowserWindow;
  getCliPath: () => string;
  getConfigPath: () => string;
  getAssetsPath: () => string;
  getInfoPayload: () => Record<string, unknown>;
  getConfigPayload: () => Record<string, unknown>;
  invalidateConfigCache: () => void;
  updateTray: (status: 'ok' | 'warn' | 'err') => void;
  pushProxyErrorHistory: (entry: ProxyErrorEntry) => void;
  getProxyErrorHistory: () => ProxyErrorEntry[];
  notifyProxyError: (payload: { traceId: string; provider: string; title: string; message: string }) => void;
  activeStreams: Map<string, ChildProcess>;
  getCliPool: () => CliWorkerPool;
  checkAndNotifyOAuthIntercept: (chunk: string) => void;
}
