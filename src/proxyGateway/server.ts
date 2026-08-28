import * as http from 'http';
import log from 'electron-log';
import { createLogger } from '../shared/logger';

const gatewayLog = createLogger('Gateway');

let serverInstance: http.Server | null = null;
let currentPort = 0;

export function getGatewayPort(): number {
  return currentPort;
}

export function setGatewayServer(server: http.Server, port: number): void {
  serverInstance = server;
  currentPort = port;
  gatewayLog.info(`Proxy server registered on port ${port}`);
}

export function stopGatewayServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) {
      if (typeof (serverInstance as any).closeIdleConnections === 'function') {
        (serverInstance as any).closeIdleConnections();
      }
      serverInstance.close(() => {
        log.info('[Gateway] Server stopped successfully');
        serverInstance = null;
        currentPort = 0;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
