/**
 * StreamBuffer — High-throughput 60 Hz (16ms) batching buffer for streaming inference.
 *
 * Prevents IPC channel flooding during 100+ token/s model output streams
 * by batching micro-deltas into smooth 60 FPS frame updates.
 */

export class StreamBatchBuffer<T = string> {
  private buffer: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (batch: T[]) => void;

  constructor(onFlush: (batch: T[]) => void, flushIntervalMs = 16) {
    this.onFlush = onFlush;
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Pushes a new item into the buffer.
   * Schedules a flush on the next 16ms frame boundary if not already scheduled.
   */
  public push(item: T): void {
    this.buffer.push(item);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Immediately flushes any pending items in the buffer.
   */
  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const itemsToFlush = this.buffer;
      this.buffer = [];
      this.onFlush(itemsToFlush);
    }
  }

  /**
   * Clears the buffer and cancels any pending flush timer.
   */
  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
