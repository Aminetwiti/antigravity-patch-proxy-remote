import {
  STREAM_RETRY_BASE_DELAY_MS,
  NON_STREAM_RETRY_BASE_DELAY_MS,
  RATE_LIMIT_RETRY_BASE_DELAY_MS,
  SERVER_ERROR_RETRY_BASE_DELAY_MS,
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_BACKOFF_JITTER_FACTOR,
} from '../constants';
import { calculateBackoffDelay, type BackoffConfig } from './backoff';

/**
 * Types of retry scenarios.
 */
export type RetryStrategy = 'stream-error' | 'server-error' | 'rate-limit';

/**
 * Result of computing a retry delay.
 */
export interface RetryDecision {
  /** Whether a retry should be attempted. */
  shouldRetry: boolean;
  /** Delay in milliseconds before the next attempt. */
  delayMs: number;
  /** The new retry count after this attempt. */
  nextRetryCount: number;
}

/**
 * Computes the retry delay for a given strategy.
 *
 * @param strategy Type of retry scenario
 * @param retryCount Current retry count (0-indexed)
 * @param retryAfterMs Delay from Retry-After header (0 if not present)
 * @returns Delay in milliseconds
 */
export function computeRetryDelay(
  strategy: RetryStrategy,
  retryCount: number,
  retryAfterMs: number,
): number {
  // Respect Retry-After header if present
  if (retryAfterMs > 0) return retryAfterMs;

  // Map strategy -> (initialDelayMs, maxDelayMs) pair.
  // The base * multiplier^retryCount is delegated to calculateBackoffDelay,
  // which adds AWS-style decorrelated jitter to prevent thundering-herd.
  const config = resolveBackoffConfig(strategy);

  return calculateBackoffDelay(retryCount, config);
}

/**
 * Internal: map a retry strategy to its (initial, max) delay bounds.
 *
 * - `stream-error`: small linear-feel base, low cap (stream snappiness wins).
 * - `server-error`: standard exponential, modest cap.
 * - `rate-limit`: longer base (server told us to back off), generous cap.
 */
function resolveBackoffConfig(strategy: RetryStrategy): BackoffConfig {
  switch (strategy) {
    case 'stream-error':
      return {
        initialDelayMs: STREAM_RETRY_BASE_DELAY_MS,
        maxDelayMs: STREAM_RETRY_BASE_DELAY_MS * 5,
        backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
        jitterFactor: RETRY_BACKOFF_JITTER_FACTOR,
      };
    case 'server-error':
      return {
        initialDelayMs: SERVER_ERROR_RETRY_BASE_DELAY_MS,
        maxDelayMs: SERVER_ERROR_RETRY_BASE_DELAY_MS * 16,
        backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
        jitterFactor: RETRY_BACKOFF_JITTER_FACTOR,
      };
    case 'rate-limit':
      return {
        initialDelayMs: RATE_LIMIT_RETRY_BASE_DELAY_MS,
        maxDelayMs: RATE_LIMIT_RETRY_BASE_DELAY_MS * 16,
        backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
        jitterFactor: RETRY_BACKOFF_JITTER_FACTOR,
      };
    default:
      return {
        initialDelayMs: NON_STREAM_RETRY_BASE_DELAY_MS,
        maxDelayMs: NON_STREAM_RETRY_BASE_DELAY_MS * 4,
        backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
        jitterFactor: RETRY_BACKOFF_JITTER_FACTOR,
      };
  }
}

/**
 * Determines whether a given status code is retryable.
 *
 * @param statusCode HTTP status code from upstream
 * @returns True if the status code is eligible for retry
 */
export function isRetryableStatus(statusCode: number): boolean {
  // 5xx server errors
  if (statusCode >= 500 && statusCode < 600) return true;
  // 429 rate limit
  if (statusCode === 429) return true;
  return false;
}

/**
 * Determines whether a retry should be attempted for a given status code.
 *
 * @param statusCode HTTP status code from upstream
 * @param retryCount Current retry count
 * @param maxRetries Maximum allowed retries
 * @returns True if retry should be attempted
 */
export function shouldRetryStatus(
  statusCode: number,
  retryCount: number,
  maxRetries: number,
): boolean {
  if (retryCount >= maxRetries) return false;
  return isRetryableStatus(statusCode);
}

/**
 * Inspects network errors (e.g. socket hang up, ETIMEDOUT, ECONNRESET, fetch failed)
 * to determine if a retry is warranted, examining causes recursively.
 * Inspired by vscode-unify-chat-provider network error handling.
 */
export function isRetryableNetworkError(error: unknown): boolean {
  if (!error) return false;

  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);

    // Check string representation or error code
    const code = typeof current === 'object' && current !== null && 'code' in current
      ? String((current as { code: unknown }).code).toUpperCase()
      : '';
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'].includes(code)) {
      return true;
    }

    const message = current instanceof Error
      ? current.message
      : typeof current === 'object' && current !== null && 'message' in current
        ? String((current as { message: unknown }).message)
        : String(current);

    const norm = message.toLowerCase();
    if (
      norm.includes('fetch failed') ||
      norm.includes('network error') ||
      norm.includes('connection timeout') ||
      norm.includes('socket hang up') ||
      norm.includes('other side closed') ||
      norm.includes('tls handshake timeout')
    ) {
      return true;
    }

    // Recurse into cause if present
    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause: unknown }).cause;
    } else {
      break;
    }
  }

  return false;
}

/**
 * Builds a complete retry decision for a given scenario.
 *
 * Phase 7.3: honours a wall-clock time-budget ceiling in addition to the
 * retry-count budget. If `timeBudget` is supplied and the elapsed time
 * since the request started is past the ceiling, we refuse the retry
 * — even if `maxRetries` has not been reached. This prevents
 * long-running outages (e.g. a flaky model returning 429 + Retry-After
 * forever) from quietly burning the user's session.
 */
export function buildRetryDecision(
  strategy: RetryStrategy,
  retryCount: number,
  maxRetries: number,
  retryAfterMs: number,
  timeBudget?: {
    startMs: number;
    nowMs: number;
    ceilingMs: number;
  },
): RetryDecision {
  if (retryCount >= maxRetries) {
    return { shouldRetry: false, delayMs: 0, nextRetryCount: retryCount };
  }
  if (timeBudget) {
    const elapsed = Math.max(0, timeBudget.nowMs - timeBudget.startMs);
    if (elapsed >= timeBudget.ceilingMs) {
      return { shouldRetry: false, delayMs: 0, nextRetryCount: retryCount };
    }
  }
  const delayMs = computeRetryDelay(strategy, retryCount, retryAfterMs);
  return {
    shouldRetry: true,
    delayMs,
    nextRetryCount: retryCount + 1,
  };
}
