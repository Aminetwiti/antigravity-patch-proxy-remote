import { describe, expect, it, vi } from 'vitest';
import { LogMinimap } from './log-minimap';

describe('LogMinimap - Canvas error barcode', () => {
  it('instantiates and handles entries safely in headless environment', () => {
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    const mockCanvas = {
      width: 16,
      height: 300,
      getContext: vi.fn().mockReturnValue(mockCtx),
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ top: 0, height: 300 }),
    } as unknown as HTMLCanvasElement;

    const minimap = new LogMinimap(mockCanvas);
    expect(minimap).toBeDefined();

    minimap.setEntries([
      { level: 'info' },
      { level: 'warn' },
      { level: 'error' },
      { level: 'panic' },
    ]);
    minimap.render();

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 16, 300);
    expect(mockCtx.fillRect).toHaveBeenCalled();
  });

  it('clears canvas on clear() call', () => {
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    const mockCanvas = {
      width: 16,
      height: 300,
      getContext: vi.fn().mockReturnValue(mockCtx),
      addEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const minimap = new LogMinimap(mockCanvas);
    minimap.clear();
    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 16, 300);
  });
});
