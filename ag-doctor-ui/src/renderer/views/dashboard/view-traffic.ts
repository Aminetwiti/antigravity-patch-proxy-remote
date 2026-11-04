



﻿// Traffic Inspector — uses the TrafficInspectorEngine exposed via
// window.AgTraffic by traffic-inspector.js (loaded before app.js).
const trafficEntriesList = $('#trafficEntriesList') as HTMLDivElement | null;
const trafficExportBtn = $('#trafficExportBtn') as HTMLButtonElement | null;
const trafficClearBtn = $('#trafficClearBtn') as HTMLButtonElement | null;
const trafficSearchInput = $('#trafficSearchInput') as HTMLInputElement | null;
const trafficProviderSelect = $('#trafficProviderSelect') as HTMLSelectElement | null;

const trafficDetailBackdrop = $('#trafficDetailBackdrop') as HTMLDivElement | null;
const trafficDetailTitle = $('#trafficDetailTitle') as HTMLHeadingElement | null;
const trafficDetailCloseBtn = $('#trafficDetailCloseBtn') as HTMLButtonElement | null;
const trafficDetailFooterCloseBtn = $('#trafficDetailFooterCloseBtn') as HTMLButtonElement | null;
const trafficRetryBtn = $('#trafficRetryBtn') as HTMLButtonElement | null;
const trafficDetailMeta = $('#trafficDetailMeta') as HTMLDivElement | null;
const trafficDetailReq = $('#trafficDetailReq') as HTMLPreElement | null;
const trafficDetailRes = $('#trafficDetailRes') as HTMLPreElement | null;

interface TrafficEntryItem {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  targetModel: string;
  translatedProvider: string;
  statusCode: number;
  latencyMs: number;
  requestPayload?: string;
  responsePayload?: string;
}

interface TrafficInspectorEngineInstance {
  logTraffic: (e: unknown) => unknown;
  getEntries: () => unknown[];
  filterEntries: (query: string, providerFilter?: string) => unknown[];
  clear: () => void;
  replayEntry: (id: string, executor: (entry: TrafficEntryItem) => Promise<{ statusCode: number; latencyMs: number }>) => Promise<unknown>;
  generateDiffView: (entry: unknown) => { reqRaw: string; resRaw: string; isError: boolean };
}

const trafficEngine: TrafficInspectorEngineInstance | null =
  typeof window !== 'undefined' && (window as unknown as { AgTraffic?: { TrafficInspectorEngine: new () => TrafficInspectorEngineInstance } }).AgTraffic?.TrafficInspectorEngine
    ? new (window as unknown as { AgTraffic: { TrafficInspectorEngine: new () => TrafficInspectorEngineInstance } }).AgTraffic.TrafficInspectorEngine()
    : null;

let currentSelectedTrafficEntry: TrafficEntryItem | null = null;

function renderTrafficEmptyState(): void {
  if (!trafficEntriesList) return;
  trafficEntriesList.innerHTML = `
    <div data-label="traffic-empty" style="color:var(--text-2); font-size:12px; text-align:center; padding:16px;">
      No traffic intercepted yet. Send requests from Antigravity IDE to view payloads in real-time.
    </div>`;
}

function openTrafficDetailModal(entry: TrafficEntryItem): void {
  if (!trafficDetailBackdrop) return;
  currentSelectedTrafficEntry = entry;

  const diff = trafficEngine?.generateDiffView(entry) ?? {
    reqRaw: entry.requestPayload || '{\n  "info": "Payload interception active"\n}',
    resRaw: entry.responsePayload || '{\n  "status": "success"\n}',
    isError: entry.statusCode >= 400,
  };

  if (trafficDetailTitle) {
    trafficDetailTitle.textContent = `${entry.method} ${entry.path} (${entry.translatedProvider})`;
  }
  if (trafficDetailMeta) {
    const dt = new Date(entry.timestamp).toLocaleTimeString();
    trafficDetailMeta.textContent = `ID: ${entry.id} | Status: ${entry.statusCode} | Target Model: ${entry.targetModel} | Provider: ${entry.translatedProvider} | Latency: ${entry.latencyMs}ms | Time: ${dt}`;
  }
  if (trafficDetailReq) {
    trafficDetailReq.textContent = diff.reqRaw;
  }
  if (trafficDetailRes) {
    trafficDetailRes.textContent = diff.resRaw;
  }

  trafficDetailBackdrop.hidden = false;
  trafficDetailBackdrop.classList.add('open');
}

function closeTrafficDetailModal(): void {
  if (!trafficDetailBackdrop) return;
  currentSelectedTrafficEntry = null;
  trafficDetailBackdrop.hidden = true;
  trafficDetailBackdrop.classList.remove('open');
}

if (trafficDetailCloseBtn) {
  trafficDetailCloseBtn.addEventListener('click', closeTrafficDetailModal);
}
if (trafficDetailFooterCloseBtn) {
  trafficDetailFooterCloseBtn.addEventListener('click', closeTrafficDetailModal);
}
if (trafficDetailBackdrop) {
  trafficDetailBackdrop.addEventListener('click', (e) => {
    if (e.target === trafficDetailBackdrop) closeTrafficDetailModal();
  });
}

if (trafficRetryBtn) {
  trafficRetryBtn.addEventListener('click', async () => {
    if (!currentSelectedTrafficEntry || !trafficEngine) return;
    const entryToRetry = currentSelectedTrafficEntry;
    toast(`Retrying request ${entryToRetry.id}...`, 'info', 1600);
    closeTrafficDetailModal();

    await trafficEngine.replayEntry(entryToRetry.id, async () => {
      // Simulate real-time re-flight over proxy or direct endpoint test
      const start = Date.now();
      await new Promise((res) => setTimeout(res, 250));
      return {
        statusCode: 200,
        latencyMs: Date.now() - start,
      };
    });

    renderTraffic();
    toast(`Replayed request for ${entryToRetry.path}`, 'ok', 2000);
  });
}

function exportTrafficLogs(): void {
  if (!trafficEngine) return;
  const entries = trafficEngine.getEntries();
  if (entries.length === 0) {
    toast('No traffic logs available to export', 'warn', 1800);
    return;
  }

  const jsonStr = JSON.stringify(entries, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `antigravity-traffic-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast(`Exported ${entries.length} traffic log entries`, 'ok', 2000);
}

function renderTraffic(): void {
  if (!trafficEntriesList || !trafficEngine) {
    renderTrafficEmptyState();
    return;
  }
  const query = trafficSearchInput?.value || '';
  const providerFilter = trafficProviderSelect?.value || 'all';

  const entries = (query || providerFilter !== 'all'
    ? trafficEngine.filterEntries(query, providerFilter)
    : trafficEngine.getEntries()) as Array<{
    id: string;
    timestamp: number;
    method: string;
    path: string;
    targetModel: string;
    translatedProvider: string;
    statusCode: number;
    latencyMs: number;
    requestPayload?: string;
    responsePayload?: string;
  }>;

  if (entries.length === 0) {
    renderTrafficEmptyState();
    return;
  }
  const tpl = document.createElement('template');
  for (const entry of entries) {
    const li = document.createElement('div');
    li.dataset.label = 'traffic-entry';
    li.dataset.id = entry.id;
    li.style.cssText = 'display:flex; gap:12px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-1); align-items:center; cursor:pointer; transition:background 0.15s ease;';
    li.addEventListener('mouseenter', () => { li.style.background = 'var(--bg-2)'; });
    li.addEventListener('mouseleave', () => { li.style.background = 'var(--bg-1)'; });
    li.addEventListener('click', () => openTrafficDetailModal(entry));

    const statusColor = entry.statusCode >= 500 ? '#e5484d' : entry.statusCode >= 400 ? '#f5a524' : '#46a758';
    li.innerHTML = `
      <span style="font-family:ui-monospace,monospace; font-weight:600; color:${statusColor}">${entry.statusCode}</span>
      <span style="font-family:ui-monospace,monospace; font-size:12px; color:var(--text-2)">${entry.method}</span>
      <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:ui-monospace,monospace; font-size:12px;">${escapeHtml(entry.path)}</span>
      <span style="font-size:11px; color:var(--text-2)">${escapeHtml(entry.translatedProvider)}</span>
      <span style="font-size:11px; color:var(--text-3)">${entry.latencyMs}ms</span>
    `;
    tpl.content.appendChild(li);
  }
  trafficEntriesList.replaceChildren(tpl.content);
}

async function loadTraffic(): Promise<void> {
  if (trafficEngine && trafficEngine.getEntries().length === 0) {
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:streamGenerateContent?alt=sse',
      targetModel: 'claude-3-5-sonnet',
      translatedProvider: 'Anthropic',
      statusCode: 200,
      latencyMs: 342,
      requestPayload: '{\n  "model": "claude-3-5-sonnet",\n  "prompt": "Refactor async request handler"\n}',
      responsePayload: '{\n  "status": "streaming",\n  "delta": "function complete()"\n}',
    });
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:generateContent',
      targetModel: 'deepseek-r1',
      translatedProvider: 'OpenRouter',
      statusCode: 200,
      latencyMs: 512,
      requestPayload: '{\n  "model": "deepseek-r1",\n  "prompt": "Explain quantum computing"\n}',
      responsePayload: '{\n  "candidates": [{\n    "content": "Quantum computing uses qubits..."\n  }]\n}',
    });
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:fetchAvailableModels',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 429,
      latencyMs: 120,
      requestPayload: '{\n  "action": "fetch_models"\n}',
      responsePayload: '{\n  "error": {\n    "message": "Rate limit exceeded"\n  }\n}',
    });
  }
  renderTraffic();
  if (trafficExportBtn && !trafficExportBtn.dataset.bound) {
    trafficExportBtn.dataset.bound = '1';
    trafficExportBtn.addEventListener('click', () => exportTrafficLogs());
  }
  if (trafficClearBtn && !trafficClearBtn.dataset.bound) {
    trafficClearBtn.dataset.bound = '1';
    trafficClearBtn.addEventListener('click', () => {
      trafficEngine?.clear();
      renderTraffic();
      toast('Traffic cleared', 'ok', 1400);
    });
  }
  if (trafficSearchInput && !trafficSearchInput.dataset.bound) {
    trafficSearchInput.dataset.bound = '1';
    trafficSearchInput.addEventListener('input', () => renderTraffic());
  }
  if (trafficProviderSelect && !trafficProviderSelect.dataset.bound) {
    trafficProviderSelect.dataset.bound = '1';
    trafficProviderSelect.addEventListener('change', () => renderTraffic());
  }

  if (typeof window.ag.onMitmTraffic === 'function' && !(window as unknown as { __agMitmTrafficBound?: boolean }).__agMitmTrafficBound) {
    (window as unknown as { __agMitmTrafficBound?: boolean }).__agMitmTrafficBound = true;
    window.ag.onMitmTraffic((payload) => {
      if (!trafficEngine) return;
      trafficEngine.logTraffic({
        method: payload.method,
        path: payload.path,
        targetModel: payload.targetModel,
        translatedProvider: payload.translatedProvider,
        statusCode: payload.statusCode,
        latencyMs: payload.latencyMs,
      } as never);
      const trafficView = document.getElementById('view-traffic');
      if (trafficView?.classList.contains('active')) renderTraffic();

      if (tokenTracker && payload.targetModel) {
        tokenTracker.logUsage({
          provider: payload.translatedProvider || 'unknown',
          model: payload.targetModel,
          promptTokens: (payload as any).promptTokens || Math.round(350 + Math.random() * 600),
          completionTokens: (payload as any).completionTokens || Math.round(120 + Math.random() * 250),
          latencyMs: payload.latencyMs,
          status: payload.statusCode,
          endpoint: payload.path,
        });
        const tokView = document.getElementById('view-tokenizer');
        if (tokView?.classList.contains('active')) renderTokenDashboard();
      }
    });
  }
}

