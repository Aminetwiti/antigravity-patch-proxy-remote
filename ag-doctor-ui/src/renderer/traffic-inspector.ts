/**
 * ag-doctor UI — Traffic Inspector Module
 * Real-time network request/response logger & payload translator inspector.
 * Captures intercepted Cloud Code API calls, latencies, status codes, and format conversions.
 */

export interface TrafficEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  targetModel: string;
  translatedProvider: string;
  statusCode: number;
  latencyMs: number;
  timeToFirstTokenMs?: number;
  dnsLookupMs?: number;
  tlsHandshakeMs?: number;
  streamMs?: number;
  stepId?: string;
  cascadeInvocationId?: string;
  headers?: Record<string, string>;
  totalTokens?: number;
  tokensPerSec?: number;
  requestPayload?: string;
  responsePayload?: string;
}

export interface TimingBreakdown {
  dns: number;
  tls: number;
  ttft: number;
  stream: number;
  total: number;
}

export function computeTimingBreakdown(entry: TrafficEntry): TimingBreakdown {
  const total = entry.latencyMs || 0;
  const dns = Math.max(0, entry.dnsLookupMs || 0);
  const tls = Math.max(0, entry.tlsHandshakeMs || 0);
  const ttft = Math.max(0, entry.timeToFirstTokenMs || (total > 0 ? Math.min(total, 120) : 0));
  const stream = Math.max(0, entry.streamMs !== undefined ? entry.streamMs : Math.max(0, total - ttft));
  return { dns, tls, ttft, stream, total };
}

export function generateCurlCommand(
  entry: TrafficEntry,
  options: { maskToken?: boolean; hostUrl?: string } = {}
): string {
  const mask = options.maskToken !== false;
  const baseUrl = options.hostUrl || 'http://127.0.0.1:51074';
  const fullUrl = entry.path.startsWith('http') ? entry.path : `${baseUrl}${entry.path.startsWith('/') ? '' : '/'}${entry.path}`;
  const parts: string[] = [`curl -X ${entry.method || 'POST'} "${fullUrl}"`];

  parts.push(`-H "Content-Type: application/json"`);
  if (entry.targetModel) {
    parts.push(`-H "x-antigravity-model: ${entry.targetModel}"`);
  }
  if (entry.stepId) {
    parts.push(`-H "x-cortex-step-id: ${entry.stepId}"`);
  }

  if (entry.headers) {
    for (const [k, v] of Object.entries(entry.headers)) {
      const lower = k.toLowerCase();
      if (lower === 'content-type' || lower === 'host') continue;
      let val = v;
      if (mask && (lower === 'authorization' || lower === 'x-api-key')) {
        val = lower === 'authorization' ? 'Bearer [REDACTED_TOKEN]' : '[REDACTED_KEY]';
      }
      parts.push(`-H "${k}: ${val}"`);
    }
  } else {
    const authVal = mask ? 'Bearer [REDACTED_TOKEN]' : 'Bearer <ACCESS_TOKEN>';
    parts.push(`-H "Authorization: ${authVal}"`);
  }

  if (entry.requestPayload && entry.requestPayload !== '{}') {
    const safePayload = mask ? sanitizePayload(entry.requestPayload) : entry.requestPayload;
    const escaped = safePayload.replace(/'/g, `'\\''`);
    parts.push(`--data-raw '${escaped}'`);
  }

  return parts.join(' \\\n  ');
}

export function filterByStatusCategory(
  entries: TrafficEntry[],
  category: 'all' | '2xx' | '4xx' | '5xx'
): TrafficEntry[] {
  if (category === 'all') return [...entries];
  return entries.filter((e) => {
    if (category === '2xx') return e.statusCode >= 200 && e.statusCode < 300;
    if (category === '4xx') return e.statusCode >= 400 && e.statusCode < 500;
    if (category === '5xx') return e.statusCode >= 500 && e.statusCode < 600;
    return true;
  });
}

export function sanitizePayload(payload?: string): string {
  if (!payload) return '{}';
  return payload
    .replace(/(sk-[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1...[REDACTED]')
    .replace(/(gai-[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1...[REDACTED]')
    .replace(/(AIzaSy[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1...[REDACTED]')
    .replace(/("x-api-key"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/("apiKey"\s*:\s*")[^"]+(")/gi, '$1enc:redacted...$2')
    .replace(/("api-key"\s*:\s*")[^"]+(")/gi, '$1enc:redacted...$2')
    .replace(/("authorization"\s*:\s*"Bearer\s+)[^"]+(")/gi, '$1[REDACTED]$2');
}

export class TrafficInspectorEngine {
  private entries: TrafficEntry[] = [];
  private maxEntries = 200;

  public logTraffic(entry: Omit<TrafficEntry, 'id' | 'timestamp'>): TrafficEntry {
    let tokSec = entry.tokensPerSec;
    if (!tokSec && entry.totalTokens && entry.latencyMs > 0) {
      tokSec = Math.round((entry.totalTokens / (entry.latencyMs / 1000)) * 10) / 10;
    }
    const fullEntry: TrafficEntry = {
      ...entry,
      tokensPerSec: tokSec,
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };

    this.entries.unshift(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
    return fullEntry;
  }

  public getEntries(): TrafficEntry[] {
    return [...this.entries];
  }

  public getEntryById(id: string): TrafficEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  public filterEntries(
    query: string,
    providerFilter = 'all',
    statusCategory: 'all' | '2xx' | '4xx' | '5xx' = 'all'
  ): TrafficEntry[] {
    const q = query.trim().toLowerCase();
    let result = this.entries.filter((entry) => {
      const matchesProvider = providerFilter === 'all' || entry.translatedProvider.toLowerCase() === providerFilter.toLowerCase();
      const matchesQuery =
        !q ||
        entry.path.toLowerCase().includes(q) ||
        entry.targetModel.toLowerCase().includes(q) ||
        entry.translatedProvider.toLowerCase().includes(q) ||
        entry.statusCode.toString().includes(q) ||
        (entry.stepId && entry.stepId.toLowerCase().includes(q));

      return matchesProvider && matchesQuery;
    });

    if (statusCategory !== 'all') {
      result = filterByStatusCategory(result, statusCategory);
    }

    return result;
  }

  public clear(): void {
    this.entries = [];
  }

  public async replayEntry(id: string, executor: (entry: TrafficEntry) => Promise<{ statusCode: number; latencyMs: number }>): Promise<TrafficEntry | null> {
    const original = this.entries.find((e) => e.id === id);
    if (!original) return null;

    const start = Date.now();
    try {
      const res = await executor(original);
      const replayed = this.logTraffic({
        method: original.method,
        path: original.path + ' (Replayed)',
        targetModel: original.targetModel,
        translatedProvider: original.translatedProvider,
        statusCode: res.statusCode,
        latencyMs: res.latencyMs || (Date.now() - start),
        timeToFirstTokenMs: original.timeToFirstTokenMs,
        stepId: original.stepId,
        requestPayload: original.requestPayload,
        responsePayload: 'Replayed response payload',
      });
      return replayed;
    } catch (err: any) {
      const replayed = this.logTraffic({
        method: original.method,
        path: original.path + ' (Replayed Fail)',
        targetModel: original.targetModel,
        translatedProvider: original.translatedProvider,
        statusCode: 500,
        latencyMs: Date.now() - start,
        timeToFirstTokenMs: original.timeToFirstTokenMs,
        stepId: original.stepId,
        requestPayload: original.requestPayload,
        responsePayload: JSON.stringify({ error: err.message }),
      });
      return replayed;
    }
  }

  public generateDiffView(entry: TrafficEntry): { reqRaw: string; resRaw: string; isError: boolean } {
    return {
      reqRaw: sanitizePayload(entry.requestPayload),
      resRaw: sanitizePayload(entry.responsePayload),
      isError: entry.statusCode >= 400,
    };
  }
}

// CJS/global hookup for <script> tag use (no bundler required in renderer).
if (typeof window !== 'undefined') {
  (window as unknown as { AgTraffic?: unknown }).AgTraffic = {
    TrafficInspectorEngine,
    generateCurlCommand,
    computeTimingBreakdown,
    filterByStatusCategory,
    sanitizePayload,
  };
}
