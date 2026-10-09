/**
 * ag-doctor-ui structured log viewer engine
 * High-performance parsing, classification, noise filtering and highlighting
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'panic';

export interface ParsedLogEntry {
  raw: string;
  level: LogLevel;
  time?: string;
  location?: string;
  message: string;
  isNoise: boolean;
  repeatCount?: number;
  subsystem?: 'proxy' | 'auth' | 'rotation' | 'cooldown';
  traceId?: string;
  hasPayload?: boolean;
  jsonPayload?: unknown;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Match Google glog format with optional wrappers like "[INFO] OR: logging before google.Init:"
const GLOG_RE = /^(?:.*?(?:ERROR|OR):\s+logging\s+before\s+google\.Init:\s+)?([IWEF])\d{4}\s+(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\d*\s+\d+\s+([^:\]\s]+:\d+)\]\s*(.*)$/;
const ELECTRON_LOG_RE = /^\[?((?:\d{1,4}-)?\d{2}-\d{2}[T\s](\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z?))\]?\s+\[(info|warn|error|debug|verbose)\]\s*(.*)$/i;
const ISO_TIMESTAMP_LOG_RE = /^\[?(\d{4}-\d{2}-\d{2}[T\s](\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z?))\]?[\s:-]+(.*)$/;
const SIMPLE_TIME_LOG_RE = /^\[?(\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?)\]?[\s:-]+(.*)$/;
const REPEAT_SUFFIX_RE = /\s*(?:\([×x](\d+)\)|×(\d+))\s*$/i;

const NOISE_PATTERNS = [
  // HTTP proxy traffic — normal operation
  /http_helpers\.go:\d+\]\s*URL:\s*http:\/\//,
  /Trace:\s*0x[0-9a-f]+/,
  /ResponseID:\s*[A-Za-z0-9_-]+/,
  // Config / component resolution warnings — harmless
  /skipping\s+component\s+during\s+resolution:\s+empty\s+component/,
  /unexpected\s+status\s+CORTEX_STEP_STATUS_CANCELED/,
  // Linux/eval mode warnings on Windows — expected
  /Entering\s+local\s+chrome\s+mode!/,
  /failed\s+to\s+get\s+cs\s+path/,
  // Git bundle syncer — unsupported in this Windows build
  /Failed\s+to\s+create\s+git\s+bundle\s+syncer/,
  // CDP Electron DevTools discovery duplicates
  /\[CDP\s+Discovery\]\s+Successfully\s+discovered/,
  // TLS probe false-positive (fixed in scanner.go)
  /client\s+sent\s+an\s+HTTP\s+request\s+to\s+an\s+HTTPS\s+server/,
  // RemoteControl / Mendel flags — disabled in non-Google env
  /Mendel\s+flag\s+is\s+off/,
  /\[RemoteControl\]\s+(?:Subscription\s+callback\s+triggered|Staying\s+disconnected|Resolved\s+proxyServerURL)/,
  /\[RemoteControl\]\s+RemoteControlEnabled\s+value/,
  // Auth provider routine set calls at startup
  /\[AuthProvider\]\s+Set(?:UserTier|ProjectID|Location|EnterBusinessLogin)\s+called/,
  /\[AuthProvider\]\s+UpdateEndpointURL\s+skipping/,
  // Latency metrics — perf data, not errors
  /SEND_USER_CASCADE_MESSAGE_LATENCY/,
  /latency_breakdown\.go/,
  // Cascade force-stop on existing conversations (normal shutdown)
  /Cancel\s+during\s+force\s+stop\s+of\s+conversation.*executor\s+is\s+not\s+currently\s+running/,
  // Test cascade / gRPC cancellations from daemon unit tests
  /CancelCascadeInvocation.*cascade\s+not\s+found/,
  /LoadTrajectory\s+LoadUnsafe\s+failed\s+for\s+(?:casc-|session-cancel)/,
  // Ripgrep parse errors on special-char filenames — Go binary bug, non-blocking
  /Error\s+parsing\s+grep\s+result:\s+strconv\.Atoi/,
  // Migration skips — already completed at install
  /Migration\s+\[MIGRATION_ID_[A-Z_]+\]\s+(?:is\s+disabled|already\s+has\s+status\s+MIGRATION_STATUS_COMPLETED)/,
  // Summary store reconciliation — startup bookkeeping
  /summary\s+store:\s+(?:starting\s+background\s+reconciliation|reconciliation\s+complete)/,
  // Continuous profiler disabled
  /Continuous\s+pprof\s+profiling\s+is\s+disabled/,
  // Auth refresh and state
  /Auth\s+succeeded,\s+refreshing\s+features/,
  /State\s+refresh\s+took\s+\d+ms/,
  /Retroactive\s+projects\s+migration\s+enabled/,
  /Projects\s+migration\s+already\s+started/,
  // Startup banners
  /Serving\s+UI\s+bundle\s+from\s+embedded\s+assets/,
  /initialized\s+server\s+successfully/,
  /Using\s+bundled\s+agy-node/,
  /Creating\s+trajectory\s+store\s+manager/,
  // Routine checkpoint truncation when trajectory history grows
  /step_string_converters\.go/,
  /Checkpoint\s+summary\s+was\s+too\s+long/,
  // Background input detection model cancellation (normal when command terminates)
  /error\s+during\s+input\s+detection\s+model\s+call.*context\s+canceled/,
  /run_command_handler\.go:\d+\]\s*error\s+during\s+input\s+detection/,
  // Missing legacy trajectory file warning (orphan record during reconcile)
  /failed\s+to\s+load\s+external\s+trajectory.*cannot\s+find\s+the\s+file\s+specified/,
  // Remote daemon / pin gate internal notifications
  /fastpush\s+pin\s+gate/,
  /Remote\s+agent\s+fastpush/,
  /Setting\s+GOMAXPROCS/,
  // Routine Antigravity safety monitors & LLM risk evaluators (benign internal probes)
  /Monitor\s+(?:severe_internal_risks_agy|agy_tool_safety)/,
  /LLM\s+Monitor\s+severe_internal_risks_agy/,
  /LLM_MONITOR_LLM_CALL_FAILED/,
  /Trajectory\s+formatted,\s+length:\s+\d+/,
  /errorreport\.go:\d+\]\s+executor\s+is\s+not\s+currently\s+running/,
  /jetskiContextProvider:\s+unrecognized\s+model\s+string/,
  // Engine boilerplate & startup noise
  /^[=\-_*#]{3,}$/,
  /\(Use `?Antigravity --trace-warnings/i,
  /Power save blocker started/i,
  /\[IDE Wizard\]/i,
  /(?:p|e)rsisted state: budget=/i,
  /(?:Local|LS Logs|Electron Logs):\s+/i,
  /waiting for response headers after/i,
  /json changed on disk\. Invalidating model caches/i,
  /efresh failed with status 500|"error":\s*"internal_failure"/i,
  /ng auto update checks|\d+\.\d+ is not available \(latest version/i,
  /(?:l|nternal):streamGenerateContent\?alt=sse/i,
  /Starting app \(v\d+\.\d+\.\d+\) with dynamic port/i,
  /Host bridge server listening on/i,
];

export function isLogNoise(text: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

export function classifyLogLevel(line: string): LogLevel {
  if (/panic:|goroutine \d+ \[running\]|runtime error|signal 0x/i.test(line)) return 'panic';
  if (/\b[EF]\d{4}\b|errorreport\.go/i.test(line)) return 'error';
  if (/\bW\d{4}\b/i.test(line)) return 'warn';
  return 'info';
}

export function parseLogLine(raw: string): ParsedLogEntry {
  let clean = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  let repeatCount = 1;
  const repeatMatch = REPEAT_SUFFIX_RE.exec(clean);
  if (repeatMatch) {
    repeatCount = parseInt(repeatMatch[1] || repeatMatch[2], 10) || 1;
    clean = clean.slice(0, repeatMatch.index).trimEnd();
  }

  const match = GLOG_RE.exec(clean);

  if (match) {
    const code = match[1];
    let level: LogLevel = 'info';
    if (code === 'W') level = 'warn';
    else if (code === 'E' || code === 'F') level = 'error';

    if (/panic:|runtime error|signal 0x/i.test(match[4])) {
      level = 'panic';
    }

    return enrichLogEntry({
      raw: clean,
      level,
      time: match[2],
      location: match[3],
      message: match[4],
      isNoise: isLogNoise(clean),
      repeatCount,
    });
  }

  const electronMatch = ELECTRON_LOG_RE.exec(clean);
  if (electronMatch) {
    const lvlStr = electronMatch[3].toLowerCase();
    let level: LogLevel = 'info';
    if (lvlStr === 'warn') level = 'warn';
    else if (lvlStr === 'error') level = 'error';

    const content = electronMatch[4];
    if (level === 'info') {
      if (/panic:|runtime error|signal 0x/i.test(content)) {
        level = 'panic';
      } else if (/HTTP\s*(?:500|502|503|504)|All remaining accounts in pool are in cooldown/i.test(content)) {
        level = 'error';
      } else if (/⚠️|HTTP\s*429|cooldown to prevent stalling|failed upstream/i.test(content)) {
        level = 'warn';
      }
    }

    let subsystem: 'proxy' | 'auth' | 'rotation' | 'cooldown' | undefined;
    if (/\[Proxy\]/i.test(content)) {
      if (/Cooldown Verification/i.test(content)) subsystem = 'cooldown';
      else if (/Rotation|fallback|Fast-skipping candidate/i.test(content)) subsystem = 'rotation';
      else subsystem = 'proxy';
    } else if (/\[GoogleAuth\]/i.test(content)) {
      subsystem = 'auth';
    }

    return enrichLogEntry({
      raw: clean,
      level,
      time: electronMatch[2],
      message: content,
      isNoise: isLogNoise(clean),
      repeatCount,
      subsystem,
    });
  }

  const isoMatch = ISO_TIMESTAMP_LOG_RE.exec(clean);
  if (isoMatch) {
    const level = classifyLogLevel(isoMatch[3]);
    return enrichLogEntry({
      raw: clean,
      level,
      time: isoMatch[2],
      message: isoMatch[3],
      isNoise: isLogNoise(clean),
      repeatCount,
    });
  }

  const timeMatch = SIMPLE_TIME_LOG_RE.exec(clean);
  if (timeMatch) {
    const level = classifyLogLevel(timeMatch[2]);
    return enrichLogEntry({
      raw: clean,
      level,
      time: timeMatch[1],
      message: timeMatch[2],
      isNoise: isLogNoise(clean),
      repeatCount,
    });
  }

  // Strip redundant CLI prefixes like "ℹ️  [INFO] ", "i [INFO] ", "[INFO] ", "✖ [ERREUR] ", "⚠ [AVERT] "
  let fallbackMsg = clean;
  let inferredLevel: LogLevel | undefined;
  const prefixMatch = /^(?:[ℹ️ℹ✖⚠✔🚀🌐📡🔑📚👤📁▶]\s*)?\[(INFO|WARN|ERROR|ERR|DEBUG|ERREUR|AVERT)\]\s*/i.exec(clean);
  if (prefixMatch) {
    const rawTag = prefixMatch[1].toUpperCase();
    if (rawTag === 'ERROR' || rawTag === 'ERR' || rawTag === 'ERREUR') inferredLevel = 'error';
    else if (rawTag === 'WARN' || rawTag === 'AVERT') inferredLevel = 'warn';
    else if (rawTag === 'INFO') inferredLevel = 'info';
    fallbackMsg = clean.slice(prefixMatch[0].length).trimStart();
  }

  let subsystem: 'proxy' | 'auth' | 'rotation' | 'cooldown' | undefined;
  if (/\[(?:FALLBACK|ROTATION)\]|Rotation|fallback/i.test(clean)) {
    subsystem = 'rotation';
    if (!inferredLevel || inferredLevel === 'info') inferredLevel = 'warn';
  } else if (/\[(?:COOLDOWN)\]|Cooldown Verification/i.test(clean)) {
    subsystem = 'cooldown';
  } else if (/\[(?:PROXY|REQUÊTE)\]|\[Proxy\]/i.test(clean)) {
    subsystem = 'proxy';
  } else if (/\[(?:AUTH)\]|\[GoogleAuth\]/i.test(clean)) {
    subsystem = 'auth';
  }

  if (inferredLevel === 'info' || !inferredLevel) {
    if (/panic:|runtime error|signal 0x/i.test(clean)) inferredLevel = 'panic';
    else if (/HTTP\s*(?:500|502|503|504)|All remaining accounts in pool are in cooldown/i.test(clean)) inferredLevel = 'error';
    else if (/⚠️|HTTP\s*429|cooldown to prevent stalling|failed upstream/i.test(clean)) inferredLevel = 'warn';
  }

  const level = inferredLevel || classifyLogLevel(clean);
  return enrichLogEntry({
    raw: clean,
    level,
    message: fallbackMsg,
    isNoise: isLogNoise(clean),
    repeatCount,
    subsystem,
  });
}

function enrichLogEntry(entry: ParsedLogEntry): ParsedLogEntry {
  const traceMatch = /\bTrace:\s*(0x[0-9a-fA-F]+)\b/.exec(entry.raw);
  if (traceMatch) {
    entry.traceId = traceMatch[1];
  }

  const jsonStart = entry.message.indexOf('{');
  const jsonEnd = entry.message.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const candidate = entry.message.slice(jsonStart, jsonEnd + 1);
      entry.jsonPayload = JSON.parse(candidate);
      entry.hasPayload = true;
    } catch {
      // Not valid json, ignore
    }
  }
  return entry;
}

export function matchesFacetedQuery(entry: ParsedLogEntry, query: string): boolean {
  if (!query || !query.trim()) return true;
  const terms = query.trim().split(/\s+/);

  for (const term of terms) {
    if (!term) continue;
    const lower = term.toLowerCase();
    if (lower.startsWith('lvl:') || lower.startsWith('level:')) {
      const targetLvl = lower.includes(':') ? lower.split(':')[1] : '';
      if (entry.level !== targetLvl) return false;
    } else if (lower.startsWith('sub:')) {
      const targetSub = lower.split(':')[1];
      if (entry.subsystem !== targetSub) return false;
    } else if (lower.startsWith('trace:')) {
      const targetTrace = lower.split(':')[1];
      if (!entry.traceId || !entry.traceId.toLowerCase().includes(targetTrace)) return false;
    } else if (lower === '-noise') {
      if (entry.isNoise) return false;
    } else if (lower.startsWith('-')) {
      const excludeTerm = lower.slice(1);
      if (excludeTerm && entry.raw.toLowerCase().includes(excludeTerm)) return false;
    } else {
      if (!entry.raw.toLowerCase().includes(lower)) return false;
    }
  }
  return true;
}

export function sanitizeLogText(rawText: string): string {
  return rawText
    // API keys: AIza..., sk-ant-..., sk-..., ghp_...
    .replace(/\bAIza[a-zA-Z0-9_\-]{30,40}\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\bsk-ant-[a-zA-Z0-9_\-]{20,}\b/g, '[REDACTED_ANTHROPIC_KEY]')
    .replace(/\bsk-[a-zA-Z0-9_\-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9_]{30,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    // Authorization / Bearer tokens
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]{10,}/gi, '$1[REDACTED_BEARER_TOKEN]')
    // Windows usernames in file paths: C:\Users\<username>\...
    .replace(/([A-Z]:\\Users\\)[^\\]+(\\)/gi, '$1<user>$2')
    // Unix usernames in paths: /home/<username>/...
    .replace(/(\/home\/)[^\/]+(\/)/g, '$1<user>$2');
}

export function getLogDedupKey(entry: ParsedLogEntry): string {
  const normMsg = (entry.message || entry.raw)
    .replace(/\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]?/g, '')
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '')
    .trim();
  return `${entry.level}:${entry.location || ''}:${normMsg}`;
}

export function highlightText(text: string, query: string): string {
  if (!query || !query.trim()) {
    return escapeHtml(text);
  }
  const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);
  return parts
    .map((part) => {
      if (part.toLowerCase() === query.trim().toLowerCase()) {
        return `<mark class="log-hl">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

export type LogFacet = 'all' | 'proxy' | 'rotation' | 'cooldown' | 'auth' | 'error' | 'fallback';

export function filterByFacet(entries: ParsedLogEntry[], facet: LogFacet): ParsedLogEntry[] {
  if (facet === 'all') return [...entries];
  return entries.filter((entry) => {
    const raw = entry.raw;
    const msg = entry.message;
    switch (facet) {
      case 'proxy':
        return entry.subsystem === 'proxy' || /\[(?:PROXY|REQUÊTE)\]|\[Proxy\]|streamGenerateContent/i.test(raw);
      case 'rotation':
        return (!/\[Model Fallback\]|fallback model/i.test(raw)) && (entry.subsystem === 'rotation' || /\[(?:ROTATION)\]|\[Account Rotation\]|Fast-skipping candidate|Rotating to next/i.test(raw));
      case 'cooldown':
        return entry.subsystem === 'cooldown' || /\[(?:COOLDOWN)\]|Cooldown Verification|active cooldown/i.test(raw);
      case 'auth':
        return entry.subsystem === 'auth' || /\[(?:AUTH)\]|\[GoogleAuth\]|access token|Live quota for/i.test(raw);
      case 'error':
        return entry.level === 'error' || entry.level === 'panic' || /HTTP\s*(?:400|401|403|429|500|502|503|504)|INVALID_ARGUMENT|RESOURCE_EXHAUSTED/i.test(raw);
      case 'fallback':
        return /\[Model Fallback\]|fallback model|Cross-model fallback/i.test(raw);
      default:
        return true;
    }
  });
}

export function filterSignalOnly(entries: ParsedLogEntry[]): ParsedLogEntry[] {
  return entries.filter((entry) => !entry.isNoise);
}

export interface ErrorExplanation {
  code: string | number;
  title: string;
  explanation: string;
  recommendation: string;
  actionLabel: string;
  actionId: string;
}

export function explainError(entry: ParsedLogEntry): ErrorExplanation | null {
  const text = `${entry.message} ${entry.raw}`;

  if (/HTTP\s*400|INVALID_ARGUMENT|Request contains an invalid argument/i.test(text)) {
    return {
      code: 400,
      title: 'HTTP 400 — Invalid Argument / Payload Format',
      explanation: 'The upstream Google Cloud Code API rejected the request payload formatting, often due to an invalid generationConfig, thinkingConfig, or empty thoughts block.',
      recommendation: 'Automatic generationConfig sanitization & thinking block repair is active in proxy. Check model parameter compatibility.',
      actionLabel: 'Inspect Payload',
      actionId: 'inspect-payload',
    };
  }

  if (/HTTP\s*429|RESOURCE_EXHAUSTED|Rate limit|Quota exceeded/i.test(text)) {
    return {
      code: 429,
      title: 'HTTP 429 — Rate Limit / Quota Exhaustion',
      explanation: 'The active account has exhausted its rate limit (RPM) or 5-hour rolling token quota for this model family.',
      recommendation: 'Smart rotation is cycling through candidate accounts. If pool is exhausted, cross-model cascade to Claude Sonnet/Opus is triggered automatically.',
      actionLabel: 'View Account Pool',
      actionId: 'view-pool',
    };
  }

  if (/HTTP\s*504|DEADLINE_EXCEEDED|Gateway Timeout|timed out/i.test(text)) {
    return {
      code: 504,
      title: 'HTTP 504 — Upstream Gateway Timeout',
      explanation: 'The upstream Google Cloud Code pre-release endpoint hung or exceeded response deadline (>20s).',
      recommendation: 'Auto-failover to production host (cloudcode-pa.googleapis.com) is engaged for 5 minutes and account is placed in progressive 30s cooldown.',
      actionLabel: 'Check Network Host',
      actionId: 'view-network',
    };
  }

  if (/HTTP\s*(?:500|502|503)|UNAVAILABLE|Bad Gateway/i.test(text)) {
    const codeMatch = /HTTP\s*(500|502|503)/i.exec(text);
    const code = codeMatch ? codeMatch[1] : 503;
    return {
      code,
      title: `HTTP ${code} — Upstream Service Error`,
      explanation: 'Google Cloud Code or intermediary gateway returned a temporary server error.',
      recommendation: 'The proxy retried with jitter backoff or rotated to an alternate pool candidate.',
      actionLabel: 'Inspect Logs',
      actionId: 'view-logs',
    };
  }

  if (/UNAUTHENTICATED|invalid_grant|token expired|Could not get access token/i.test(text)) {
    return {
      code: 'AUTH',
      title: 'Authentication / Token Expired',
      explanation: 'The Google OAuth refresh token could not be exchanged for a valid bearer access token.',
      recommendation: 'Re-authenticate the account in Google Accounts view or trigger OAuth login.',
      actionLabel: 'Re-authenticate',
      actionId: 'reauth-account',
    };
  }

  return null;
}

