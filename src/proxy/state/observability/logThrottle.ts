/**
 * Throttled logger to prevent log flooding.
 * Deduplicates identical log messages within a configurable time window,
 * dramatically reducing noise from repeated errors (e.g., cache refresh
 * failures that fire 20+ identical lines per second).
 */

import log from 'electron-log';

interface ThrottleEntry {
  count: number;
  lastTime: number;
}

const recentMessages = new Map<string, ThrottleEntry>();

/** Time window in ms during which duplicate messages are suppressed. */
const THROTTLE_WINDOW_MS = 10_000; // 10 seconds

/** Periodic cleanup interval to prevent memory leaks from stale entries. */
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the periodic cleanup of stale throttle entries.
 * Safe to call multiple times — only one timer will be active.
 */
function ensureCleanupRunning(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of recentMessages) {
      if (now - entry.lastTime > THROTTLE_WINDOW_MS * 3) {
        recentMessages.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is running
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Logs a warning, suppressing duplicates within the throttle window.
 * When the window expires, emits a summary line with the repeat count.
 *
 * @param tag   Log tag (e.g., 'CacheRefresh', 'ProtoInjector')
 * @param message  The warning message
 */
export function throttledWarn(tag: string, message: string): void {
  ensureCleanupRunning();

  const key = `${tag}:${message}`;
  const now = Date.now();
  const entry = recentMessages.get(key);

  if (entry && now - entry.lastTime < THROTTLE_WINDOW_MS) {
    entry.count++;
    return; // Suppress duplicate
  }

  // Emit summary for previous burst, if any
  if (entry && entry.count > 1) {
    log.warn(`[${tag}] (suppressed ${entry.count - 1} duplicates) ${message}`);
  } else {
    log.warn(`[${tag}] ${message}`);
  }

  recentMessages.set(key, { count: 1, lastTime: now });
}

/**
 * Logs an error, suppressing duplicates within the throttle window.
 *
 * @param tag   Log tag
 * @param message  The error message
 */
export function throttledError(tag: string, message: string): void {
  ensureCleanupRunning();

  const key = `E:${tag}:${message}`;
  const now = Date.now();
  const entry = recentMessages.get(key);

  if (entry && now - entry.lastTime < THROTTLE_WINDOW_MS) {
    entry.count++;
    return;
  }

  if (entry && entry.count > 1) {
    log.error(`[${tag}] (suppressed ${entry.count - 1} duplicates) ${message}`);
  } else {
    log.error(`[${tag}] ${message}`);
  }

  recentMessages.set(key, { count: 1, lastTime: now });
}

/**
 * Stops the cleanup timer. Call during shutdown.
 */
export function stopThrottleCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  recentMessages.clear();
}
