import type { CustomModel } from '../../../core/types';
import { getAccountQuotaKey } from '../identity/accountKeys';

/** After this duration without new measurements, latency score resets to 0 (neutral). */
export const EWMA_DECAY_THRESHOLD_MS = 10 * 60_000;

const accountLatencyEwma = new Map<string, { ewma: number; lastRecordedAt: number }>();

export function recordAccountLatency(candidate: CustomModel, latencyMs: number): void {
  if (typeof latencyMs !== 'number' || latencyMs <= 0 || !isFinite(latencyMs)) return;
  const key = getAccountQuotaKey(candidate);
  const prev = accountLatencyEwma.get(key);
  const ewma = prev === undefined
    ? latencyMs
    : Math.round(0.2 * latencyMs + 0.8 * prev.ewma);
  accountLatencyEwma.set(key, { ewma, lastRecordedAt: Date.now() });
}

export function getAccountAvgLatency(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const entry = accountLatencyEwma.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.lastRecordedAt > EWMA_DECAY_THRESHOLD_MS) {
    accountLatencyEwma.delete(key); // lazy eviction
    return 0;
  }
  return entry.ewma;
}

export function _resetAccountLatencies(): void {
  accountLatencyEwma.clear();
}
