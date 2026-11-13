import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import {
  loadCustomModels,
  getCustomModelsPath,
  getLastCustomModelsContentOnDisk,
  setLastCustomModelsContentOnDisk,
} from '../../../models/catalog/modelLoader';
import { invalidateModelStoreCache } from '../../../../services/storage/modelStore';
import {
  invalidateHealthCache,
  checkAllModelsHealth,
} from '../../../resilience/pools/modelHealthChecker';
import { clearSessionAffinities } from '../../../resilience/pools/sessionAffinities';
import {
  getAccountQuotaKey,
  verifyAndReconcileCooldowns,
  autoHealAccountOnQuotaRecovery,
  stopPreflightHealthCheckInterval,
} from '../../../resilience/pools/googlePool';
import {
  updateLiveAccountQuota,
  prewarmGoogleAccounts,
  pollAllGoogleQuotas,
} from '../../../../services/auth/googleAuth';

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
