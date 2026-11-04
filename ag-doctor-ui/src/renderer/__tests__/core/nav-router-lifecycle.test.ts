import { describe, expect, it, vi, beforeEach } from 'vitest';
import { navigate, registerViewController, registerViewLoader, getCurrentView } from '../../core/routing/nav-router';
import { IView } from '../../types/view';

describe('SOLID Architecture — Navigation Lifecycle (LSP / OCP)', () => {
  beforeEach(() => {
    // Reset global state mocks if needed
  });

  it('manages view lifecycle with init, mount, and unmount', () => {
    const lifecycleCalls: string[] = [];

    const testViewA: IView = {
      id: 'viewA',
      init: vi.fn(() => {
        lifecycleCalls.push('init:viewA');
      }),
      mount: vi.fn(() => {
        lifecycleCalls.push('mount:viewA');
      }),
      unmount: vi.fn(() => {
        lifecycleCalls.push('unmount:viewA');
      }),
    };

    const testViewB: IView = {
      id: 'viewB',
      init: vi.fn(() => {
        lifecycleCalls.push('init:viewB');
      }),
      mount: vi.fn(() => {
        lifecycleCalls.push('mount:viewB');
      }),
      unmount: vi.fn(() => {
        lifecycleCalls.push('unmount:viewB');
      }),
    };

    registerViewController(testViewA);
    registerViewController(testViewB);

    // 1. Navigate to viewA
    navigate('viewA');
    expect(getCurrentView()).toBe('viewA');
    expect(testViewA.init).toHaveBeenCalledTimes(1);
    expect(testViewA.mount).toHaveBeenCalledTimes(1);
    expect(lifecycleCalls).toEqual(['init:viewA', 'mount:viewA']);

    // 2. Navigate to viewB -> viewA must be unmounted, viewB initialized & mounted
    navigate('viewB');
    expect(getCurrentView()).toBe('viewB');
    expect(testViewA.unmount).toHaveBeenCalledTimes(1);
    expect(testViewB.init).toHaveBeenCalledTimes(1);
    expect(testViewB.mount).toHaveBeenCalledTimes(1);

    expect(lifecycleCalls).toEqual([
      'init:viewA',
      'mount:viewA',
      'unmount:viewA',
      'init:viewB',
      'mount:viewB',
    ]);
  });

  it('preserves backward compatibility with legacy registerViewLoader', () => {
    const legacyLoader = vi.fn();
    registerViewLoader('legacyView', legacyLoader);

    navigate('legacyView');
    expect(getCurrentView()).toBe('legacyView');
    expect(legacyLoader).toHaveBeenCalledTimes(1);
  });
});
