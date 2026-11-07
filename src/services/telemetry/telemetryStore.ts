/**
 * Telemetry & Metrics Store
 * Tracks request counts, token usage, error rates, and real-time latency per provider.
 */

export interface ProviderMetrics {
  providerId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  lastLatencyMs: number;
  recentLatencies: number[];
  averageLatencyMs: number;
  lastTestedAt?: string;
  status: 'healthy' | 'degraded' | 'offline' | 'unknown';
}

class TelemetryStore {
  private metricsMap = new Map<string, ProviderMetrics>();

  public getOrCreateMetrics(providerId: string): ProviderMetrics {
    const existing = this.metricsMap.get(providerId);
    if (existing) return existing;

    const initial: ProviderMetrics = {
      providerId,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastLatencyMs: 0,
      recentLatencies: [],
      averageLatencyMs: 0,
      status: 'unknown',
    };
    this.metricsMap.set(providerId, initial);
    return initial;
  }

  public recordRequest(
    providerId: string,
    success: boolean,
    latencyMs: number,
    inputTokens = 0,
    outputTokens = 0,
  ): ProviderMetrics {
    const metrics = this.getOrCreateMetrics(providerId);
    metrics.totalRequests += 1;
    if (success) {
      metrics.successfulRequests += 1;
    } else {
      metrics.failedRequests += 1;
    }

    metrics.inputTokens += inputTokens;
    metrics.outputTokens += outputTokens;
    metrics.lastLatencyMs = Math.max(0, latencyMs);
    metrics.lastTestedAt = new Date().toISOString();

    // Maintain last 20 latencies for rolling average
    metrics.recentLatencies.push(metrics.lastLatencyMs);
    if (metrics.recentLatencies.length > 20) {
      metrics.recentLatencies.shift();
    }

    const sum = metrics.recentLatencies.reduce((acc, curr) => acc + curr, 0);
    metrics.averageLatencyMs = Math.round(sum / metrics.recentLatencies.length);

    // Compute status
    if (!success && metrics.failedRequests > metrics.successfulRequests) {
      metrics.status = 'offline';
    } else if (metrics.averageLatencyMs > 1500) {
      metrics.status = 'degraded';
    } else {
      metrics.status = 'healthy';
    }

    return metrics;
  }

  public getAllMetrics(): ProviderMetrics[] {
    return Array.from(this.metricsMap.values());
  }

  public clearMetrics(providerId?: string): void {
    if (providerId) {
      this.metricsMap.delete(providerId);
    } else {
      this.metricsMap.clear();
    }
  }
}

export const telemetryStore = new TelemetryStore();
