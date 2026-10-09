/**
 * ag-doctor-ui Log Minimap
 * Ultra-lightweight HTML5 Canvas "Error Barcode" for instant visual triage
 */

export interface MinimapEntry {
  level: string;
}

export class LogMinimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private targetScrollEl: HTMLElement | null = null;
  private entries: MinimapEntry[] = [];
  private rafScheduled = false;

  constructor(canvas: HTMLCanvasElement, targetScrollEl?: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (targetScrollEl) {
      this.attachScrollTarget(targetScrollEl);
    }
    this.setupInteractions();
  }

  public attachScrollTarget(el: HTMLElement): void {
    this.targetScrollEl = el;
  }

  public setEntries(entries: MinimapEntry[]): void {
    this.entries = entries;
    this.requestRender();
  }

  public appendEntry(entry: MinimapEntry): void {
    this.entries.push(entry);
    this.requestRender();
  }

  public clear(): void {
    this.entries = [];
    this.render();
  }

  public requestRender(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.rafScheduled = false;
        this.render();
      });
    } else {
      this.rafScheduled = false;
      this.render();
    }
  }

  public render(): void {
    if (!this.ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    const total = this.entries.length;
    if (total === 0) return;

    const step = height / total;

    // Draw level ticks
    for (let i = 0; i < total; i++) {
      const lvl = this.entries[i].level;
      let color = '';
      if (lvl === 'panic') {
        color = '#ef4444';
      } else if (lvl === 'error') {
        color = '#f87171';
      } else if (lvl === 'warn') {
        color = '#fbbf24';
      } else if (lvl === 'proxy' || lvl === 'info') {
        color = 'rgba(56, 189, 248, 0.25)';
      }

      if (color) {
        this.ctx.fillStyle = color;
        const y = Math.floor(i * step);
        const tickHeight = Math.max(1, Math.ceil(step));
        this.ctx.fillRect(0, y, width, tickHeight);
      }
    }
  }

  private setupInteractions(): void {
    if (!this.canvas) return;

    const handleJump = (event: MouseEvent) => {
      if (!this.targetScrollEl) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.height <= 0) return;
      const clickY = event.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, clickY / rect.height));

      const maxScroll = this.targetScrollEl.scrollHeight - this.targetScrollEl.clientHeight;
      if (maxScroll > 0) {
        this.targetScrollEl.scrollTop = ratio * maxScroll;
      }
    };

    this.canvas.addEventListener('click', handleJump);
  }
}
