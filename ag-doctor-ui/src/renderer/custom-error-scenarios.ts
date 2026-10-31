/**
 * Custom Provider Failure Scenarios — Catalogue
 *
 * Pure helpers and static scenario catalog for all known failure modes
 * that custom model providers (OpenAI, Anthropic, Ollama, DeepSeek,
 * MiniMax, vLLM) may emit. Used by NativeQuotaCardRenderer to display
 * an exact replica of the native Antigravity quota/error banner UI.
 *
 * Mirror contract with proxy/errorClassifier.ts:
 *   - Each entry maps 1:1 to either an `ErrorType` or a status code
 *     that classifyError() may emit.
 *   - Adding a scenario here WITHOUT extending errorClassifier.ts
 *     will cause the UI to show that scenario only via the showcase,
 *     not in real-time traffic (acceptable for QA / dev preview).
 */

export type FailureCategory =
  | 'auth_401'
  | 'quota_429'
  | 'credits_402'
  | 'context_400'
  | 'offline_econn'
  | 'model_not_found'
  | 'network_timeout'
  | 'invalid_json'
  | 'invalid_url'
  | 'stream_broken'
  | 'rate_limit_minute'
  | 'daily_quota'
  | 'token_quota'
  | 'model_deprecated'
  | 'api_version_deprecated'
  | 'region_unavailable'
  | 'ssl_error'
  | 'content_policy'
  | 'overage_required'
  | 'concurrent_limit'
  | 'generic';

export interface FailureScenario {
  id: string;
  category: FailureCategory;
  httpStatus?: number;
  rawPattern: RegExp;
  decodedTitle: string;
  decodedHint: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  dismissLabel: string;
  exampleProvider: string;
  exampleErrorText: string;
}

/**
 * Static catalog of all 10 known custom-provider failure modes.
 * Keep this list aligned with KNOWN_ERROR_PATTERNS in error-decoder.ts.
 */
export const CUSTOM_PROVIDER_FAILURE_SCENARIOS: FailureScenario[] = [
  {
    id: 'auth_401',
    category: 'auth_401',
    httpStatus: 401,
    rawPattern: /unauthorized|invalid api key|incorrect api key|401/i,
    decodedTitle: 'OpenAI Auth Error',
    decodedHint: 'API key for OpenAI was rejected. Verify your API credentials in Provider Settings.',
    primaryActionLabel: 'Edit API Key',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '401 Unauthorized - Incorrect API key provided: sk-xxx',
  },
  {
    id: 'quota_429',
    category: 'quota_429',
    httpStatus: 429,
    // Generic 429 fallback. Specific variants (rate_limit_minute, daily_quota,
    // token_quota, overage_required, concurrent_limit) win via their own
    // regexes — DO NOT add 'quota' / '429 too many' / 'daily limit' here.
    // 'rate_limit_error' is kept because the legacy test exercises it.
    rawPattern: /rate_limit_error|too many requests|429 too many/i,
    decodedTitle: 'OpenAI Quota Reached',
    decodedHint:
      "Rate limit or baseline quota reached on OpenAI. Rate limits will refresh shortly. Resets in 02:34.",
    primaryActionLabel: 'Switch to Fallback',
    secondaryActionLabel: 'View Usage',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '429 Too Many Requests - Rate limit reached for gpt-4o',
  },
  {
    id: 'credits_402',
    category: 'credits_402',
    httpStatus: 402,
    rawPattern: /insufficient quota|credit balance|billing|payment|402/i,
    decodedTitle: 'Anthropic Credits Depleted',
    decodedHint:
      'Account balance or billing credits depleted for Anthropic. Check provider billing dashboard.',
    primaryActionLabel: 'Open Billing Dashboard',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Anthropic',
    exampleErrorText: '402 Payment Required - Insufficient credits',
  },
  {
    id: 'context_400',
    category: 'context_400',
    httpStatus: 400,
    // Specific to context-length issues. The api_version_deprecated and
    // content_policy scenarios cover other 400-style failures.
    rawPattern: /context length|maximum context|context_length|too long|tokens exceed/i,
    decodedTitle: 'DeepSeek Context Overflow',
    decodedHint:
      'Prompt token length (184,320) exceeds the maximum context window supported by DeepSeek (128,000 tokens).',
    primaryActionLabel: 'Smart Fallback',
    secondaryActionLabel: 'Truncate Input',
    dismissLabel: 'Dismiss',
    exampleProvider: 'DeepSeek',
    exampleErrorText: '400 Bad Request - context_length_exceeded',
  },
  {
    id: 'offline_econn',
    category: 'offline_econn',
    rawPattern: /econnrefused|econnreset|failed to fetch|net::err_connection_refused/i,
    decodedTitle: 'Ollama Server Offline',
    decodedHint:
      'Cannot connect to Ollama at http://localhost:11434. Verify the server process or local proxy is active.',
    primaryActionLabel: 'Restart Stub',
    secondaryActionLabel: 'Edit URL',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Ollama',
    exampleErrorText: 'ECONNREFUSED 127.0.0.1:11434',
  },
  {
    id: 'model_not_found',
    category: 'model_not_found',
    httpStatus: 404,
    rawPattern: /model_not_found|the model.*does not exist|404.*not found/i,
    decodedTitle: 'Model Unavailable',
    decodedHint:
      'The model "gpt-5-turbo" was not found on OpenAI. Available models: gpt-4o, gpt-4o-mini, gpt-3.5-turbo.',
    primaryActionLabel: 'Use gpt-4o',
    secondaryActionLabel: 'Browse Models',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '404 model_not_found - gpt-5-turbo',
  },
  {
    id: 'network_timeout',
    category: 'network_timeout',
    rawPattern: /ETIMEDOUT|request timed out|timeout exceeded|ESOCKETTIMEDOUT/i,
    decodedTitle: 'Network Timeout',
    decodedHint: 'Request to Anthropic timed out after 30s. Check your connection or try again.',
    primaryActionLabel: 'Retry',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Anthropic',
    exampleErrorText: 'ETIMEDOUT - Request timeout after 30000ms',
  },
  {
    id: 'invalid_json',
    category: 'invalid_json',
    rawPattern: /JSON parse error|unexpected token.*JSON|malformed response/i,
    decodedTitle: 'Invalid Response Format',
    decodedHint:
      'Provider "MyCustomLLM" returned malformed JSON. Expected OpenAI-compatible schema.',
    primaryActionLabel: 'Report to Developer',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'MyCustomLLM',
    exampleErrorText: 'SyntaxError: Unexpected token < in JSON at position 0',
  },
  {
    id: 'invalid_url',
    category: 'invalid_url',
    rawPattern: /ENOTFOUND|getaddrinfo.*fail|dns.*resolve|EAI_AGAIN/i,
    decodedTitle: 'Invalid API URL',
    decodedHint: 'The API URL could not be resolved. Verify the endpoint hostname in Provider Settings.',
    primaryActionLabel: 'Edit Provider',
    secondaryActionLabel: 'Use Default URL',
    dismissLabel: 'Dismiss',
    exampleProvider: 'MiniMax',
    exampleErrorText: 'ENOTFOUND api.minimaxi.chat',
  },
  {
    id: 'stream_broken',
    category: 'stream_broken',
    rawPattern: /stream.*broken|aborted.*stream|premature close|ECONNRESET.*stream/i,
    decodedTitle: 'Stream Connection Broken',
    decodedHint: 'The streaming response from DeepSeek was interrupted mid-generation. Retrying is recommended.',
    primaryActionLabel: 'Retry',
    secondaryActionLabel: 'Disable Streaming',
    dismissLabel: 'Dismiss',
    exampleProvider: 'DeepSeek',
    exampleErrorText: 'Error: aborted stream at chunk 42',
  },
  {
    id: 'rate_limit_minute',
    category: 'rate_limit_minute',
    httpStatus: 429,
    rawPattern: /requests per minute|rpm exceeded|tpm exceeded|429.*rpm/i,
    decodedTitle: 'Per-Minute Rate Limit',
    decodedHint:
      'OpenAI rejected the request: more than 60 requests/minute on gpt-4o. Wait 17s before retrying.',
    primaryActionLabel: 'Retry in 17s',
    secondaryActionLabel: 'Switch to gpt-4o-mini',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '429 RPM exceeded (60/min) for gpt-4o',
  },
  {
    id: 'daily_quota',
    category: 'daily_quota',
    httpStatus: 429,
    rawPattern: /daily limit|day quota|24.?hour limit|daily request limit/i,
    decodedTitle: 'Daily Quota Reached',
    decodedHint:
      'Your daily request limit on MiniMax was reached. Quota resets in 14h 27m. Try a fallback provider.',
    primaryActionLabel: 'Switch to Fallback',
    secondaryActionLabel: 'View Usage',
    dismissLabel: 'Dismiss',
    exampleProvider: 'MiniMax',
    exampleErrorText: '429 Daily request limit exceeded. Resets at 00:00 UTC.',
  },
  {
    id: 'token_quota',
    category: 'token_quota',
    httpStatus: 429,
    rawPattern: /tokens per day|tpd|monthly token|token quota/i,
    decodedTitle: 'Monthly Token Quota Reached',
    decodedHint:
      'Your Anthropic monthly token budget (5,000,000 tokens) is exhausted. Top-up or upgrade your plan.',
    primaryActionLabel: 'Top Up Credits',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Anthropic',
    exampleErrorText: '429 Token quota exceeded (5,000,000 / 5,000,000)',
  },
  {
    id: 'model_deprecated',
    category: 'model_deprecated',
    httpStatus: 410,
    // Specific to models being retired. The api_version_deprecated scenario
    // covers 'deprecated endpoint' / 'api version' patterns — do NOT add
    // those here. 'sunset' and 'model removed' are still safe.
    rawPattern: /sunset|model removed|has been retired|has been removed/i,
    decodedTitle: 'Model Deprecated',
    decodedHint:
      'OpenAI retired gpt-3.5-turbo-0613 on 2026-02-15. Use gpt-3.5-turbo (latest) instead.',
    primaryActionLabel: 'Migrate to gpt-3.5-turbo',
    secondaryActionLabel: 'Browse Models',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '410 Gone - model gpt-3.5-turbo-0613 has been retired',
  },
  {
    id: 'api_version_deprecated',
    category: 'api_version_deprecated',
    httpStatus: 400,
    rawPattern: /api version|deprecated endpoint|legacy api|use v\d|api v\d/i,
    decodedTitle: 'API Version Deprecated',
    decodedHint:
      'Provider API version 2024-01 is deprecated. Switch to 2024-10 (preview) or 2024-07 (stable).',
    primaryActionLabel: 'Switch API Version',
    secondaryActionLabel: 'View Changelog',
    dismissLabel: 'Dismiss',
    exampleProvider: 'MyCustomLLM',
    exampleErrorText: '400 api version 2024-01 is deprecated, use 2024-07 or later',
  },
  {
    id: 'region_unavailable',
    category: 'region_unavailable',
    httpStatus: 403,
    rawPattern: /region not supported|geo.?restriction|country.*not allowed|unsupported region/i,
    decodedTitle: 'Region Unavailable',
    decodedHint:
      'OpenAI services are not available in your region (FR). Use a proxy or pick a different provider.',
    primaryActionLabel: 'Switch Provider',
    secondaryActionLabel: 'Open Status Page',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '403 region not supported: FR — see https://status.openai.com',
  },
  {
    id: 'ssl_error',
    category: 'ssl_error',
    rawPattern: /cert.*expired|cert.*invalid|unable to verify|certificate verify failed|ssl error|certificate has expired/i,
    decodedTitle: 'SSL Certificate Error',
    decodedHint:
      'Could not verify SSL certificate for https://api.example.com. The certificate may be expired or self-signed.',
    primaryActionLabel: 'Edit URL',
    secondaryActionLabel: 'Allow Insecure (risky)',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Self-Hosted vLLM',
    exampleErrorText: 'TLS Error: unable to verify the first certificate (expired)',
  },
  {
    id: 'content_policy',
    category: 'content_policy',
    httpStatus: 400,
    // Match content policy/safety violations AND the OpenAI 'policy_violation'
    // status. Do NOT add '400' or 'context' here (context_400 owns those).
    rawPattern: /content[ _]policy|safety violation|content[ _]filter|content[ _]moderation|policy[ _]violation|unsafe content/i,
    decodedTitle: 'Content Policy Violation',
    decodedHint:
      'Anthropic rejected the request: response would violate the content policy. Rephrase and retry.',
    primaryActionLabel: 'Rephrase Prompt',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Anthropic',
    exampleErrorText: '400 content_policy_violation: prompt triggered safety filter',
  },
  {
    id: 'overage_required',
    category: 'overage_required',
    httpStatus: 429,
    rawPattern: /enable.*overage|credit overages|overage.*required|use overage/i,
    decodedTitle: 'Baseline Quota Reached',
    decodedHint:
      "Your plants baseline quota will refresh on 27/07/2026 23:15:31. To continue using this model now, enable AI Credit overages.",
    primaryActionLabel: 'Enable Overages',
    secondaryActionLabel: 'Switch Provider',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Google',
    exampleErrorText: 'Baseline model quota reached. Refresh on 27/07/2026 23:15:31. Enable AI Credit overages.',
  },
  {
    id: 'concurrent_limit',
    category: 'concurrent_limit',
    httpStatus: 429,
    rawPattern: /concurrent.*limit|too many concurrent|simultaneous.*requests|max.*parallel/i,
    decodedTitle: 'Concurrent Request Limit',
    decodedHint:
      'OpenAI allows at most 5 concurrent generations on gpt-4o. Wait for in-flight requests to finish.',
    primaryActionLabel: 'Wait & Retry',
    secondaryActionLabel: 'Cancel Other Requests',
    dismissLabel: 'Dismiss',
    exampleProvider: 'OpenAI',
    exampleErrorText: '429 concurrent limit reached (5/5) for gpt-4o',
  },
  {
    id: 'generic',
    category: 'generic',
    rawPattern: /.*/i,
    decodedTitle: 'Provider Connection Error',
    decodedHint: 'An unexpected error occurred with the custom provider. Check logs and retry.',
    primaryActionLabel: 'Retry',
    secondaryActionLabel: 'Run Doctor',
    dismissLabel: 'Dismiss',
    exampleProvider: 'Unknown',
    exampleErrorText: 'Unhandled error: HTTP 500',
  },
];

/**
 * Find a matching scenario for an error message + optional HTTP status.
 * First tries to match by HTTP status, then falls back to regex.
 */
export function findScenarioForError(
  rawError: string,
  status?: number,
): FailureScenario | null {
  if (!rawError && status === undefined) return null;

  const haystack = rawError || '';

  // First pass: regex patterns — more specific than a bare HTTP status.
  // The 'generic' scenario uses /.*/i and would otherwise swallow every call,
  // so we deliberately skip it in this pass and only consult it as a last
  // resort after the HTTP-status pass.
  for (const scenario of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
    if (scenario.id === 'generic') continue;
    if (scenario.rawPattern.test(haystack)) {
      return scenario;
    }
  }

  // Second pass: match by HTTP status only if no regex matched.
  if (typeof status === 'number') {
    const byStatus = CUSTOM_PROVIDER_FAILURE_SCENARIOS.find((s) => s.httpStatus === status);
    if (byStatus) return byStatus;
  }

  // Last resort: the generic scenario accepts anything.
  const generic = CUSTOM_PROVIDER_FAILURE_SCENARIOS.find((s) => s.id === 'generic');
  if (generic && generic.rawPattern.test(haystack)) {
    return generic;
  }

  return null;
}

/**
 * Return the full catalog (useful for UI dropdowns & test suites).
 */
export function getAllScenarios(): FailureScenario[] {
  return [...CUSTOM_PROVIDER_FAILURE_SCENARIOS];
}

/**
 * Group scenarios by category for compact UI display.
 */
export function groupScenariosByCategory(): Record<FailureCategory, FailureScenario[]> {
  const grouped: Record<string, FailureScenario[]> = {};
  for (const scenario of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
    if (!grouped[scenario.category]) grouped[scenario.category] = [];
    grouped[scenario.category].push(scenario);
  }
  return grouped as Record<FailureCategory, FailureScenario[]>;
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, {
    CUSTOM_PROVIDER_FAILURE_SCENARIOS,
    findScenarioForError,
    getAllScenarios,
    groupScenariosByCategory,
  });
}
