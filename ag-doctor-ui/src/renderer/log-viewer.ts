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
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const GLOG_RE = /^(?:ERROR:\s+logging\s+before\s+google\.Init:\s+)?([IWEF])\d{4}\s+(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\d*\s+\d+\s+([^:\]\s]+:\d+)\]\s*(.*)$/;
const ELECTRON_LOG_RE = /^\[(\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2}(?:\.\d{3})?))\]\s+\[(info|warn|error|debug|verbose)\]\s*(.*)$/i;

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
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  const match = GLOG_RE.exec(clean);

  if (match) {
    const code = match[1];
    let level: LogLevel = 'info';
    if (code === 'W') level = 'warn';
    else if (code === 'E' || code === 'F') level = 'error';

    if (/panic:|runtime error|signal 0x/i.test(match[4])) {
      level = 'panic';
    }

    return {
      raw: clean,
      level,
      time: match[2],
      location: match[3],
      message: match[4],
      isNoise: isLogNoise(clean),
    };
  }

  const electronMatch = ELECTRON_LOG_RE.exec(clean);
  if (electronMatch) {
    const lvlStr = electronMatch[3].toLowerCase();
    let level: LogLevel = 'info';
    if (lvlStr === 'warn') level = 'warn';
    else if (lvlStr === 'error') level = 'error';

    return {
      raw: clean,
      level,
      time: electronMatch[2],
      message: electronMatch[4],
      isNoise: isLogNoise(clean),
    };
  }

  const level = classifyLogLevel(clean);
  return {
    raw: clean,
    level,
    message: clean,
    isNoise: isLogNoise(clean),
  };
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

