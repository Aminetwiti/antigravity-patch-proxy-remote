/**
 * Empty-stream guard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The failure mode
 * ─────────────────────────────────────────────────────────────────────────────
 * Several upstream models (especially flaky ones) can return `200 OK` with
 * `Content-Type: text/event-stream` and then immediately close the stream
 * without sending any meaningful content. From the caller's perspective the
 * stream looks "successful" – no error, no timeout – but the user receives
 * an empty assistant message.
 *
 * Common triggers observed in the field:
 *   - Upstream auth fails mid-stream and silently closes
 *   - Reverse proxy in front of the upstream returns an empty SSE body
 *   - Model returns `[DONE]` on the first line as a defensive fallback
 *   - Network path completes the TLS handshake, then RSTs the socket
 *
 * The vendor `vscode-unify-chat-provider` solves this by ANDing several
 * "did we get something useful?" flags together. We replicate the idea here
 * with a small, dependency-free class.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this counts as "useful"
 * ─────────────────────────────────────────────────────────────────────────────
 * The guard keeps three counters:
 *
 *   - `rawChunkCount`      – every 'data' event from the upstream stream,
 *                             regardless of payload.
 *   - `sseFrameCount`      – every well-formed `data: ...` frame (minus
 *                             `data: [DONE]`).
 *   - `bytesReceived`      – total bytes sent by the upstream.
 *
 * A stream is considered "empty" iff:
 *   - The response was 200 OK AND
 *   - `rawChunkCount === 0` OR `bytesReceived < MIN_USEFUL_BYTES` AND
 *   - `sseFrameCount === 0`
 *
 * The `MIN_USEFUL_BYTES` threshold (default 16) avoids false positives on
 * streams that the upstream started with a comment line or a single
 * heartbeat byte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage
 * ─────────────────────────────────────────────────────────────────────────────
 *   const guard = new EmptyStreamGuard();
 *   apiRes.on('data', (chunk) => {
 *     guard.observe(chunk);
 *     // ... existing passthrough ...
 *   });
 *   apiRes.on('end', () => {
 *     const verdict = guard.finalize({ statusCode: apiRes.statusCode });
 *     if (verdict.isEmpty) {
 *       // retry, fall back, or surface a graceful error
 *     }
 *   });
 */

export const EMPTY_STREAM_MIN_USEFUL_BYTES = 16;
/** A "well-formed" data: frame must contain at least this many payload bytes. */
export const EMPTY_STREAM_MIN_FRAME_BYTES = 2;

export interface EmptyStreamVerdict {
  /** Whether the stream is considered empty (failed silently). */
  isEmpty: boolean;
  /** Human-readable reason; useful for diagnostics. */
  reason: string;
  /** Number of raw chunks seen. */
  rawChunkCount: number;
  /** Number of valid SSE `data:` frames seen (excluding `[DONE]`). */
  sseFrameCount: number;
  /** Total bytes received. */
  bytesReceived: number;
  /** Status code passed to `finalize()`. */
  statusCode: number;
}

export class EmptyStreamGuard {
  private _rawChunkCount = 0;
  private _sseFrameCount = 0;
  private _bytesReceived = 0;
  private _frameBuffer = '';
  private _sawDone = false;

  /** Increment raw chunk + byte counters. Called once per 'data' event. */
  observe(chunk: Buffer | string): void {
    this._rawChunkCount += 1;
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this._bytesReceived += buf.length;

    // Incrementally parse SSE frames so we don't double-count or miss
    // a frame that spans two chunks.
    this._frameBuffer += buf.toString('utf-8');
    let newlineIdx = this._frameBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this._frameBuffer.slice(0, newlineIdx).trim();
      this._frameBuffer = this._frameBuffer.slice(newlineIdx + 1);
      this._classifyLine(line);
      newlineIdx = this._frameBuffer.indexOf('\n');
    }
  }

  private _classifyLine(line: string): void {
    if (!line) return;
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      this._sawDone = true;
      return;
    }
    if (payload.length >= EMPTY_STREAM_MIN_FRAME_BYTES) {
      this._sseFrameCount += 1;
    }
  }

  /**
   * Call once after the stream ends. Returns a verdict describing whether we
   * received meaningful content.
   */
  finalize(opts: { statusCode: number | string }): EmptyStreamVerdict {
    const statusCode = typeof opts.statusCode === 'string'
      ? parseInt(opts.statusCode, 10)
      : opts.statusCode;

    // Flush any trailing frame that didn't end with a newline.
    if (this._frameBuffer.trim()) {
      this._classifyLine(this._frameBuffer.trim());
      this._frameBuffer = '';
    }

    // We treat any 2xx/3xx as "successful delivery" because the upstream
    // did not signal an error. Empty meaninglessness is only actionable when
    // the response looks healthy to the user.
    const isSuccessfulStatus = statusCode >= 200 && statusCode < 400;
    const reason = this._computeReason(isSuccessfulStatus);

    return {
      isEmpty: reason !== null,
      reason: reason ?? 'non-empty',
      rawChunkCount: this._rawChunkCount,
      sseFrameCount: this._sseFrameCount,
      bytesReceived: this._bytesReceived,
      statusCode,
    };
  }

  private _computeReason(isSuccessfulStatus: boolean): string | null {
    if (!isSuccessfulStatus) {
      // Non-2xx is *not* an empty-stream failure – it's a regular error and
      // is handled by the existing status-code retry path.
      return null;
    }
    if (this._sseFrameCount > 0) {
      // We got at least one valid data frame; the stream had content.
      return null;
    }
    // No `data:` frames at all → the stream is meaningless regardless of
    // how many keep-alive comments or pings we received. We still check the
    // byte threshold below to give a more actionable reason.
    if (this._sawDone && this._rawChunkCount === 1) {
      // Single [DONE] frame with nothing else = explicit empty stream.
      return 'upstream returned [DONE] with no preceding data frames';
    }
    if (this._rawChunkCount === 0) {
      return 'upstream closed stream with zero chunks';
    }
    if (this._bytesReceived < EMPTY_STREAM_MIN_USEFUL_BYTES) {
      return `upstream sent only ${this._bytesReceived} byte(s) without a data frame`;
    }
    // Got non-trivial bytes but no data frames — comment-only / heartbeat
    // stream. The user sees nothing useful.
    return 'upstream stream contained no data frames (only comments/heartbeats)';
  }

  /** Reset to a fresh state (useful for retry attempts reusing the guard). */
  reset(): void {
    this._rawChunkCount = 0;
    this._sseFrameCount = 0;
    this._bytesReceived = 0;
    this._frameBuffer = '';
    this._sawDone = false;
  }

  /** Read-only accessors for tests + diagnostics. */
  get rawChunkCount(): number { return this._rawChunkCount; }
  get sseFrameCount(): number { return this._sseFrameCount; }
  get bytesReceived(): number { return this._bytesReceived; }
}
