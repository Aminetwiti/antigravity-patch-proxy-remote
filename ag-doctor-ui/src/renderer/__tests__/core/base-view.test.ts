import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BaseView } from '../../core/lifecycle/base-view';

class MockTestView extends BaseView {
  readonly id = 'mock-test-view';
  public initCalls = 0;
  public mountCalls = 0;
  public unmountCalls = 0;
  public refreshCalls = 0;

  protected onInit(): void {
    this.initCalls++;
  }

  protected onMount(): void {
    this.mountCalls++;
  }

  protected onUnmount(): void {
    this.unmountCalls++;
  }

  protected onRefresh(): void {
    this.refreshCalls++;
  }

  public testAddDisposable(disposable: { dispose: () => void } | (() => void)) {
    return this.registerDisposable(disposable);
  }

  public testSetInterval(fn: () => void, ms: number) {
    return this.setInterval(fn, ms);
  }

  public testSetTimeout(fn: () => void, ms: number) {
    return this.setTimeout(fn, ms);
  }

  public testAddEventListener(el: any, event: string, handler: any) {
    this.addEventListener(el, event as any, handler);
  }
}

describe('SOLID Architecture — BaseView Lifecycle & Resource Management (LSP & SRP)', () => {
  let view: MockTestView;

  beforeEach(() => {
    vi.useFakeTimers();
    view = new MockTestView('Test View');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('manages initialization, mount, and refresh states', async () => {
    expect(view.isMounted).toBe(false);

    await view.init();
    expect(view.initCalls).toBe(1);

    await view.mount();
    expect(view.isMounted).toBe(true);
    expect(view.mountCalls).toBe(1);

    await view.refresh();
    expect(view.refreshCalls).toBe(1);

    await view.unmount();
    expect(view.isMounted).toBe(false);
    expect(view.unmountCalls).toBe(1);

    // Refresh should be a no-op when unmounted
    await view.refresh();
    expect(view.refreshCalls).toBe(1);
  });

  it('automatically disposes registered disposables on unmount', async () => {
    const disposeFn = vi.fn();
    const disposableObj = { dispose: vi.fn() };

    view.testAddDisposable(disposeFn);
    view.testAddDisposable(disposableObj);

    await view.mount();
    expect(disposeFn).not.toHaveBeenCalled();
    expect(disposableObj.dispose).not.toHaveBeenCalled();

    await view.unmount();
    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(disposableObj.dispose).toHaveBeenCalledTimes(1);
  });

  it('automatically clears active intervals and timeouts on unmount', async () => {
    const intervalCallback = vi.fn();
    const timeoutCallback = vi.fn();

    await view.mount();
    view.testSetInterval(intervalCallback, 100);
    view.testSetTimeout(timeoutCallback, 200);

    vi.advanceTimersByTime(150);
    expect(intervalCallback).toHaveBeenCalledTimes(1);
    expect(timeoutCallback).not.toHaveBeenCalled();

    // Unmount before timeout fires
    await view.unmount();

    vi.advanceTimersByTime(300);
    // Interval and timeout should have been canceled
    expect(intervalCallback).toHaveBeenCalledTimes(1);
    expect(timeoutCallback).not.toHaveBeenCalled();
  });

  it('automatically detaches DOM event listeners on unmount', async () => {
    const mockElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const handler = vi.fn();

    view.testAddEventListener(mockElement as any, 'click', handler);
    expect(mockElement.addEventListener).toHaveBeenCalledWith('click', handler, undefined);

    await view.unmount();
    expect(mockElement.removeEventListener).toHaveBeenCalledWith('click', handler, undefined);
  });
});
