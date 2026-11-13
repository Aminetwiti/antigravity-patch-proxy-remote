import log from 'electron-log';
import { stopCleanupInterval } from '../../../core/shared';
import { disposeAll as disposeAgentPool } from '../../../resilience/pools/agentPool';
import {
  server,
  setServerInstance,
  setProxyPort,
  flushPersistedState,
} from './state';
import {
  stopCustomModelsWatcher,
  stopQuotaPollingInterval,
} from './watchers';

export function stopProxyServer(): Promise<void> {
  return new Promise((resolve) => {
    stopCleanupInterval();
    stopQuotaPollingInterval();
    stopCustomModelsWatcher();

    const finish = (): void => {
      flushPersistedState({ force: true });
      disposeAgentPool()
        .then(() => resolve())
        .catch((err) => {
          log.warn('[Proxy] Agent pool dispose error (non-fatal):', err);
          resolve();
        });
    };

    if (server) {
      if (typeof (server as any).closeIdleConnections === 'function') {
        (server as any).closeIdleConnections();
      }
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      server.close(() => {
        log.info('[Proxy] Server stopped');
        setServerInstance(null);
        setProxyPort(0);
        finish();
      });
    } else {
      finish();
    }
  });
}
