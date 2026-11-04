/**
 * core/service-registry.ts
 *
 * Registre de services / Injection de dépendances légère (DIP - Dependency Inversion).
 * Permet aux vues et composants de demander leurs dépendances sans couplage rigide
 * à `window` ou aux instances globales directes.
 */

interface ServiceTokens {
  'api': AgAPI;
  'eventBus': IEventBus;
  [key: string]: any;
}

class ServiceRegistry {
  private static instance: ServiceRegistry | null = null;
  private services = new Map<string, any>();

  public static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
      ServiceRegistry.instance.initializeDefaults();
    }
    return ServiceRegistry.instance;
  }

  public static resetInstance(): void {
    ServiceRegistry.instance = null;
  }

  private initializeDefaults(): void {
    // Register core EventBus
    if (typeof globalEventBus !== 'undefined') {
      this.register('eventBus', globalEventBus);
    }

    // Register safe window.ag wrapper
    if (typeof window !== 'undefined' && (window as any).ag) {
      this.register('api', (window as any).ag);
    }
  }

  public register<K extends keyof ServiceTokens>(key: K, instance: ServiceTokens[K]): void;
  public register<T = any>(key: string, instance: T): void;
  public register(key: string, instance: any): void {
    this.services.set(key, instance);
  }

  public get<K extends keyof ServiceTokens>(key: K): ServiceTokens[K];
  public get<T = any>(key: string): T | undefined;
  public get(key: string): any {
    if (this.services.has(key)) {
      return this.services.get(key);
    }
    // Fallback to window object for legacy bridge compatibility
    if (typeof window !== 'undefined' && key === 'api' && (window as any).ag) {
      return (window as any).ag;
    }
    return undefined;
  }

  public has(key: string): boolean {
    return this.services.has(key);
  }

  public unregister(key: string): boolean {
    return this.services.delete(key);
  }

  public clear(): void {
    this.services.clear();
    this.initializeDefaults();
  }
}

const services = ServiceRegistry.getInstance();

if (typeof window !== 'undefined') {
  (window as any).ServiceRegistry = ServiceRegistry;
  (window as any).services = services;
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { ServiceRegistry, services });
}
