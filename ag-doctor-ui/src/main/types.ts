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

/**
 * ISP (Interface Segregation Principle):
 * Context separated into granular role-based contracts.
 */
export interface IWindowContext {
  getMainWindow: () => BrowserWindow | null;
  createWindow: () => BrowserWindow;
}

export interface IPathContext {
  getCliPath: () => string;
  getConfigPath: () => string;
  getAssetsPath: () => string;
}

export interface IConfigContext {
  getInfoPayload: () => Record<string, unknown>;
  getConfigPayload: () => Record<string, unknown>;
  invalidateConfigCache: () => void;
}

export interface ITrayContext {
  updateTray: (status: 'ok' | 'warn' | 'err') => void;
  pushProxyErrorHistory: (entry: ProxyErrorEntry) => void;
  getProxyErrorHistory: () => ProxyErrorEntry[];
  notifyProxyError: (payload: { traceId: string; provider: string; title: string; message: string }) => void;
}

export interface IExecutionContext {
  activeStreams: Map<string, ChildProcess>;
  getCliPool: () => CliWorkerPool;
  checkAndNotifyOAuthIntercept: (chunk: string) => void;
}

/**
 * Composite MainContext for full backward compatibility.
 */
export interface MainContext
  extends IWindowContext,
    IPathContext,
    IConfigContext,
    ITrayContext,
    IExecutionContext {}
