import { describe, expect, it, beforeEach } from 'vitest';
import { ServiceRegistry } from '../../core/lifecycle/service-registry';
import { EventBus } from '../../core/lifecycle/event-bus';

describe('SOLID Architecture — ServiceRegistry & EventBus', () => {
  let registry: any;

  beforeEach(() => {
    ServiceRegistry.resetInstance();
    registry = ServiceRegistry.getInstance();
  });

  describe('ServiceRegistry (DIP)', () => {
    it('registers and retrieves custom services', () => {
      const mockService = { name: 'test-service', compute: () => 42 };
      registry.register('myService', mockService);

      expect(registry.has('myService')).toBe(true);
      expect(registry.get('myService')).toBe(mockService);
      expect(registry.get('myService').compute()).toBe(42);
    });

    it('returns undefined for non-existing services', () => {
      expect(registry.has('unknown')).toBe(false);
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('allows unregistering services', () => {
      registry.register('temp', { active: true });
      expect(registry.has('temp')).toBe(true);
      registry.unregister('temp');
      expect(registry.has('temp')).toBe(false);
    });

    it('clears all custom services upon clear()', () => {
      registry.register('s1', {});
      registry.register('s2', {});
      registry.clear();
      expect(registry.has('s1')).toBe(false);
      expect(registry.has('s2')).toBe(false);
    });
  });

  describe('EventBus (SRP & Decoupling)', () => {
    it('emits events to registered listeners and allows unsubscribing', () => {
      const bus = new EventBus();
      const received: string[] = [];

      const unsub = bus.on<string>('test:event', (payload: string) => {
        received.push(payload);
      });

      bus.emit('test:event', 'first');
      bus.emit('test:event', 'second');

      expect(received).toEqual(['first', 'second']);

      unsub();
      bus.emit('test:event', 'third');
      expect(received).toEqual(['first', 'second']);
    });

    it('supports once() handlers that auto-unsubscribe after first trigger', () => {
      const bus = new EventBus();
      let count = 0;

      bus.once('ping', () => {
        count++;
      });

      bus.emit('ping');
      bus.emit('ping');
      expect(count).toBe(1);
    });
  });
});
