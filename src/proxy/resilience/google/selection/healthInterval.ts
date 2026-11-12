import log from 'electron-log';
import { PREFLIGHT_HEALTH_CHECK_INTERVAL_MS } from '../../../../constants';
import { probeAllGoogleAccountsPreflight } from './preflightProbe';

let preflightTimer: NodeJS.Timeout | null = null;
let preflightBootTimer: NodeJS.Timeout | null = null;

export function startPreflightHealthCheckInterval(intervalMs = PREFLIGHT_HEALTH_CHECK_INTERVAL_MS): void {
  if (process.env.AG_ENABLE_PREFLIGHT === '0') {
    log.info('[PreFlight] Proactive health check probe disabled via AG_ENABLE_PREFLIGHT=0');
    return;
  }
  if (preflightTimer) {
    clearInterval(preflightTimer);
    preflightTimer = null;
  }
  if (preflightBootTimer) {
    clearTimeout(preflightBootTimer);
    preflightBootTimer = null;
  }

  preflightBootTimer = setTimeout(() => {
    probeAllGoogleAccountsPreflight().catch((err) => {
      log.debug('[PreFlight] Boot health check failed:', err?.message || err);
    });
  }, 3500);
  if (preflightBootTimer.unref) preflightBootTimer.unref();

  preflightTimer = setInterval(() => {
    probeAllGoogleAccountsPreflight().catch((err) => {
      log.debug('[PreFlight] Periodic health check tick failed:', err?.message || err);
    });
  }, intervalMs);
  if (preflightTimer.unref) preflightTimer.unref();
}

export function stopPreflightHealthCheckInterval(): void {
  if (preflightTimer) {
    clearInterval(preflightTimer);
    preflightTimer = null;
  }
  if (preflightBootTimer) {
    clearTimeout(preflightBootTimer);
    preflightBootTimer = null;
  }
}
