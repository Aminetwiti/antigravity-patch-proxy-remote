/**
 * Simple spinner / progress indicator. No deps.
 */
import { c } from './output';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const isTTY = Boolean(process.stdout.isTTY);

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private idx = 0;
  private text = '';

  constructor(text = '') {
    this.text = text;
  }

  start(text?: string): void {
    if (text) this.text = text;
    if (!isTTY) {
      process.stdout.write(`${this.text}...\n`);
      return;
    }
    this.stop();
    this.timer = setInterval(() => {
      const frame = FRAMES[this.idx++ % FRAMES.length];
      process.stdout.write(`\r${c.cyan(frame)} ${this.text}`);
    }, 80);
  }

  update(text: string): void {
    this.text = text;
  }

  succeed(text?: string): void {
    this.stop();
    process.stdout.write(`\r${c.green('✔')} ${text ?? this.text}\n`);
  }

  fail(text?: string): void {
    this.stop();
    process.stdout.write(`\r${c.red('✖')} ${text ?? this.text}\n`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (isTTY) process.stdout.write('\r\x1b[2K');
    }
  }
}
