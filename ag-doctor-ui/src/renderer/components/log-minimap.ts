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
    this.entries = entries.slice(-2000);
    this.requestRender();
  }

  public appendEntry(entry: MinimapEntry): void {
    this.entries.push(entry);
    if (this.entries.length > 2000) {
      this.entries.splice(0, this.entries.length - 2000);
    }
    this.requestRender();
  }

  public appendEntries(newEntries: MinimapEntry[]): void {
    if (!newEntries || newEntries.length === 0) return;
    this.entries.push(...newEntries);
    if (this.entries.length > 2000) {
      this.entries.splice(0, this.entries.length - 2000);
    }
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
    const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';

    const getColor = (lvl: string): string => {
      if (lvl === 'panic') return isLight ? '#dc2626' : '#ef4444';
      if (lvl === 'error') return isLight ? '#ef4444' : '#f87171';
      if (lvl === 'warn') return isLight ? '#d97706' : '#fbbf24';
      if (lvl === 'proxy' || lvl === 'info') return isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.25)';
      return '';
    };

    const isAlert = (lvl: string): boolean => lvl === 'warn' || lvl === 'error' || lvl === 'panic';

    // Pass 1: Render base routine and info ticks
    for (let i = 0; i < total; i++) {
      const lvl = this.entries[i].level;
      if (isAlert(lvl)) continue;
      const color = getColor(lvl);
      if (color) {
        this.ctx.fillStyle = color;
        const y = Math.floor(i * step);
        const tickHeight = Math.max(1, Math.ceil(step));
        this.ctx.fillRect(0, y, width, tickHeight);
      }
    }

    // Pass 2: Render priority alerts (warn, error, panic) on top so they are never masked
    for (let i = 0; i < total; i++) {
      const lvl = this.entries[i].level;
      if (!isAlert(lvl)) continue;
      const color = getColor(lvl);
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

    let isDragging = false;

    const jumpTo = (clientY: number) => {
      if (!this.targetScrollEl) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.height <= 0) return;
      const clickY = clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, clickY / rect.height));

      const maxScroll = this.targetScrollEl.scrollHeight - this.targetScrollEl.clientHeight;
      if (maxScroll > 0) {
        this.targetScrollEl.scrollTop = ratio * maxScroll;
      }
    };

    this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      isDragging = true;
      try {
        if (typeof this.canvas.setPointerCapture === 'function') {
          this.canvas.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore in mock environments
      }
      jumpTo(e.clientY);
    });

    this.canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isDragging) return;
      jumpTo(e.clientY);
    });

    const stopDrag = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        if (typeof this.canvas.releasePointerCapture === 'function') {
          this.canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore in mock environments
      }
    };

    this.canvas.addEventListener('pointerup', stopDrag);
    this.canvas.addEventListener('pointercancel', stopDrag);
    this.canvas.addEventListener('click', (e) => jumpTo(e.clientY));
  }
}
