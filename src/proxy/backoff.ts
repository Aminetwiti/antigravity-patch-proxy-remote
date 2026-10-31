/**
 * Jittered exponential backoff calculator.
 *
 * Ported from vscode-unify-chat-provider's `calculateBackoffDelay`
 * (vendors/vscode-unify-chat-provider-main/src/utils.ts:941-962) with the
 * AWS-style "decorrelated jitter" formula:
 *
 *     delay = min(initialDelay * multiplier^attempt, maxDelay)
 *             * (1 +/- jitter)
 *
 * The jitter prevents thundering-herd when N concurrent requests hit the
 * same dead upstream: deterministic backoff would synchronize their retry
 * waves into a stampede.
 *
 * Pure functions, fully testable.
 */

/**
 * Configuration for the backoff calculator.
 */
export interface BackoffConfig {
  /** Base delay for the first retry (attempt=0). */
  initialDelayMs: number;
  /** Hard cap on the computed delay, before jitter is applied. */
  maxDelayMs: number;
  /** Exponential growth factor per attempt (typically 2). */
  backoffMultiplier: number;
  /**
   * Jitter factor in [0, 1]. With 0.1, each delay is randomly scaled
   * within [0.9x, 1.1x] of its computed value.
   */
  jitterFactor: number;
}

/**
 * Compute the backoff delay for a given retry attempt.
 *
 * The `attempt` parameter is 0-indexed: 0 = first retry, 1 = second.
 *
 * @param attempt 0-indexed retry attempt counter
 * @param config Backoff configuration
 * @returns delay in milliseconds (integer, >= 0)
 */
export function calculateBackoffDelay(
  attempt: number,
  config: BackoffConfig,
): number {
  const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } =
    config;

  // Defensive: clamp attempt to a safe non-negative integer.
  const safeAttempt =
    Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;

  // 1) Pure exponential backoff (capped).
  const exponential =
    initialDelayMs * Math.pow(backoffMultiplier, safeAttempt);
  const capped = Math.min(exponential, maxDelayMs);

  // 2) Decorrelated jitter: +/-jitterFactor * capped.
  const jitter = jitterFactor * capped * (Math.random() * 2 - 1);
  const withJitter = capped + jitter;

  // Ensure non-negative integer output.
  return Math.max(0, Math.round(withJitter));
}
