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
 * Regex for duration strings (e.g. "1.5s", "200ms", "4m 12s", "1h")
 */
const DURATION_RE = /([\d.]+)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)/gi;

const TEXT_DELAY_PATTERNS = [
  /quota will reset after ([^.,;\]\n]+)/i,
  /quota will reset in ([^.,;\]\n]+)/i,
  /retry after ([^.,;\]\n]+)/i,
  /reset after ([^.,;\]\n]+)/i,
  /try again in ([^.,;\]\n]+)/i,
  /backoff for ([^.,;\]\n]+)/i,
  /(?:^|[\s(])wait\s+([^,;\]\n)]+)/i,
];

const RETRY_HINT_KEYS = new Set([
  'retryafter',
  'retry_after',
  'retrydelay',
  'retry_delay',
  'quotaresetdelay',
  'quota_reset_delay',
  'backofflimit',
  'backoff_limit',
]);

/**
 * Parses duration string into milliseconds (e.g. "1.5s" -> 1500, "2m 10s" -> 130000).
 */
export function parseDurationMs(durationStr: string): number | null {
  if (!durationStr || typeof durationStr !== 'string') return null;
  let totalMs = 0;
  let matched = false;

  const re = new RegExp(DURATION_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(durationStr)) !== null) {
    matched = true;
    const value = parseFloat(match[1]);
    if (isNaN(value)) continue;
    const unit = match[2].toLowerCase();

    if (unit === 'ms' || unit.startsWith('millisecond')) {
      totalMs += value;
    } else if (unit === 's' || unit.startsWith('sec') || unit.startsWith('second')) {
      totalMs += value * 1000;
    } else if (unit === 'm' || unit.startsWith('min') || unit.startsWith('minute')) {
      totalMs += value * 60 * 1000;
    } else if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) {
      totalMs += value * 60 * 60 * 1000;
    }
  }

  return matched ? Math.round(totalMs) : null;
}

/**
 * Recursively inspects JSON objects for known retry delay hint keys or Google duration format {seconds, nanos}.
 */
function extractStructuredDelay(val: unknown, depth = 0): number | null {
  if (!val || depth > 8) return null;

  if (typeof val === 'object') {
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = extractStructuredDelay(item, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }

    const obj = val as Record<string, unknown>;

    // Google protobuf duration format: { seconds: 1, nanos: 0 }
    if ('seconds' in obj || 'nanos' in obj) {
      const secs = Number(obj.seconds || obj.Seconds || 0);
      const nanos = Number(obj.nanos || obj.Nanos || 0);
      if (secs > 0 || nanos > 0) {
        return Math.round(secs * 1000 + nanos / 1_000_000);
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      const normKey = k.toLowerCase().replace(/[-_]/g, '');
      if (RETRY_HINT_KEYS.has(normKey)) {
        if (typeof v === 'string') {
          const parsed = parseDurationMs(v);
          if (parsed !== null) return parsed;
        } else if (typeof v === 'number' && v > 0) {
          return v > 1000 ? Math.round(v) : Math.round(v * 1000);
        } else if (typeof v === 'object' && v !== null) {
          const parsed = extractStructuredDelay(v, depth + 1);
          if (parsed !== null) return parsed;
        }
      }

      const child = extractStructuredDelay(v, depth + 1);
      if (child !== null) return child;
    }
  }
  return null;
}

/**
 * Extracts exact retry delay in milliseconds from HTTP 429 error bodies
 * (either structured JSON metadata from Google/OpenAI or natural language text).
 */
export function parseRetryDelayFromError(errorBody: string | unknown): number | null {
  if (!errorBody) return null;

  let text = typeof errorBody === 'string' ? errorBody : '';
  if (typeof errorBody === 'object') {
    const struct = extractStructuredDelay(errorBody);
    if (struct !== null) return struct;
    try {
      text = JSON.stringify(errorBody);
    } catch {
      return null;
    }
  }

  // Try parsing JSON string first
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(text);
      const struct = extractStructuredDelay(parsedJson);
      if (struct !== null) return struct;
    } catch {}
  }

  // Scan natural text patterns
  for (const pat of TEXT_DELAY_PATTERNS) {
    const m = pat.exec(text);
    if (m && m[1]) {
      const ms = parseDurationMs(m[1]);
      if (ms !== null) return ms;
    }
  }

  return null;
}

/**
 * Computes the retry delay for a given strategy.
 *
 * @param strategy Type of retry scenario
 * @param retryCount Current retry count (0-indexed)
 * @param retryAfterMs Delay from Retry-After header or parsed error body (0 if not present)
 * @param errorBody Optional raw error body to extract fine-grained retry delay
 * @returns Delay in milliseconds
 */
export function computeRetryDelay(
  strategy: RetryStrategy,
  retryCount: number,
  retryAfterMs: number,
  errorBody?: string | unknown,
): number {
  // Respect explicit Retry-After header or parsed body delay
  if (retryAfterMs > 0) return retryAfterMs;

  if (errorBody) {
    const parsedBodyDelay = parseRetryDelayFromError(errorBody);
    if (parsedBodyDelay !== null && parsedBodyDelay > 0) {
      // Add 250ms buffer to ensure provider lock window has expired
      return parsedBodyDelay + 250;
    }
  }

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
  errorBody?: string | unknown,
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
  const delayMs = computeRetryDelay(strategy, retryCount, retryAfterMs, errorBody);
  return {
    shouldRetry: true,
    delayMs,
    nextRetryCount: retryCount + 1,
  };
}
