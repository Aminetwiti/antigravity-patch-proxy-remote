import {
  parseLogLine,
  getLogDedupKey,
  highlightText,
  LogLevel,
  matchesFacetedQuery,
  sanitizeLogText,
  ParsedLogEntry,
} from '../../components/logs/log-viewer';
import { LogMinimap } from '../../components/logs/log-minimap';
import { LogInspectorDrawer } from '../../components/logs/log-inspector';

// ─────────────────────────────────────────────────────────────────────────────
// Structured log helpers (dedup, level classification, noise filter)
// ─────────────────────────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

let currentSearchQuery = '';

const logsCounters: Record<string, number> = {
  total: 0,
  deduped: 0,
  info: 0,
  warn: 0,
  error: 0,
  panic: 0,
  noise: 0,
};

let logsMinimapInstance: LogMinimap | null = null;
let logsVelocityCount = 0;

const logsDedupState = {
  lastKey: '',
  lastEl: null as HTMLElement | null,
  count: 1,
};

function resetLogsDedupState(): void {
  logsDedupState.lastKey = '';
  logsDedupState.lastEl = null;
  logsDedupState.count = 1;
  logsCounters.total = 0;
  logsCounters.deduped = 0;
  logsCounters.info = 0;
  logsCounters.warn = 0;
  logsCounters.error = 0;
  logsCounters.panic = 0;
  logsCounters.noise = 0;
  if (logsMinimapInstance) {
    logsMinimapInstance.clear();
  }
}

const LOGS_MAX_LINES_DOM = 1000;

// Pre-cloned button template to eliminate per-line SVG HTML parsing
const logCopyBtnTemplate = document.createElement('button');
logCopyBtnTemplate.className = 'log-line-copy';
logCopyBtnTemplate.type = 'button';
logCopyBtnTemplate.title = 'Copy line';
logCopyBtnTemplate.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function appendLogLines(container: HTMLElement, raw: string): void {
  const lines = raw.split('\n');
  const fragment = document.createDocumentFragment();

  if (logsDedupState.lastEl && !logsDedupState.lastEl.isConnected && !fragment.contains(logsDedupState.lastEl)) {
    logsDedupState.lastEl = null;
    logsDedupState.lastKey = '';
    logsDedupState.count = 1;
  }

  const chunkMinimapEntries: Array<{ level: string }> = [];

  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(ANSI_RE, '').trimEnd();
    if (!cleanLine) continue;

    const parsed = parseLogLine(cleanLine);
    const repeatInc = parsed.repeatCount ?? 1;
    const dedupKey = getLogDedupKey(parsed);

    logsCounters.total += repeatInc;
    if (logsCounters[parsed.level] !== undefined) {
      logsCounters[parsed.level] += repeatInc;
    }
    if (parsed.isNoise) logsCounters.noise += repeatInc;
    logsVelocityCount += repeatInc;
    chunkMinimapEntries.push({ level: parsed.level });

    // Dedup: collapse consecutive identical messages (ignoring timestamp differences) into ×N badge
    if (dedupKey === logsDedupState.lastKey && logsDedupState.lastEl) {
      logsDedupState.count += repeatInc;
      logsCounters.deduped += repeatInc;
      if (parsed.time) {
        const timeEl = logsDedupState.lastEl.querySelector('.log-time');
        if (timeEl) timeEl.textContent = parsed.time;
      }
      let badge = logsDedupState.lastEl.querySelector('.log-dedup') as HTMLSpanElement;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'log-dedup';
        const msgEl = logsDedupState.lastEl.querySelector('.log-msg');
        if (msgEl && msgEl.nextSibling) {
          logsDedupState.lastEl.insertBefore(badge, msgEl.nextSibling);
        } else {
          logsDedupState.lastEl.appendChild(badge);
        }
      }
      badge.textContent = `×${logsDedupState.count}`;
      badge.title = `Repeated ${logsDedupState.count} times`;
      continue;
    }

    if (repeatInc > 1) {
      logsCounters.deduped += repeatInc - 1;
    }

    const div = document.createElement('div');
    const subClass = parsed.subsystem ? ` log-sub-${parsed.subsystem}` : '';
    div.className = `log-line log-${parsed.level}${subClass}${parsed.isNoise ? ' log-noise' : ''}`;
    div.dataset.level = parsed.level;
    div.dataset.raw = parsed.raw;
    div.dataset.msg = parsed.message;
    if (parsed.time) div.dataset.time = parsed.time;
    if (parsed.location) div.dataset.location = parsed.location;
    if (parsed.traceId) div.dataset.trace = parsed.traceId;
    if (parsed.subsystem) div.dataset.sub = parsed.subsystem;
    if (parsed.hasPayload) div.dataset.payload = '1';

    // Tag badge
    const tag = document.createElement('span');
    const badgeType = parsed.subsystem && (parsed.level === 'info' || parsed.subsystem === 'rotation')
      ? parsed.subsystem
      : parsed.level;
    tag.className = `log-tag log-tag-${badgeType}`;
    const tagLabels: Record<string, string> = {
      info: 'INFO',
      warn: 'WARN',
      error: 'ERR',
      panic: '!!',
      proxy: 'PROXY',
      auth: 'AUTH',
      rotation: 'ROTA',
      cooldown: 'COOL',
    };
    tag.textContent = tagLabels[badgeType] ?? parsed.level.toUpperCase();
    div.appendChild(tag);

    // Time
    if (parsed.time) {
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = parsed.time;
      div.appendChild(time);
    }

    // Location
    if (parsed.location) {
      const loc = document.createElement('span');
      loc.className = 'log-loc';
      loc.title = parsed.location;
      loc.textContent = parsed.location;
      div.appendChild(loc);
    }

    // Message
    const msg = document.createElement('span');
    msg.className = 'log-msg';
    if (currentSearchQuery) {
      msg.innerHTML = highlightText(parsed.message, currentSearchQuery);
    } else {
      msg.textContent = parsed.message;
    }
    div.appendChild(msg);

    // If line already carried a repeat count > 1 (e.g. from CLI collapsed output), render badge immediately
    if (repeatInc > 1) {
      const badge = document.createElement('span');
      badge.className = 'log-dedup';
      badge.textContent = `×${repeatInc}`;
      badge.title = `Repeated ${repeatInc} times`;
      div.appendChild(badge);
    }

    // Copy line button on hover (cloned, click handled by event delegation)
    const copyBtn = logCopyBtnTemplate.cloneNode(true);
    div.appendChild(copyBtn);

    if (currentSearchQuery && !cleanLine.toLowerCase().includes(currentSearchQuery)) {
      div.classList.add('search-hidden');
    }

    fragment.appendChild(div);

    logsDedupState.lastKey = dedupKey;
    logsDedupState.lastEl = div;
    logsDedupState.count = repeatInc;
  }

  if (logsMinimapInstance && chunkMinimapEntries.length > 0) {
    logsMinimapInstance.appendEntries(chunkMinimapEntries);
  }

  container.appendChild(fragment);

  // Fast atomic trim: remove oldest lines beyond LOGS_MAX_LINES_DOM (1000)
  const excess = container.childElementCount - LOGS_MAX_LINES_DOM;
  if (excess > 0) {
    if (excess >= container.childElementCount) {
      container.textContent = '';
      resetLogsDedupState();
    } else {
      const lastToRemove = container.children[excess - 1];
      if (container.firstElementChild && lastToRemove) {
        const range = document.createRange();
        range.setStartBefore(container.firstElementChild);
        range.setEndAfter(lastToRemove);
        range.deleteContents();
      }
    }
  }
}

function updateLogsStats(): void {
  const lineCountEl = document.getElementById('logsLineCount');
  const dedupCountEl = document.getElementById('logsDedupCount');
  if (lineCountEl) lineCountEl.textContent = `${logsCounters.total} lines`;
  if (dedupCountEl) dedupCountEl.textContent = `${logsCounters.deduped} deduped`;

  const cAll = document.getElementById('countAll');
  const cInfo = document.getElementById('countInfo');
  const cWarn = document.getElementById('countWarn');
  const cError = document.getElementById('countError');
  const cPanic = document.getElementById('countPanic');
  const panicBtn = document.getElementById('filterPanicBtn');

  if (cAll) cAll.textContent = String(logsCounters.total);
  if (cInfo) cInfo.textContent = String(logsCounters.info);
  if (cWarn) cWarn.textContent = String(logsCounters.warn);
  if (cError) cError.textContent = String(logsCounters.error);
  if (cPanic) cPanic.textContent = String(logsCounters.panic);

  if (panicBtn) {
    panicBtn.style.display = logsCounters.panic > 0 ? 'inline-flex' : 'none';
  }

  const cleanBtn = document.getElementById('logsCleanViewBtn');
  if (cleanBtn && cleanBtn.classList.contains('active')) {
    cleanBtn.title = `Clean View: ${logsCounters.noise} noise lines hidden`;
  }
}

// Reusable template for doctor output — avoids creating a new <template> each run
const logsDocTpl = document.createElement('template');





﻿// Logs view (streaming)
// ─────────────────────────────────────────────────────────────────────────────

const logsOutput = $('#logsOutput') as HTMLPreElement;
const logsFollowBtn = $('#logsFollowBtn') as HTMLButtonElement;
const logsClearBtn = $('#logsClearBtn') as HTMLButtonElement;
const logsCopyBtn = $('#logsCopyBtn') as HTMLButtonElement;
const logsFreezeBtn = $('#logsFreezeBtn') as HTMLButtonElement | null;
const logsExportGithubBtn = $('#logsExportGithubBtn') as HTMLButtonElement | null;
const logsVelocityBadge = $('#logsVelocity') as HTMLElement | null;
const logsMinimapCanvas = $('#logsMinimap') as HTMLCanvasElement | null;
const logsInspectorDrawerEl = $('#logsInspectorDrawer') as HTMLElement | null;

if (logsMinimapCanvas) {
  logsMinimapInstance = new LogMinimap(logsMinimapCanvas, logsOutput);
}

let logsInspectorInstance: LogInspectorDrawer | null = null;
if (logsInspectorDrawerEl) {
  logsInspectorInstance = new LogInspectorDrawer(logsInspectorDrawerEl, (actionId: string) => {
    if (actionId === 'nav-google-accounts') {
      const btn = $('#nav-tab-google-accounts') as HTMLButtonElement | null;
      btn?.click();
    } else if (actionId === 'nav-patch') {
      const btn = $('#nav-tab-patch') as HTMLButtonElement | null;
      btn?.click();
    } else if (actionId === 'proxy-restart') {
      void window.ag.run(['proxy', 'restart']).then(() => {
        toast('Proxy restart requested', 'ok', 2000);
      });
    }
  });
}

let logsStreamId: string | null = null;
let logsStreaming = false;
let logsFrozen = false;
let logsVelocityTimer: number | null = null;

// Streaming buffer: raw text chunks are concatenated and ANSI-converted ONCE
// per animation frame, then appended in a single DOM mutation. The previous
// implementation ran ansiToHtml on every chunk (N regex passes per flush
// window) — see audit finding P0.
// Hard cap on the rendered log buffer so a long stream cannot bloat the
// <pre> node past ~500 KB and stall layout. We keep the last ~400 KB.
const LOGS_MAX_BYTES = 250_000;
const LOGS_KEEP_BYTES = 150_000;
let logsPendingChunk: string | null = null;
let logsFlushScheduled = false;
const flushLogs = () => {
  logsFlushScheduled = false;
  if (logsPendingChunk) {
    if (logsFrozen) {
      // Frozen: pause visual DOM mutation while buffer accumulates in background
      return;
    }
    const chunk = logsPendingChunk;
    logsPendingChunk = null;
    const isNearBottom = logsOutput.scrollHeight - logsOutput.scrollTop - logsOutput.clientHeight < 100;
    appendLogLines(logsOutput, chunk);
    updateLogsStats();
    if (isNearBottom) {
      logsOutput.scrollTop = logsOutput.scrollHeight;
    }
  }
};
const scheduleLogsFlush = () => {
  if (logsFlushScheduled) return;
  logsFlushScheduled = true;
  requestAnimationFrame(flushLogs);
};

// Reusable template for terminal output — avoids creating a new <template> each load
const logsTpl = document.createElement('template');
const logsSkeleton = $('#logsSkeleton') as HTMLDivElement;

async function loadLogs(): Promise<void> {
  if (logsStreaming) return;
  setStatus('Loading logs…', 'busy');
  logsSkeleton.style.display = 'block';
  logsOutput.style.display = 'none';
  try {
    const r = await window.ag.run(['logs', '-n', '100', '--source', currentLogSource]);
    logsOutput.textContent = '';
    resetLogsDedupState();
    appendLogLines(logsOutput, r.stdout || r.stderr || '(empty)');
    updateLogsStats();
    logsOutput.scrollTop = logsOutput.scrollHeight;
    setStatus('Ready');
  } catch (e) {
    logsOutput.textContent = `Could not load logs: ${(e as Error).message}`;
    setStatus('Error', 'err');
  } finally {
    logsSkeleton.style.display = 'none';
    logsOutput.style.display = '';
  }
}

async function startLogStream(): Promise<void> {
  if (logsStreaming) return;
  logsStreaming = true;
  logsFollowBtn.innerHTML = '<span class="dot-live pulsing"></span> Stop';
  setStatus('Streaming logs…', 'busy');
  logsStreamId = `logs-${Date.now()}`;

  if (!logsVelocityTimer) {
    logsVelocityTimer = window.setInterval(() => {
      if (logsVelocityBadge) {
        logsVelocityBadge.textContent = `${logsVelocityCount}/s`;
      }
      const pace = logsVelocityCount > 20 ? '0.4s' : logsVelocityCount > 5 ? '0.8s' : '1.5s';
      document.documentElement.style.setProperty('--stream-pace', pace);
      logsVelocityCount = 0;
    }, 1000);
  }

  window.ag.onStreamData(logsStreamId, (chunk) => {
    logsPendingChunk = (logsPendingChunk ?? '') + chunk;
    if (logsPendingChunk.length > LOGS_MAX_BYTES) {
      logsPendingChunk = logsPendingChunk.slice(-LOGS_KEEP_BYTES);
    }
    scheduleLogsFlush();
  });
  window.ag.onStreamClose(logsStreamId, (code) => {
    flushLogs();
    void stopLogStream();
    setStatus(`Stream closed (${code})`);
  });
  window.ag.onStreamError(logsStreamId, (err) => {
    flushLogs();
    toast(`Stream error: ${err}`, 'err');
    void stopLogStream();
  });

  await window.ag.startStream(['logs', '-f', '--source', currentLogSource], logsStreamId);
}

async function stopLogStream(): Promise<void> {
  if (logsStreamId) {
    await window.ag.cancelStream(logsStreamId);
    logsStreamId = null;
  }
  if (logsVelocityTimer) {
    clearInterval(logsVelocityTimer);
    logsVelocityTimer = null;
  }
  if (logsVelocityBadge) logsVelocityBadge.textContent = '0/s';
  logsStreaming = false;
  logsFollowBtn.innerHTML = '<span class="dot-live"></span> Follow';
  setStatus('Ready');
}

logsFollowBtn.addEventListener('click', () => {
  if (logsStreaming) void stopLogStream();
  else void startLogStream();
});
logsClearBtn.addEventListener('click', async () => {
  logsOutput.textContent = '';
  resetLogsDedupState();
  updateLogsStats();
  try {
    await window.ag.run(['logs', '--clear', '--source', currentLogSource]);
  } catch (err) {
    console.error('Failed to clear logs on backend', err);
  }
  toast('Logs cleared', 'info', 1500);
});
logsCopyBtn.addEventListener('click', async () => {
  const lines = Array.from(logsOutput.querySelectorAll<HTMLElement>('.log-line:not(.search-hidden)'))
    .map((el) => el.dataset.raw || el.textContent || '')
    .filter(Boolean);
  const text = lines.length > 0 ? lines.join('\n') : (logsOutput.textContent ?? '');
  await navigator.clipboard.writeText(text);
  const origText = logsCopyBtn.innerHTML;
  logsCopyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
  setTimeout(() => { logsCopyBtn.innerHTML = origText; }, 2000);
  toast('Logs copied to clipboard', 'ok', 2000);
});

// Copy only errors and warnings
const logsCopyErrorsBtn = $('#logsCopyErrorsBtn') as HTMLButtonElement | null;
if (logsCopyErrorsBtn) {
  logsCopyErrorsBtn.addEventListener('click', async () => {
    const errorLines = Array.from(logsOutput.querySelectorAll<HTMLElement>('.log-line.log-error, .log-line.log-panic, .log-line.log-warn'))
      .map((el) => el.dataset.raw || el.textContent || '')
      .filter(Boolean);
    if (errorLines.length === 0) {
      toast('No errors or warnings in current logs', 'info', 1500);
      return;
    }
    await navigator.clipboard.writeText(errorLines.join('\n'));
    const origText = logsCopyErrorsBtn.innerHTML;
    logsCopyErrorsBtn.textContent = 'Copied!';
    setTimeout(() => { logsCopyErrorsBtn.innerHTML = origText; }, 2000);
    toast(`${errorLines.length} error/warn lines copied`, 'ok', 2000);
  });
}

// Freeze stream button
if (logsFreezeBtn) {
  logsFreezeBtn.addEventListener('click', () => {
    logsFrozen = !logsFrozen;
    logsFreezeBtn.classList.toggle('active', logsFrozen);
    logsFreezeBtn.textContent = logsFrozen ? 'Resume' : 'Freeze';
    toast(logsFrozen ? 'Stream frozen (still receiving in background)' : 'Stream resumed', 'info', 1500);
    if (!logsFrozen) {
      flushLogs();
    }
  });
}

// Export Sanitized Logs for GitHub Issue
if (logsExportGithubBtn) {
  logsExportGithubBtn.addEventListener('click', async () => {
    const lines = Array.from(logsOutput.querySelectorAll<HTMLElement>('.log-line:not(.search-hidden)'))
      .map((el) => el.dataset.raw || el.textContent || '')
      .filter(Boolean);
    const text = lines.length > 0 ? lines.join('\n') : (logsOutput.textContent ?? '');
    const sanitized = sanitizeLogText(text);
    const markdown = '```log\n' + sanitized + '\n```';
    await navigator.clipboard.writeText(markdown);
    toast(`Sanitized logs (${lines.length} lines) copied in Markdown for GitHub!`, 'ok', 2500);
  });
}

// Clean View filter (default ON)
logsOutput.classList.add('logs-hide-noise');
const logsCleanViewBtn = $('#logsCleanViewBtn') as HTMLButtonElement | null;
if (logsCleanViewBtn) {
  logsCleanViewBtn.addEventListener('click', () => {
    logsCleanViewBtn.classList.toggle('active');
    const isActive = logsCleanViewBtn.classList.contains('active');
    logsOutput.classList.toggle('logs-hide-noise', isActive);
    toast(isActive ? 'Clean View enabled (routine noise hidden)' : 'Showing all raw logs including noise', 'info', 1500);
  });
}

// Filter ALL button
const filterAllBtn = $('#filterAllBtn') as HTMLButtonElement | null;
if (filterAllBtn) {
  filterAllBtn.addEventListener('click', () => {
    ['info', 'warn', 'error', 'panic'].forEach((lvl) => {
      logsOutput.classList.remove(`logs-hide-${lvl}`);
      const btn = document.querySelector(`.logs-filter-btn[data-level="${lvl}"]`);
      btn?.classList.add('active');
    });
  });
}

// Logs level filter buttons (INFO, WARN, ERROR, PANIC)
const logsFilterButtons = $$<HTMLButtonElement>('.logs-filter-btn[data-level]:not([data-level="all"])');
logsFilterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.getAttribute('data-level');
    btn.classList.toggle('active');
    const isActive = btn.classList.contains('active');
    if (level === 'info') logsOutput.classList.toggle('logs-hide-info', !isActive);
    if (level === 'warn') logsOutput.classList.toggle('logs-hide-warn', !isActive);
    if (level === 'error') logsOutput.classList.toggle('logs-hide-error', !isActive);
    if (level === 'panic') logsOutput.classList.toggle('logs-hide-panic', !isActive);
  });
});

// Logs search input with real-time match counter, faceted filtering, and text highlighting
const logsSearchInput = $('#logsSearch') as HTMLInputElement | null;
const logsSearchCount = $('#logsSearchCount') as HTMLElement | null;

function applySearchFilter(query: string): void {
  currentSearchQuery = query;
  const lines = logsOutput.querySelectorAll<HTMLElement>('.log-line');
  let matchCount = 0;
  lines.forEach((el) => {
    const raw = el.dataset.raw || el.textContent || '';
    const msgEl = el.querySelector('.log-msg') as HTMLElement | null;
    const origMsg = el.dataset.msg || '';

    const entry: ParsedLogEntry = {
      raw,
      level: (el.dataset.level || 'info') as LogLevel,
      message: origMsg,
      isNoise: el.classList.contains('log-noise'),
      time: el.dataset.time,
      location: el.dataset.location,
      traceId: el.dataset.trace,
      subsystem: el.dataset.sub as any,
      hasPayload: el.dataset.payload === '1',
    };

    if (!query) {
      el.classList.remove('search-hidden');
      if (msgEl && origMsg) {
        msgEl.textContent = origMsg;
      }
      matchCount++;
    } else if (matchesFacetedQuery(entry, query)) {
      el.classList.remove('search-hidden');
      matchCount++;
      if (msgEl && origMsg) {
        const plainTerm = query.replace(/(?:lvl|level|sub|trace):[^\s]+/gi, '').replace(/-[^\s]+/g, '').trim();
        msgEl.innerHTML = plainTerm ? highlightText(origMsg, plainTerm) : escapeHtml(origMsg);
      }
    } else {
      el.classList.add('search-hidden');
    }
  });

  if (logsSearchCount) {
    if (!query) {
      logsSearchCount.textContent = '';
    } else {
      logsSearchCount.textContent = `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
    }
  }
}

if (logsSearchInput) {
  logsSearchInput.addEventListener('input', () => {
    applySearchFilter(logsSearchInput.value.trim().toLowerCase());
  });
}

// Floating scroll to bottom button
const logsScrollBottomBtn = $('#logsScrollBottomBtn') as HTMLButtonElement | null;
if (logsScrollBottomBtn) {
  let isScrollingTicking = false;
  logsOutput.addEventListener('scroll', () => {
    if (!isScrollingTicking) {
      isScrollingTicking = true;
      requestAnimationFrame(() => {
        isScrollingTicking = false;
        const distanceToBottom = logsOutput.scrollHeight - logsOutput.scrollTop - logsOutput.clientHeight;
        logsScrollBottomBtn.style.display = distanceToBottom > 160 ? 'inline-flex' : 'none';
      });
    }
  }, { passive: true });
  logsScrollBottomBtn.addEventListener('click', () => {
    logsOutput.scrollTo({ top: logsOutput.scrollHeight, behavior: 'smooth' });
    logsScrollBottomBtn.style.display = 'none';
  });
}

// Delegated click handler on logsOutput: copy button OR open inspector drawer
logsOutput.addEventListener('click', (ev) => {
  const copyBtn = (ev.target as HTMLElement)?.closest('.log-line-copy');
  if (copyBtn) {
    ev.stopPropagation();
    const lineEl = copyBtn.closest('.log-line') as HTMLElement | null;
    const raw = lineEl?.dataset.raw;
    if (raw) {
      void navigator.clipboard.writeText(raw);
      toast('Line copied', 'info', 1000);
    }
    return;
  }

  const lineEl = (ev.target as HTMLElement)?.closest('.log-line') as HTMLElement | null;
  if (!lineEl || !logsInspectorInstance) return;

  const raw = lineEl.dataset.raw || lineEl.textContent || '';
  const parsed = parseLogLine(raw);
  logsInspectorInstance.open(parsed);
});

// Global keyboard shortcuts for logs management
window.addEventListener('keydown', (ev) => {
  const viewLogs = $('#view-logs');
  const isLogsActive = viewLogs && getComputedStyle(viewLogs).display !== 'none';
  if (!isLogsActive) return;

  // Esc closes inspector drawer
  if (ev.key === 'Escape' && logsInspectorInstance?.isOpen()) {
    logsInspectorInstance.close();
    return;
  }

  // Ctrl+F or Cmd+F focuses search input
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') {
    if (logsSearchInput && document.activeElement !== logsSearchInput) {
      ev.preventDefault();
      logsSearchInput.focus();
      logsSearchInput.select();
    }
    return;
  }

  // Space (when not typing in an input) toggles freeze
  if (ev.key === ' ' && document.activeElement !== logsSearchInput && (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
    ev.preventDefault();
    logsFreezeBtn?.click();
    return;
  }

  // Ctrl+Shift+L toggles Clean View
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'l') {
    ev.preventDefault();
    logsCleanViewBtn?.click();
    return;
  }

  // Ctrl+K clears logs
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    logsClearBtn.click();
    return;
  }
});

// Logs tabs: switch between log sources
let currentLogSource = 'language_server';
const logsTabs = $$('#logsTabs .tab');
logsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const source = tab.dataset.source ?? 'language_server';
    if (source === currentLogSource) return;
    logsTabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    currentLogSource = source;
    if (logsStreaming) {
      void stopLogStream().then(() => void startLogStream());
    } else {
      void loadLogs();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
