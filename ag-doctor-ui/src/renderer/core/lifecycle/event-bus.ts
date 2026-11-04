/**
 * core/event-bus.ts
 *
 * Bus d'événements typé léger (SRP & DIP).
 * Permet un découplage total entre composants et vues sans dépendre de variables globales.
 */

type EventHandler<T = any> = (payload: T) => void;
type UnsubscribeFn = () => void;

interface IEventBus {
  on<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn;
  once<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn;
  emit<T = any>(event: string, payload?: T): void;
  clear(event?: string): void;
  listenerCount(event: string): number;
}

class EventBus implements IEventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as EventHandler);

    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  once<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn {
    const unsub = this.on(event, (payload: T) => {
      unsub();
      handler(payload);
    });
    return unsub;
  }

  emit<T = any>(event: string, payload?: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    // Snapshot to protect against mutations during iteration
    const snapshot = Array.from(handlers);
    for (const fn of snapshot) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] Error in handler for event "${event}":`, err);
      }
    }
  }

  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// Global default singleton for renderer lifecycle
const globalEventBus: IEventBus = new EventBus();

if (typeof window !== 'undefined') {
  (window as any).EventBus = EventBus;
  (window as any).globalEventBus = globalEventBus;
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { EventBus, globalEventBus });
}
