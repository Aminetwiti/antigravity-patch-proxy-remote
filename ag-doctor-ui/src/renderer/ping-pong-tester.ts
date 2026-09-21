/**
 * Ping-Pong Model Latency & Health Tester
 * Provides benchmarking, latency categorization, response extraction,
 * and batch model ping-pong capabilities for ag-doctor-ui.
 */

export interface PingPongResult {
  modelName: string;
  provider?: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  speedTier: 'fast' | 'normal' | 'slow' | 'error';
  pongText: string;
  error?: string;
  testedAt: number;
}

/**
 * Classifies the latency of a ping-pong roundtrip into human-friendly speed tiers.
 */
export function getSpeedTier(latencyMs: number, ok: boolean): 'fast' | 'normal' | 'slow' | 'error' {
  if (!ok) return 'error';
  if (latencyMs < 400) return 'fast';
  if (latencyMs <= 1200) return 'normal';
  return 'slow';
}

/**
 * Generates an accessible, clean HTML badge for a ping-pong result.
 */
export function renderPingBadge(res: Pick<PingPongResult, 'ok' | 'latencyMs' | 'speedTier' | 'status'>): string {
  if (!res.ok) {
    return `<span class="ping-badge ping-badge-error" title="HTTP ${res.status || 'Failed'}">❌ FAIL ${res.status ? `(${res.status})` : ''}</span>`;
  }
  const tierIcon = res.speedTier === 'fast' ? '⚡' : res.speedTier === 'normal' ? '⏱️' : '🐢';
  return `<span class="ping-badge ping-badge-${res.speedTier}" title="${res.latencyMs}ms round-trip">${tierIcon} ${res.latencyMs}ms</span>`;
}

/**
 * Parses and extracts text content from an LLM chat/generate response payload.
 */
export function extractPongResponse(raw: any): string {
  if (!raw) return '';
  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return raw.slice(0, 100).trim();
    }
  }

  // Cloud Code wrapper
  if (obj?.response) {
    obj = obj.response;
  }

  // Google Gemini format
  if (Array.isArray(obj.candidates) && Array.isArray(obj.candidates[0]?.content?.parts)) {
    const parts = obj.candidates[0].content.parts;
    const textPart = parts.find((p: any) => p && typeof p.text === 'string');
    if (textPart) {
      return String(textPart.text).trim();
    }
  }
  // OpenAI chat completions format
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return String(obj.choices[0].message.content).trim();
  }
  if (Array.isArray(obj.choices) && obj.choices[0]?.text) {
    return String(obj.choices[0].text).trim();
  }
  if (typeof obj.pongText === 'string') {
    return obj.pongText.trim();
  }
  return '';
}

/**
 * Formats API errors (billing, quota, auth) into clear human-friendly text.
 */
export function formatApiError(raw: any, statusCode?: number): string {
  if (!raw) return statusCode ? `HTTP ${statusCode}` : 'Erreur inconnue';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const msg = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '');
    if (msg) {
      if (parsed?.error?.type === 'billing_error' || /insufficient balance/i.test(msg)) {
        return `Solde épuisé : ${msg}`;
      }
      if (parsed?.error?.status === 'RESOURCE_EXHAUSTED' || /quota|exhausted/i.test(msg)) {
        return `Quota épuisé : ${msg}`;
      }
      if (parsed?.error?.details?.[0]?.reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) {
        return `Clé API invalide ou expirée`;
      }
      return msg;
    }
  } catch {}
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

/**
 * Executes a single ping-pong test against a specified model.
 */
export async function testSingleModel(
  model: { name: string; id?: string; provider?: string; providerId?: string; apiUrl?: string; apiKey?: string },
  prompt = 'ping'
): Promise<PingPongResult> {
  const modelId = model.id || model.name;
  const startTime = Date.now();
  try {
    const ag = typeof window !== 'undefined' ? (window as any)?.ag : (globalThis as any)?.ag;
    if (ag?.modelPingPong) {
      const r = await ag.modelPingPong({ modelId, providerId: model.providerId, prompt });
      const speedTier = getSpeedTier(r.latencyMs, r.ok);
      return {
        modelName: model.name,
        provider: model.provider,
        ok: r.ok,
        status: r.status,
        latencyMs: r.latencyMs,
        speedTier,
        pongText: r.pongText || '',
        error: r.error ? formatApiError(r.error, r.status) : undefined,
        testedAt: Date.now(),
      };
    }

    // Fallback via window.ag.providers.test
    if (ag?.providers?.test) {
      const res = await ag.providers.test({
        apiUrl: model.apiUrl || '',
        apiKey: model.apiKey || '',
        id: model.providerId,
        modelId,
      });
      const latencyMs = res.latencyMs ?? (Date.now() - startTime);
      const ok = !!res.success;
      const speedTier = getSpeedTier(latencyMs, ok);
      return {
        modelName: model.name,
        provider: model.provider,
        ok,
        status: res.status ?? (ok ? 200 : 500),
        latencyMs,
        speedTier,
        pongText: (res as any).pongText || (ok ? 'pong' : ''),
        error: res.error,
        testedAt: Date.now(),
      };
    }

    throw new Error('IPC bridge window.ag.modelPingPong not available');
  } catch (err) {
    return {
      modelName: model.name,
      provider: model.provider,
      ok: false,
      status: 0,
      latencyMs: Date.now() - startTime,
      speedTier: 'error',
      pongText: '',
      error: (err as Error).message,
      testedAt: Date.now(),
    };
  }
}

/**
 * Runs ping-pong benchmark in sequence across a list of models, reporting progress after each.
 */
export async function testBatchModels(
  models: Array<{ name: string; id?: string; provider?: string; providerId?: string; apiUrl?: string; apiKey?: string }>,
  onProgress?: (done: number, total: number, result: PingPongResult) => void,
  prompt = 'ping'
): Promise<PingPongResult[]> {
  const results: PingPongResult[] = [];
  const total = models.length;

  for (let i = 0; i < total; i++) {
    const m = models[i];
    const res = await testSingleModel(m, prompt);
    results.push(res);
    if (onProgress) {
      onProgress(i + 1, total, res);
    }
  }

  return results;
}
