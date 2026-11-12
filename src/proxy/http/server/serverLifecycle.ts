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
} from '../../../constants';
import {
  loadCustomModels,
  getCustomModelsPath,
  getLastCustomModelsContentOnDisk,
  setLastCustomModelsContentOnDisk,
} from '../../models/modelLoader';
import { invalidateModelStoreCache } from '../../../services/storage/modelStore';
import {
  invalidateHealthCache,
  checkAllModelsHealth,
} from '../../resilience/pools/modelHealthChecker';
import { clearSessionAffinities } from '../../resilience/pools/sessionAffinities';
import {
  getAccountQuotaKey,
  verifyAndReconcileCooldowns,
  autoHealAccountOnQuotaRecovery,
  startPreflightHealthCheckInterval,
  stopPreflightHealthCheckInterval,
} from '../../resilience/pools/googlePool';
import {
  updateLiveAccountQuota,
  prewarmGoogleAccounts,
  pollAllGoogleQuotas,
} from '../../../services/auth/googleAuth';
import { loadPersistentQuotaCache } from '../../../services/storage/quotaCacheStore';
import { stopCleanupInterval, startCleanupInterval } from '../../core/shared';
import { resolveGoogleIp } from './dnsResolver';
import {
  stateFilePath,
  loadOrInit as loadPersisted,
  fromFile as fromPersistedFile,
  applyBudgetPatch,
  applyBreakerPatch,
  gather as gatherPersisted,
  flush as flushPersisted,
} from '../../state/persistedState';
import { CIRCUIT_BREAKER_RESET_MS } from '../../resilience/circuit/circuitBreaker';
import { restoreRecentModels } from '../../state/recentModelsStore';
import { disposeAll as disposeAgentPool, warmTlsConnection } from '../../resilience/pools/agentPool';

let server: http.Server | null = null;
let proxyPort = 0;

export function getServerInstance(): http.Server | null {
  return server;
}

export function isProxyRunning(): boolean {
  return !!server?.listening && proxyPort > 0;
}

// --- File Watcher for custom_models.json -----------------------------------

let customModelsWatcher: fs.FSWatcher | null = null;
let customModelsWatcherDebounce: NodeJS.Timeout | null = null;

export function setupCustomModelsWatcher(): void {
  try {
    const customModelsPath = getCustomModelsPath();
    const customModelsDir = path.dirname(customModelsPath);
    if (!fs.existsSync(customModelsDir)) {
      fs.mkdirSync(customModelsDir, { recursive: true });
    }

    try {
      if (fs.existsSync(customModelsPath)) {
        setLastCustomModelsContentOnDisk(fs.readFileSync(customModelsPath, 'utf-8'));
      }
    } catch (_) {}

    if (customModelsWatcher) {
      customModelsWatcher.close();
      customModelsWatcher = null;
    }

    customModelsWatcher = fs.watch(customModelsDir, (_eventType, filename) => {
      if (filename) {
        const baseName = path.basename(filename);
        if (baseName.endsWith('.tmp') || baseName.includes('.tmp.')) return;
        if (baseName === 'custom_models.json') {
          if (customModelsWatcherDebounce) clearTimeout(customModelsWatcherDebounce);
          customModelsWatcherDebounce = setTimeout(() => {
            try {
              if (fs.existsSync(customModelsPath)) {
                const current = fs.readFileSync(customModelsPath, 'utf-8');
                if (current === getLastCustomModelsContentOnDisk()) return;
                setLastCustomModelsContentOnDisk(current);
              }
            } catch (_) {}
            log.info('[Proxy] custom_models.json changed on disk. Invalidating model caches...');
            invalidateModelStoreCache();
            invalidateHealthCache();
            clearSessionAffinities();
            try {
              const models = loadCustomModels();
              if (models.length > 0) {
                for (const m of models) {
                  if (m.accountEmail && m.quotas) {
                    const key = getAccountQuotaKey(m);
                    updateLiveAccountQuota(key, m.quotas as any);
                  }
                }
                checkAllModelsHealth(models).catch(() => {});
                prewarmGoogleAccounts(models);
                pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery)
                  .then(() => {
                    verifyAndReconcileCooldowns(Date.now(), models);
                  })
                  .catch(() => {});
              }
            } catch (err) {
              log.warn('[Proxy] Failed to reload/health-check models after file change:', err);
            }
          }, 1000);
        }
      }
    });
  } catch (err) {
    log.warn('[Proxy] Failed to setup custom_models.json watcher:', err);
  }
}

export function stopCustomModelsWatcher(): void {
  if (customModelsWatcherDebounce) {
    clearTimeout(customModelsWatcherDebounce);
    customModelsWatcherDebounce = null;
  }
  if (customModelsWatcher) {
    try {
      customModelsWatcher.close();
    } catch {}
    customModelsWatcher = null;
  }
}

// --- Live Quota Polling Interval -------------------------------------------

let quotaPollTimer: NodeJS.Timeout | null = null;

export function startQuotaPollingInterval(intervalMs = 180_000): void {
  stopQuotaPollingInterval();
  try {
    const models = loadCustomModels();
    pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery)
      .then(() => {
        verifyAndReconcileCooldowns(Date.now(), models);
      })
      .catch((err) => {
        log.debug('[Proxy] Initial quota polling skipped:', err?.message || err);
      });
  } catch (_) {}

  quotaPollTimer = setInterval(() => {
    try {
      const models = loadCustomModels();
      pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery)
        .then(() => {
          verifyAndReconcileCooldowns(Date.now(), models);
        })
        .catch((err) => {
          log.debug('[Proxy] Quota polling tick skipped:', err?.message || err);
        });
    } catch (_) {}
  }, intervalMs);

  if (quotaPollTimer.unref) quotaPollTimer.unref();
}

export function stopQuotaPollingInterval(): void {
  if (quotaPollTimer) {
    clearInterval(quotaPollTimer);
    quotaPollTimer = null;
  }
  stopPreflightHealthCheckInterval();
}

// --- Persisted State Management ---------------------------------------------

export function loadPersistedState(): void {
  try {
    const p = stateFilePath();
    const file = loadPersisted(p);
    const { retryBudgetPatch, breakerPatch } = fromPersistedFile(
      file,
      Date.now(),
      CIRCUIT_BREAKER_RESET_MS,
    );
    applyBudgetPatch(retryBudgetPatch);
    applyBreakerPatch(breakerPatch);
    if (file.recentModels) {
      restoreRecentModels(file.recentModels);
    }
    log.info(
      `[Proxy] loaded persisted state: budget=${retryBudgetPatch.size} breakers=${breakerPatch.size}`,
    );
  } catch (err) {
    log.warn('[Proxy] could not restore persisted state:', err);
  }
}

export function flushPersistedState(opts: { force?: boolean } = {}): void {
  try {
    const p = stateFilePath();
    const file = gatherPersisted();
    const ok = flushPersisted(p, file);
    if (!ok && !opts.force) {
      return;
    }
  } catch (err) {
    log.warn('[Proxy] could not persist state:', err);
  }
}

// --- Server Start/Stop Orchestration ---------------------------------------

export type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export function startProxyServer(requestHandler: RequestHandler): Promise<number> {
  if (server?.listening && proxyPort > 0) {
    return Promise.resolve(proxyPort);
  }
  return new Promise((resolve, reject) => {
    try {
      server = http.createServer(requestHandler);

      server.keepAliveTimeout = 0;
      server.headersTimeout = 0;
      server.requestTimeout = 0;

      const envPort = parseInt(process.env.AG_PROXY_PORT || '', 10);
      const defaultPort = Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PROXY_PORT;
      const defaultHost = process.env.AG_PROXY_HOST || LOOPBACK_HOSTS[0];

      let primaryHost = defaultHost;
      const portCandidates: number[] = [defaultPort, 0];

      let attemptIdx = 0;
      let eaddrinuseRetries = 0;
      const MAX_PORT_RETRIES = 10;

      server.once('listening', () => {
        proxyPort = (server!.address() as import('net').AddressInfo).port;
        const requestedPort = portCandidates[attemptIdx];
        const isFallback = requestedPort !== defaultPort && requestedPort !== 0;
        const isDynamic = requestedPort === 0;
        if (isFallback) {
          log.warn(`[Proxy] Default port ${defaultPort} unavailable. Using fallback port ${proxyPort}.`);
          log.warn(`[Proxy] Set AG_PROXY_PORT=${proxyPort} in your environment to silence this warning.`);
        } else if (isDynamic) {
          log.warn(`[Proxy] All configured ports in use. Using OS-assigned dynamic port ${proxyPort}.`);
        } else {
          log.info(`[Proxy] Server listening on http://${primaryHost}:${proxyPort}`);
        }

        try {
          const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
          const portFile = path.join(home, ACTIVE_PORT_FILE);
          fs.mkdirSync(path.dirname(portFile), { recursive: true });
          fs.writeFileSync(portFile, String(proxyPort), 'utf-8');
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

        resolve(proxyPort);
      });

      const tryListen = (port: number, host: string): void => {
        if (!server || (server as any).listening) return;
        server.listen(port, host);
      };

      server.on('error', (err: NodeJS.ErrnoException) => {
        log.error(`[Proxy] Server error: code=${err.code} message=${err.message} syscall=${err.syscall || ''} address=${(err as any).address || ''} port=${(err as any).port || ''}`);
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
                    log.warn(`[Proxy] Detected proxy-stub (pid=${stubPid}) occupying primary port ${portCandidates[0]}. Terminating stub to reclaim port...`);
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
            log.warn(`[Proxy] Port ${triedPort} is already in use after retries. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
            attemptIdx += 1;
            tryListen(nextPort, primaryHost);
            return;
          }
        } else if (err.code === 'EACCES') {
          log.warn(`[Proxy] Permission denied binding to ${primaryHost}:${portCandidates[attemptIdx]}. Trying fallback ports...`);
          if (attemptIdx + 1 < portCandidates.length) {
            const triedPort = portCandidates[attemptIdx];
            const nextPort = portCandidates[attemptIdx + 1];
            log.warn(`[Proxy] Port ${triedPort} access denied. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
            attemptIdx += 1;
            tryListen(nextPort, primaryHost);
          } else {
            log.error(`[Proxy] Permission denied binding to ${primaryHost}:${portCandidates[attemptIdx]}. Try a different port (AG_PROXY_PORT) or run with sufficient privileges.`);
            reject(err);
          }
        } else {
          log.error('[Proxy] Startup failed:', err);
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
        server = null;
        proxyPort = 0;
        finish();
      });
    } else {
      finish();
    }
  });
}

export function getProxyPort(): number {
  return proxyPort;
}
