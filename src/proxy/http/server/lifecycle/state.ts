import * as http from 'http';
import log from 'electron-log';
import {
  stateFilePath,
  loadOrInit as loadPersisted,
  fromFile as fromPersistedFile,
  applyBudgetPatch,
  applyBreakerPatch,
  gather as gatherPersisted,
  flush as flushPersisted,
} from '../../../state/local/persistedState';
import { CIRCUIT_BREAKER_RESET_MS } from '../../../resilience/circuit/circuitBreaker';
import { restoreRecentModels } from '../../../state/local/recentModelsStore';

export let server: http.Server | null = null;
export function setServerInstance(s: http.Server | null): void {
  server = s;
}
export function getServerInstance(): http.Server | null {
  return server;
}

export let proxyPort = 0;
export function setProxyPort(p: number): void {
  proxyPort = p;
}
export function getProxyPort(): number {
  return proxyPort;
}

export function isProxyRunning(): boolean {
  return !!server?.listening && proxyPort > 0;
}

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
