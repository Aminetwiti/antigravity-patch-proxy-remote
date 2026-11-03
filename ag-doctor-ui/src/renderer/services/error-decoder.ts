/**
 * Pure helpers extracted from `app.ts` so they can be unit-tested without a
 * browser/DOM. Keep this file dependency-free.
 */

/**
 * Format a byte count as a short, human-readable string (B / KB / MB / GB / TB).
 * Mirrors the implementation previously inlined in `app.ts`.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 2 : value < 100 && i > 0 ? 1 : 0)} ${units[i]}`;
}

type ErrorAction =
  | 'open-mitm-view'
  | 'run-doctor'
  | 'show-retry-toast'
  | 'smart-fallback'
  | 'edit-key'
  | 'start-stub'
  | 'none';

type ErrorCategory =
  | 'quota_429'
  | 'auth_401'
  | 'credits_402'
  | 'offline_econn'
  | 'context_400'
  | 'generic';

interface DecodedError {
  matched: boolean;
  pattern: string;
  hint: string;
  action: ErrorAction;
}

interface DecodedCustomError {
  category: ErrorCategory;
  title: string;
  hint: string;
  resetSeconds?: number;
  action: ErrorAction;
  providerName?: string;
}

interface ErrorPattern {
  pattern: string;
  hint: string;
  action: ErrorAction;
  matcher: (haystack: string) => boolean;
}

/**
 * Anchored MITM matcher: requires proxy/mitm/listen context before the port
 * to avoid false positives on legitimate port-443 traffic elsewhere in logs.
 */
const KNOWN_ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: 'MITM proxy unreachable (127.0.0.1:443)',
    hint: 'The local MITM proxy is not reachable. The proxy is mandatory for the patch to work — open the MITM view to start it (HTTP on port 443 + HTTPS on port 8443).',
    action: 'open-mitm-view',
    matcher: (s) =>
      /(?:proxy|mitm|listen).*127\.0\.0\.1\s*:\s*443|EADDRNOTAVAIL.*127\.0\.0\.1.*443|ECONNREFUSED.*127\.0\.0\.1.*443/i.test(
        s,
      ),
  },
  {
    pattern: 'Baseline model quota reached',
    hint: 'Google Antigravity baseline model quota has been exhausted. Switch to a custom model provider (Claude, OpenAI, Ollama) via local proxy to bypass quota limits without waiting for refresh.',
    action: 'smart-fallback',
    matcher: (s) =>
      /baseline model quota reached|plan's baseline quota|quota will refresh|enable ai credit overages/i.test(s),
  },
  {
    pattern: 'Missing Node module (Cannot find module)',
    hint: 'A dependency expected by the doctor CLI is missing. Run "npm install" in ag-doctor (or use the Repair action if available) and try again.',
    action: 'run-doctor',
    matcher: (s) => /Cannot find module|MODULE_NOT_FOUND|require\.resolve/i.test(s),
  },
  {
    pattern: 'Antigravity crash on launch',
    hint: 'Antigravity did not start cleanly after the patch (or before it). Verify the language_server binary is readable, the backup is intact and try again. If it keeps crashing, restore from backup.',
    action: 'show-retry-toast',
    matcher: (s) =>
      /Antigravity crash|antigravity.*crash(ed)? on launch|crash on startup|process exited unexpectedly/i.test(
        s,
      ),
  },
  {
    pattern: 'Port already in use (EADDRINUSE)',
    hint: 'A local port (e.g. the configured proxy port / 443 / 8443) is already taken by another process. Close the application using that port (often a leftover Antigravity instance) and retry.',
    action: 'run-doctor',
    matcher: (s) => /EADDRINUSE|address already in use|bind:.*already in use|listen.*already in use/i.test(s),
  },
  {
    pattern: 'Model Not Found (404 model_not_found)',
    hint: 'The requested model does not exist on this provider. Select an available model from the dropdown or let Smart Fallback choose one.',
    action: 'smart-fallback',
    matcher: (s) => /model_not_found|the model.*does not exist|404.*not found|model.*not available/i.test(s),
  },
  {
    pattern: 'Network Timeout (ETIMEDOUT)',
    hint: 'The provider did not respond in time. Check your network connection or retry the request.',
    action: 'show-retry-toast',
    matcher: (s) => /ETIMEDOUT|request timed out|timeout exceeded|ESOCKETTIMEDOUT/i.test(s),
  },
  {
    pattern: 'Invalid JSON Response',
    hint: 'The provider returned a malformed response. Verify the API endpoint URL or contact provider support.',
    action: 'run-doctor',
    matcher: (s) => /JSON parse error|unexpected token.*JSON|malformed response|invalid response body/i.test(s),
  },
  {
    pattern: 'Invalid API URL (ENOTFOUND)',
    hint: 'The API URL could not be resolved. Verify the endpoint hostname in Provider Settings.',
    action: 'edit-key',
    matcher: (s) => /ENOTFOUND|getaddrinfo.*fail|dns.*resolve|EAI_AGAIN/i.test(s),
  },
  {
    pattern: 'Stream Connection Broken',
    hint: 'The streaming response was interrupted mid-generation. Retrying is recommended.',
    action: 'smart-fallback',
    matcher: (s) => /stream.*broken|aborted.*stream|premature close|ECONNRESET.*stream/i.test(s),
  },
  {
    pattern: 'Rate Limit (custom provider 429)',
    hint: 'Rate limit hit on this provider. Will auto-fallback to next available model.',
    action: 'smart-fallback',
    matcher: (s) => /rate_limit_error|requests per minute|rate limit exceeded|tpm.*exceeded/i.test(s),
  },
];

/**
 * Decode a CLI stderr/stdout pair into a structured, actionable error.
 * Returns `{ matched: false, ... }` when no known pattern matches.
 */
function decodeError(stderr: string, stdout = ''): DecodedError {
  const haystack = `${stderr || ''}\n${stdout || ''}`;
  for (const def of KNOWN_ERROR_PATTERNS) {
    if (def.matcher(haystack)) {
      return {
        matched: true,
        pattern: def.pattern,
        hint: def.hint,
        action: def.action,
      };
    }
  }
  return { matched: false, pattern: '', hint: '', action: 'none' };
}

/**
 * Parse rate limit reset duration in seconds from error text or HTTP headers.
 */
function parseResetSeconds(text: string): number | undefined {
  const match = text.match(/(?:retry-after|reset|wait|in)\D*(\d+)\s*(?:s|sec|seconds)?/i);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    if (val > 0 && val < 86400) return val;
  }
  return undefined;
}

/**
 * Decode Custom Provider API errors into actionable categories, hints, and actions.
 */
function decodeCustomProviderError(errorMsg: string, status?: number, providerName?: string): DecodedCustomError {
  const haystack = (errorMsg || '').toLowerCase();
  const name = providerName || 'Custom Provider';

  if (status === 429 || /baseline model quota|quota|too many requests|rate limit|429/i.test(haystack)) {
    const secs = parseResetSeconds(errorMsg) ?? 120;
    return {
      category: 'quota_429',
      title: `${name} Quota Reached`,
      hint: `Rate limit or baseline quota reached on ${name}. Rate limits will refresh shortly.`,
      resetSeconds: secs,
      action: 'smart-fallback',
      providerName: name,
    };
  }

  if (status === 401 || /unauthorized|invalid api key|incorrect api key|401/i.test(haystack)) {
    return {
      category: 'auth_401',
      title: `${name} Auth Error`,
      hint: `API key for ${name} was rejected. Verify your API credentials in Provider Settings.`,
      action: 'edit-key',
      providerName: name,
    };
  }

  if (status === 402 || status === 403 || /insufficient quota|credit balance|billing|payment|402|403/i.test(haystack)) {
    return {
      category: 'credits_402',
      title: `${name} Credits Depleted`,
      hint: `Account balance or billing credits depleted for ${name}. Check provider billing dashboard.`,
      action: 'edit-key',
      providerName: name,
    };
  }

  if (/econnrefused|econnreset|failed to fetch|net::err_connection_refused/i.test(haystack)) {
    return {
      category: 'offline_econn',
      title: `${name} Server Offline`,
      hint: `Cannot connect to ${name}. Verify the server process or local proxy is active.`,
      action: 'start-stub',
      providerName: name,
    };
  }

  if (status === 400 || /context length|maximum context|too long|tokens exceed/i.test(haystack)) {
    return {
      category: 'context_400',
      title: `${name} Context Overflow`,
      hint: `Prompt token length exceeds the maximum context window supported by ${name}.`,
      action: 'smart-fallback',
      providerName: name,
    };
  }

  return {
    category: 'generic',
    title: `${name} Connection Error`,
    hint: errorMsg || `Provider ${name} encountered an unexpected HTTP ${status ?? 500} response.`,
    action: 'smart-fallback',
    providerName: name,
  };
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { formatBytes, decodeError, decodeCustomProviderError, parseResetSeconds });
}
