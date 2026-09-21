/**
 * Error classification and diagnostics for upstream LLM provider APIs.
 * Pure functions — no I/O, no side effects, fully testable.
 */

export type ErrorType =
  | 'billing'
  | 'auth'
  | 'forbidden'
  | 'rate_limit'
  | 'dns'
  | 'timeout'
  | 'network'
  | 'server'
  | 'empty_stream'
  | 'unknown';

export interface ErrorDiagnostic {
  errorType: ErrorType;
  title: string;
  message: string;
  suggestions: string[];
  retryable: boolean;
  severity: 'error' | 'warning' | 'info';
  actionUrl?: string;
}

/**
 * Classifies an error from upstream or client requests to provide clear, actionable diagnostics.
 *
 * @param status HTTP status code from response (if available)
 * @param errorObj Network/system error object or code (if available)
 * @param responseBody Raw string response body from upstream (if available)
 * @param provider Name of the LLM provider (if available)
 * @returns An ErrorDiagnostic object
 */
export function classifyError(
  status?: number,
  errorObj?: any,
  responseBody?: string,
  provider?: string,
): ErrorDiagnostic {
  // 1. Check response body or explicit indicator for billing / tokens errors first
  let bodyJson: any = null;
  if (responseBody) {
    try {
      bodyJson = JSON.parse(responseBody);
    } catch {
      // ignore parse errors
    }
  }

  const bodyText = responseBody ? responseBody.toLowerCase() : '';
  const errorMsg = errorObj?.message ? errorObj.message.toLowerCase() : '';
  const errorCode = typeof errorObj === 'string' ? errorObj.toUpperCase() : (errorObj?.code ? String(errorObj.code).toUpperCase() : '');

  // Detect billing / insufficient tokens / credits errors
  const isBilling =
    status === 402 ||
    bodyText.includes('billing_error') ||
    bodyText.includes('insufficient tokens') ||
    bodyText.includes('insufficient credits') ||
    bodyText.includes('insufficient_quota') ||
    bodyText.includes('quota exceeded') ||
    bodyText.includes('credit limit') ||
    (bodyJson?.error?.type === 'billing_error') ||
    (bodyJson?.error?.code === 'insufficient_quota');

  if (isBilling) {
    let actionUrl: string | undefined = undefined;
    const p = provider?.toLowerCase();
    if (p === 'openai') actionUrl = 'https://platform.openai.com/billing';
    else if (p === 'anthropic') actionUrl = 'https://console.anthropic.com/settings/billing';
    else if (p === 'openrouter') actionUrl = 'https://openrouter.ai/credits';
    else if (p === 'mistral') actionUrl = 'https://console.mistral.ai/billing/';
    else if (p === 'groq') actionUrl = 'https://console.groq.com/billing';
    else if (p === 'deepseek') actionUrl = 'https://platform.deepseek.com/top_up';

    return {
      errorType: 'billing',
      title: 'Insufficient Credits',
      message: 'The model provider returned a billing or quota error (402/insufficient tokens).',
      suggestions: [
        'Check your provider billing dashboard to ensure you have active credits.',
        'Verify if a usage limit set on your API key has been exceeded.',
        'Consider switching to a different model or provider.'
      ],
      retryable: false,
      severity: 'error',
      actionUrl,
    };
  }

  // Detect authentication / API key errors (401)
  const isAuth =
    status === 401 ||
    bodyText.includes('invalid_api_key') ||
    bodyText.includes('authentication failed') ||
    (status !== 403 && bodyText.includes('unauthorized')) ||
    bodyText.includes('incorrect api key') ||
    bodyText.includes('invalid api key') ||
    (status !== 403 && errorMsg.includes('unauthorized')) ||
    (bodyJson?.error?.code === 'invalid_api_key');

  if (isAuth) {
    return {
      errorType: 'auth',
      title: 'Authentication Failed',
      message: 'The API key or credentials provided are invalid (401 Unauthorized).',
      suggestions: [
        'Open Custom Models Settings and verify your API key for this model.',
        'Ensure the key has not expired, been deleted, or restricted.',
        'Make sure you did not copy extra spaces or prefix/suffix characters.'
      ],
      retryable: false,
      severity: 'error',
    };
  }

  // Detect forbidden / access denied errors (403)
  const isForbidden =
    status === 403 ||
    bodyText.includes('permission_denied') ||
    bodyText.includes('forbidden') ||
    bodyText.includes('not allowed') ||
    bodyText.includes('access_denied') ||
    errorMsg.includes('forbidden');

  if (isForbidden) {
    return {
      errorType: 'forbidden',
      title: 'Access Denied',
      message: 'Access to the model or resource was denied by the provider (403 Forbidden).',
      suggestions: [
        'Check if your API key has permissions/access to this specific model.',
        'Verify if this model is in a restricted region or tier.',
        'Ensure your IP address is not blocked by the provider\'s firewall.'
      ],
      retryable: false,
      severity: 'error',
    };
  }

  // Detect rate limit / too many requests (429)
  const isRateLimit =
    status === 429 ||
    bodyText.includes('rate_limit_exceeded') ||
    bodyText.includes('too_many_requests') ||
    bodyText.includes('requests per minute') ||
    bodyText.includes('tokens per minute') ||
    bodyText.includes('rate limit');

  if (isRateLimit) {
    return {
      errorType: 'rate_limit',
      title: 'Rate Limited',
      message: 'The provider rate limit has been exceeded (429 Too Many Requests).',
      suggestions: [
        'Wait a moment before retrying the operation.',
        'Reduce request frequency or context size if sending large payloads.',
        'Upgrade your provider tier to increase rate limits.'
      ],
      retryable: true,
      severity: 'warning',
    };
  }

  // Detect DNS issues
  const isDns =
    errorCode === 'ENOTFOUND' ||
    errorCode === 'EAI_AGAIN' ||
    errorMsg.includes('dns resolution failed') ||
    errorMsg.includes('getaddrinfo') ||
    errorMsg.includes('enotfound');

  if (isDns) {
    return {
      errorType: 'dns',
      title: 'DNS Resolution Failed',
      message: 'Could not resolve the host address of the API endpoint.',
      suggestions: [
        'Check your internet connection and active DNS servers.',
        'Verify the API URL is typed correctly in Custom Models.',
        'If behind a corporate VPN or proxy, verify it is properly configured.'
      ],
      retryable: false,
      severity: 'error',
    };
  }

  // Detect timeouts
  const isTimeout =
    status === 504 ||
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ESOCKETTIMEDOUT' ||
    errorMsg.includes('timeout') ||
    errorMsg.includes('timed out');

  if (isTimeout) {
    return {
      errorType: 'timeout',
      title: 'Request Timeout',
      message: 'The request to the model provider timed out.',
      suggestions: [
        'The provider server might be overloaded or slow. Try again in a moment.',
        'Increase the request timeout setting in the custom model configuration.',
        'Reduce the size of the conversation or prompt being sent.'
      ],
      retryable: true,
      severity: 'warning',
    };
  }

  // Detect network connection issues
  const isNetwork =
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ECONNRESET' ||
    errorCode === 'EHOSTUNREACH' ||
    errorCode === 'ENETUNREACH' ||
    errorMsg.includes('connrefused') ||
    errorMsg.includes('connect econn') ||
    errorMsg.includes('connection refused') ||
    errorMsg.includes('connection reset') ||
    errorMsg.includes('network');

  if (isNetwork) {
    return {
      errorType: 'network',
      title: 'Network Connection Failed',
      message: 'Could not establish a connection to the API server.',
      suggestions: [
        'Verify if the provider\'s API server is running (especially for local providers like Ollama/LM Studio).',
        'Check that the port and host address are correct.',
        'Ensure firewall or antivirus software is not blocking the connection.'
      ],
      retryable: true,
      severity: 'error',
    };
  }

  // Detect server errors (5xx)
  if (status && status >= 500 && status < 600) {
    const upstreamDetail = bodyJson?.error?.message || (typeof bodyJson?.error === 'string' ? bodyJson.error : '') || bodyJson?.message || '';
    return {
      errorType: 'server',
      title: 'Provider Server Error',
      message: upstreamDetail
        ? `The upstream server returned an error: ${upstreamDetail}`
        : `The upstream server encountered an error (HTTP ${status}).`,
      suggestions: [
        'Try again later or check the model provider\'s service status page.',
        'If using a custom or local server, check its log output for details.',
        'Contact the model provider\'s support if this error persists.'
      ],
      retryable: true,
      severity: 'error',
    };
  }

  // Fallback to unknown error
  const upstreamDetail = bodyJson?.error?.message || (typeof bodyJson?.error === 'string' ? bodyJson.error : '') || bodyJson?.message || '';
  const title = status === 404 ? 'Model Not Found (404)' : status === 400 ? 'Invalid Request (400)' : status ? `API Error (HTTP ${status})` : 'Unexpected Error';
  return {
    errorType: 'unknown',
    title,
    message: upstreamDetail
      ? `The provider returned an error: ${upstreamDetail}`
      : status
      ? `Request failed with status code HTTP ${status}.`
      : `An unexpected request error occurred: ${errorMsg || errorCode || 'Unknown error'}`,
    suggestions: [
      status === 404 ? 'Check if the external model name matches the provider\'s exact model identifier.' : 'Check the application logs for a full stack trace or debugging information.',
      'Check your Custom Models configuration settings.',
      'Retry the request or try a different model.'
    ],
    retryable: false,
    severity: 'error',
  };
}

/**
 * Generates an enriched, user-friendly Markdown diagnostic card for display in the UI/Chat.
 */
export function generateDiagnosticCardMarkdown(diagnostic: ErrorDiagnostic): string {
  const alertType = diagnostic.severity === 'warning' ? 'WARNING' : 'CAUTION';
  let md = `> [!${alertType}]\n`;
  md += `> **${diagnostic.title}**\n>\n`;
  md += `> ${diagnostic.message}\n`;

  if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
    md += `>\n> **Suggested Actions:**\n`;
    diagnostic.suggestions.forEach((s) => {
      md += `> - ${s}\n`;
    });
  }

  if (diagnostic.actionUrl) {
    md += `>\n> 🔗 [Manage Billing & Credits](${diagnostic.actionUrl})\n`;
  }

  md += `\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
  return md;
}

