/**
 * Idle timeout wrapper for Node.js Streams.
 *
 * Ported from vscode-unify-chat-provider's `withIdleTimeout<T>` (async iterable
 * flavor) but adapted to the Node.js Streams API (which is what `http.request`
 * consumers in this codebase use).
 *
 * The core insight: a streaming response can be "alive" but stuck — the TCP
 * socket stays open, the upstream model is still "thinking", but no new token
 * has arrived for N seconds. The proxy should:
 *
 *   1) Detect the stuck state with a watchdog (per-chunk timer reset).
 *   2) Tear down the connection by aborting the request.
 *   3) Surface a typed error so the caller can treat it as a transient
 *      timeout (eligible for retry via the circuit breaker).
 *
 * This is fundamentally different from a total request timeout (which
 * `request.setTimeout()` provides): a total timeout kills healthy streams
 * that may legitimately take several minutes. The idle timeout only fires
 * when the upstream *stops saying anything*.
 *
 * Usage:
 *   ```ts
 *   const req = client.request(url, options, (apiRes) => {
 *     const guard = new IdleTimeoutGuard(apiRes, { idleTimeoutMs: 30_000, label: model.name });
 *     apiRes.on('data', (chunk) => { ... });
 *     apiRes.on('end', () => { guard.dispose(); });
 *   });
 *   ```
 */

export interface IdleTimeoutOptions {
  /** Maximum time to wait between data chunks. Fires `timer` if exceeded. */
  idleTimeoutMs: number;
  /**
   * Optional human-readable label for the operation being guarded (used in
   * error messages and logging).
   */
  label?: string;
  /**
   * Callback invoked when the watchdog fires. The caller is responsible for
   * tearing down the request (typically `request.destroy()`).
   */
  onTimeout?: (err: IdleTimeoutError) => void;
}

/**
 * Error thrown when the idle timeout fires. Distinct from a generic
 * `ETIMEDOUT` so callers can classify it correctly.
 */
export class IdleTimeoutError extends Error {
  public readonly kind = 'idle-timeout' as const;
  public readonly idleTimeoutMs: number;
  public readonly label?: string;

  constructor(idleTimeoutMs: number, label?: string) {
    super(
      label
        ? `Idle timeout for ${label}: no data received for ${idleTimeoutMs}ms`
        : `Idle timeout: no data received for ${idleTimeoutMs}ms`,
    );
    this.name = 'IdleTimeoutError';
    this.idleTimeoutMs = idleTimeoutMs;
    this.label = label;
  }
}

/**
 * A guard wrapping a Node.js Readable stream. Implementation:
 *   - On construction, start a `setTimeout` for `idleTimeoutMs`.
 *   - On any 'data' event, clear and re-arm the timer.
 *   - On 'end' / 'close' / 'error', clear the timer (stream is done).
 *   - On expiry, call `onTimeout` (caller-provided).
 *   - `dispose()` is idempotent and disarms cleanly.
 */
export class IdleTimeoutGuard {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private fired = false;

  constructor(
    private readonly stream: NodeJS.ReadableStream,
    private readonly options: IdleTimeoutOptions,
  ) {
    this.arm();
    stream.on('data', this.onData);
    stream.on('end', this.onEnd);
    stream.on('close', this.onClose);
    stream.on('error', this.onError);
  }

  /**
   * Returns true if the watchdog fired (caller should still tear down).
   */
  public didFire(): boolean {
    return this.fired;
  }

  /**
   * Idempotent cleanup. Always call this from the stream's end/close/error
   * handlers and from any retry path.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.stream.off('data', this.onData);
    this.stream.off('end', this.onEnd);
    this.stream.off('close', this.onClose);
    this.stream.off('error', this.onError);
  }

  private onData = (): void => {
    if (this.disposed) return;
    this.arm();
  };

  private onEnd = (): void => {
    this.dispose();
  };

  private onClose = (): void => {
    this.dispose();
  };

  private onError = (): void => {
    this.dispose();
  };

  private arm(): void {
    this.clear();
    this.timer = setTimeout(() => this.fire(), this.options.idleTimeoutMs);
    // Don't keep the event loop alive just for the watchdog.
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private fire(): void {
    if (this.disposed || this.fired) return;
    this.fired = true;
    const err = new IdleTimeoutError(
      this.options.idleTimeoutMs,
      this.options.label,
    );
    try {
      this.options.onTimeout?.(err);
    } catch {
      // Swallow secondary errors from the callback — they should not
      // prevent the caller from tearing down the request.
    }
  }
}
