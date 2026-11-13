import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import {
  DEFAULT_PROXY_PORT,
  LOOPBACK_HOSTS,
  ACTIVE_PORT_FILE,
  GOOGLE_HOSTS,
} from '../../../../constants';
import { loadCustomModels } from '../../../models/catalog/modelLoader';
import {
  getAccountQuotaKey,
  verifyAndReconcileCooldowns,
  startPreflightHealthCheckInterval,
} from '../../../resilience/pools/googlePool';
import {
  updateLiveAccountQuota,
  prewarmGoogleAccounts,
} from '../../../../services/auth/googleAuth';
import { loadPersistentQuotaCache } from '../../../../services/storage/quotaCacheStore';
import { startCleanupInterval } from '../../../core/shared';
import { resolveGoogleIp } from '../dnsResolver';
import { warmTlsConnection } from '../../../resilience/pools/agentPool';
import {
  server,
  setServerInstance,
  proxyPort,
  setProxyPort,
  loadPersistedState,
} from './state';
import {
  setupCustomModelsWatcher,
  startQuotaPollingInterval,
} from './watchers';

export type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export function startProxyServer(requestHandler: RequestHandler): Promise<number> {
  if (server?.listening && proxyPort > 0) {
    return Promise.resolve(proxyPort);
  }
  return new Promise((resolve, reject) => {
    try {
      const srv = http.createServer(requestHandler);
      setServerInstance(srv);

      srv.keepAliveTimeout = 0;
      srv.headersTimeout = 0;
      srv.requestTimeout = 0;

      const envPort = parseInt(process.env.AG_PROXY_PORT || '', 10);
      const defaultPort = Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PROXY_PORT;
      const defaultHost = process.env.AG_PROXY_HOST || LOOPBACK_HOSTS[0];

      let primaryHost = defaultHost;
      const portCandidates: number[] = [defaultPort, 0];

      let attemptIdx = 0;
      let eaddrinuseRetries = 0;
      const MAX_PORT_RETRIES = 10;

      srv.once('listening', () => {
        const activePort = (srv.address() as import('net').AddressInfo).port;
        setProxyPort(activePort);
        const requestedPort = portCandidates[attemptIdx];
        const isFallback = requestedPort !== defaultPort && requestedPort !== 0;
        const isDynamic = requestedPort === 0;
        if (isFallback) {
          log.warn(`[Proxy] Default port ${defaultPort} unavailable. Using fallback port ${activePort}.`);
          log.warn(`[Proxy] Set AG_PROXY_PORT=${activePort} in your environment to silence this warning.`);
        } else if (isDynamic) {
          log.warn(`[Proxy] All configured ports in use. Using OS-assigned dynamic port ${activePort}.`);
        } else {
          log.info(`[Proxy] Server listening on http://${primaryHost}:${activePort}`);
        }

        try {
          const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
          const portFile = path.join(home, ACTIVE_PORT_FILE);
          fs.mkdirSync(path.dirname(portFile), { recursive: true });
          fs.writeFileSync(portFile, String(activePort), 'utf-8');
          log.debug(`[Proxy] Active port persisted to ${portFile}`);
        } catch (err) {
          log.warn('[Proxy] Could not persist active port:', (err as Error).message);
        }

        try {
          const models = loadCustomModels();
          loadPersistentQuotaCache()
            .then(() => {
              for (const m of models) {
                if (m.accountEmail && m.quotas) {
                  const key = getAccountQuotaKey(m);
                  updateLiveAccountQuota(key, m.quotas as any);
                }
              }
              verifyAndReconcileCooldowns(Date.now(), models);
            })
            .catch(() => {});
          startCleanupInterval();
          startQuotaPollingInterval();
          startPreflightHealthCheckInterval();
          setupCustomModelsWatcher();
          prewarmGoogleAccounts(models);
          resolveGoogleIp(GOOGLE_HOSTS.CLOUD_CODE).catch(() => {});
          try {
            warmTlsConnection(GOOGLE_HOSTS.CLOUD_CODE);
            warmTlsConnection('daily-cloudcode-pa.googleapis.com');
            warmTlsConnection('generativelanguage.googleapis.com');
          } catch (_) {}
        } catch (err) {
          log.error('[Proxy] Failed to start cleanup interval / pre-warm:', err);
        }

        resolve(activePort);
      });

      const tryListen = (port: number, host: string): void => {
        if (!srv || (srv as any).listening) return;
        srv.listen(port, host);
      };

      srv.on('error', (err: NodeJS.ErrnoException) => {
        log.error(`[Proxy] Server error: code=${err.code} message=${err.message}`);
        if (err.code === 'EADDRINUSE') {
          if (attemptIdx === 0 && eaddrinuseRetries < MAX_PORT_RETRIES) {
            eaddrinuseRetries += 1;
            log.warn(`[Proxy] Port ${portCandidates[0]} busy (EADDRINUSE), probing port owner (${eaddrinuseRetries}/${MAX_PORT_RETRIES})...`);

            const probeAndEvictStub = (callback: () => void) => {
              const probeReq = http.get(`http://${primaryHost}:${portCandidates[0]}/health`, { timeout: 300 }, (probeRes) => {
                let body = '';
                probeRes.on('data', (chunk) => { body += chunk; });
                probeRes.on('end', () => {
                  const isStubHeader = probeRes.headers['x-proxy-stub'] === '1';
                  let stubPid: number | null = null;
                  try {
                    const parsed = JSON.parse(body);
                    if (parsed.stub || isStubHeader) {
                      stubPid = typeof parsed.pid === 'number' ? parsed.pid : null;
                    }
                  } catch (_) {}

                  if (isStubHeader || stubPid) {
                    log.warn(`[Proxy] Detected proxy-stub (pid=${stubPid}) occupying primary port ${portCandidates[0]}. Terminating stub...`);
                    if (stubPid && stubPid !== process.pid) {
                      try {
                        process.kill(stubPid, 'SIGKILL');
                      } catch (_) {
                        try { process.kill(stubPid); } catch (_) {}
                      }
                    }
                  }
                  setTimeout(callback, 250);
                });
              });
              probeReq.on('error', () => { setTimeout(callback, 350); });
              probeReq.on('timeout', () => { probeReq.destroy(); setTimeout(callback, 350); });
            };

            probeAndEvictStub(() => {
              tryListen(portCandidates[0], primaryHost);
            });
            return;
          }
          if (attemptIdx + 1 < portCandidates.length) {
            const triedPort = portCandidates[attemptIdx];
            const nextPort = portCandidates[attemptIdx + 1];
            log.warn(`[Proxy] Port ${triedPort} is already in use. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
            attemptIdx += 1;
            tryListen(nextPort, primaryHost);
            return;
          }
        } else if (err.code === 'EACCES') {
          log.warn(`[Proxy] Permission denied binding to ${primaryHost}:${portCandidates[attemptIdx]}.`);
          if (attemptIdx + 1 < portCandidates.length) {
            const triedPort = portCandidates[attemptIdx];
            const nextPort = portCandidates[attemptIdx + 1];
            attemptIdx += 1;
            tryListen(nextPort, primaryHost);
          } else {
            reject(err);
          }
        } else {
          reject(err);
        }
      });

      loadPersistedState();
      tryListen(portCandidates[0], primaryHost);
    } catch (err) {
      log.error('[Proxy] Unexpected error during startProxy:', err);
      reject(err);
    }
  });
}
