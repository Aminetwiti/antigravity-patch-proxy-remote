/**
 * core/base-view.ts
 *
 * Classe de base abstraite pour les contrôleurs de vues (SOLID: LSP & OCP).
 * Fournit:
 * - Implémentation standardisée et polymorphique de IView
 * - Gestion automatique du cycle de vie (init, mount, unmount, refresh)
 * - Nettoyage automatique des écouteurs d'événements et timers (anti-memory leak)
 */

abstract class BaseView implements IView, IDisposable {
  abstract readonly id: string;
  readonly title?: string;

  protected container: HTMLElement | null = null;
  private disposables: IDisposable[] = [];
  private activeIntervals: number[] = [];
  private activeTimeouts: number[] = [];
  private _isMounted = false;

  constructor(title?: string) {
    this.title = title;
  }

  public get isMounted(): boolean {
    return this._isMounted;
  }

  public init(container?: HTMLElement): void | Promise<void> {
    if (container) {
      this.container = container;
    } else if (typeof document !== 'undefined') {
      this.container = document.getElementById(`view-${this.id}`);
    }
    return this.onInit();
  }

  protected onInit(): void | Promise<void> {
    // Hook optionnel pour les sous-classes
  }

  public async mount(): Promise<void> {
    this._isMounted = true;
    await this.onMount();
  }

  protected abstract onMount(): void | Promise<void>;

  public async unmount(): Promise<void> {
    this._isMounted = false;
    try {
      await this.onUnmount();
    } finally {
      this.disposeAll();
    }
  }

  protected onUnmount(): void | Promise<void> {
    // Hook optionnel pour les sous-classes
  }

  public async refresh(): Promise<void> {
    if (!this._isMounted) return;
    await this.onRefresh();
  }

  protected onRefresh(): void | Promise<void> {
    // Hook optionnel pour les sous-classes
  }

  /**
   * Enregistre un élément jetable (écouteur, timer, ressource) nettoyé automatiquement au démontage.
   */
  protected registerDisposable<T extends IDisposable | (() => void)>(disposable: T): T {
    if (typeof disposable === 'function') {
      this.disposables.push({ dispose: disposable as () => void });
    } else if (disposable && typeof (disposable as IDisposable).dispose === 'function') {
      this.disposables.push(disposable as IDisposable);
    }
    return disposable;
  }

  protected trackDisposable(disposable: IDisposable | (() => void)): void {
    this.registerDisposable(disposable);
  }

  /**
   * Enregistre un écouteur d'événement DOM nettoyé automatiquement à l'unmount.
   */
  protected addEventListener<K extends keyof HTMLElementEventMap>(
    element: HTMLElement | null | undefined,
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!element) return;
    element.addEventListener(type, listener as any, options);
    this.registerDisposable(() => {
      element.removeEventListener(type, listener as any, options);
    });
  }

  protected trackEventListener(
    target: EventTarget | null | undefined,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!target) return;
    target.addEventListener(type, listener, options);
    this.registerDisposable(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  /**
   * Enregistre un timer `setInterval` automatiquement effacé au démontage.
   */
  protected setInterval(handler: () => void, timeout?: number): number {
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    const id = timerHost.setInterval(handler, timeout) as unknown as number;
    this.activeIntervals.push(id);
    return id;
  }

  protected trackInterval(callback: () => void, ms: number): number {
    return this.setInterval(callback, ms);
  }

  /**
   * Enregistre un timer `setTimeout` automatiquement effacé au démontage.
   */
  protected setTimeout(handler: () => void, timeout?: number): number {
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    const id = timerHost.setTimeout(handler, timeout) as unknown as number;
    this.activeTimeouts.push(id);
    return id;
  }

  protected trackTimeout(callback: () => void, ms: number): number {
    return this.setTimeout(callback, ms);
  }

  public dispose(): void {
    this.disposeAll();
  }

  private disposeAll(): void {
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);

    for (const interval of this.activeIntervals) {
      try {
        timerHost.clearInterval(interval);
      } catch {}
    }
    this.activeIntervals = [];

    for (const timeout of this.activeTimeouts) {
      try {
        timerHost.clearTimeout(timeout);
      } catch {}
    }
    this.activeTimeouts = [];

    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {}
    }
    this.disposables = [];
  }
}

if (typeof window !== 'undefined') {
  (window as any).BaseView = BaseView;
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { BaseView });
}
