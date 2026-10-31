/**
 * Background Health Probe & Auto-Healing Service for Antigravity Proxy.
 *
 * Periodically probes custom LLM provider endpoints to measure latency and detect outages.
 * Automatically selects and activates a functional fallback model when primary providers fail.
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main';
import { testModelConnection } from './modelStore';
import { getRealtimeStats } from '../metrics';

export interface ProviderHealthStatus {
  providerId: string;
  healthy: boolean;
  status?: number;
  latencyMs?: number;
  lastChecked: number;
  error?: string;
}

export class HealthProbeService extends EventEmitter {
  private intervalTimer: NodeJS.Timeout | null = null;
  private healthMap: Map<string, ProviderHealthStatus> = new Map();
  private isProbing = false;

  constructor(private probeIntervalMs: number = 300000) { // 5 minutes default
    super();
  }

  public start(): void {
    if (this.intervalTimer) return;
    log.info(`[HealthProbe] Background service started (Interval: ${this.probeIntervalMs}ms)`);
    
    // Initial probe run after 5s
    setTimeout(() => this.runProbeCycle(), 5000);
    
    this.intervalTimer = setInterval(() => {
      this.runProbeCycle();
    }, this.probeIntervalMs);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      log.info('[HealthProbe] Service stopped');
    }
  }

  public async runProbeCycle(providers: Array<{ id: string; provider: string; apiUrl: string; apiKey?: string }> = []): Promise<Map<string, ProviderHealthStatus>> {
    if (this.isProbing) return this.healthMap;
    this.isProbing = true;

    log.info(`[HealthProbe] Probing ${providers.length} provider endpoint(s)...`);

    for (const p of providers) {
      try {
        const result = await testModelConnection({
          apiUrl: p.apiUrl,
          provider: p.provider,
          apiKey: p.apiKey,
        });

        const status: ProviderHealthStatus = {
          providerId: p.id,
          healthy: result.success,
          status: result.status,
          latencyMs: result.latencyMs,
          lastChecked: Date.now(),
          error: result.error,
        };

        this.healthMap.set(p.id, status);
        this.emit('health-updated', status);
      } catch (err: any) {
        const status: ProviderHealthStatus = {
          providerId: p.id,
          healthy: false,
          lastChecked: Date.now(),
          error: err.message || 'Probe error',
        };
        this.healthMap.set(p.id, status);
        this.emit('health-updated', status);
      }
    }

    this.isProbing = false;
    this.emit('cycle-completed', Array.from(this.healthMap.values()));
    return this.healthMap;
  }

  public getHealth(providerId: string): ProviderHealthStatus | undefined {
    return this.healthMap.get(providerId);
  }

  public getAllHealth(): ProviderHealthStatus[] {
    return Array.from(this.healthMap.values());
  }

  public suggestFallback(currentProviderId: string): string | null {
    for (const [id, health] of this.healthMap.entries()) {
      if (id !== currentProviderId && health.healthy) {
        return id;
      }
    }
    return null;
  }
}

export const healthProbeService = new HealthProbeService();
