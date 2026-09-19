/**
 * `ag-doctor models fetch` — query a provider's /v1/models endpoint
 * and print the list of available models.
 *
 * Usage:
 *   ag-doctor models fetch --provider <p> --url <u> [--key <k>] [--allow-unauthorized] [--json]
 *
 * The provider's API URL is normalized to its /v1/models endpoint before
 * the HTTP GET. Supports OpenAI (`{ data: [...] }`), Google (`{ models: [...] }`),
 * and Anthropic (`{ data: [...] }`) response shapes.
 */
import * as http from 'http';
import * as https from 'https';
import type { CommandContext } from '../../types';
import { c, header, ok, error, info } from '../../cli/output';
import { Spinner } from '../../cli/spinner';

interface FetchModelsResult {
  success: boolean;
  models?: { id: string; name: string }[];
  error?: string;
  url?: string;
}

/**
 * Build the /v1/models URL from a chat-completion URL.
 *  https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/models
 *  https://api.anthropic.com/v1/messages       → https://api.anthropic.com/v1/models
 *  http://localhost:11434/v1/chat/completions  → http://localhost:11434/v1/models
 *  https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
 *                                              → https://generativelanguage.googleapis.com/v1beta/models
 *  https://api.openai.com/v1                   → https://api.openai.com/v1/models
 *  https://api.openai.com/v1/                  → https://api.openai.com/v1/models
 *  https://api.openai.com                      → https://api.openai.com/v1/models
 *
 * Note: query strings (`?key=…`, `?token=…`) are deliberately stripped. Some
 * users put their API key in the URL — sending that key to `/v1/models` (a
 * different endpoint) at best doubles the surface area for accidental
 * leakage into logs/proxies, and at worst fails with 401/403 because the
 * upstream checks the `key` query parameter only on the chat-completions
 * path. Auth headers are still injected by the probe/caller if available.
 */
export function buildModelsUrl(apiUrl: string): string {
  if (!apiUrl || typeof apiUrl !== 'string') return '';
  // Drop any query string first — never carry it into /v1/models.
  let baseUrl = apiUrl.split('?')[0];
  const urlLower = baseUrl.toLowerCase();

  // Detect Google AI Studio URLs (e.g. .../v1beta/models/...)
  // Google uses its own path structure: /v1beta/models (not /v1/models)
  const isGooglePath = /\/v\d+beta\/models/i.test(baseUrl) || /\/v\d+\/models/i.test(baseUrl);

  if (urlLower.includes('/chat/completions') || urlLower.includes('/completions')) {
    baseUrl = baseUrl.replace(/\/chat\/completions|\/completions$/i, '');
  } else if (urlLower.includes('/messages')) {
    baseUrl = baseUrl.replace(/\/messages$/i, '');
  } else if (isGooglePath || urlLower.includes(':generatecontent') || urlLower.includes('/generatecontent') || urlLower.includes(':streamgeneratecontent') || urlLower.includes('/streamgeneratecontent')) {
    // Google: strip everything after /models/{modelName}
    // e.g. .../v1beta/models/gemini-pro:generateContent → .../v1beta/models
    //      .../v1beta/models/gemini-pro/generateContent  → .../v1beta/models
    //      .../v1beta/models/gemini-pro:streamGenerateContent → .../v1beta/models
    baseUrl = baseUrl.replace(/\/models\/[^/]+.*$/i, '/models');
  }

  // Trim trailing slashes
  baseUrl = baseUrl.replace(/\/+$/, '');

  // For Google-style URLs that already end with /models, return as-is
  if (isGooglePath && baseUrl.endsWith('/models')) {
    return baseUrl;
  }

  // Append /models, handling the /v1 and /v1beta prefixes correctly
  if (baseUrl.endsWith('/v1') || /\/v\d+beta$/i.test(baseUrl)) {
    return `${baseUrl}/models`;
  }
  return `${baseUrl}/v1/models`;
}

function performFetch(
  apiUrl: string,
  provider: string,
  apiKey: string | undefined,
  allowUnauthorized: boolean,
  timeoutMs = 15000,
): Promise<FetchModelsResult> {
  return new Promise<FetchModelsResult>((resolve) => {
    try {
      const target = buildModelsUrl(apiUrl);
      const url = new URL(target);
      const client = url.protocol === 'https:' ? https : http;

      const options: https.RequestOptions = {
        method: 'GET',
        hostname: url.hostname,
        port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
        path: url.pathname + url.search,
        timeout: timeoutMs,
        rejectUnauthorized: !allowUnauthorized,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (apiKey && apiKey !== 'none') {
        if (provider === 'anthropic') {
          (options.headers as Record<string, string>)['x-api-key'] = apiKey;
          (options.headers as Record<string, string>)['anthropic-version'] = '2025-04-01';
        } else if (provider === 'google') {
          (options.headers as Record<string, string>)['x-goog-api-key'] = apiKey;
        } else {
          (options.headers as Record<string, string>)['Authorization'] = `Bearer ${apiKey}`;
        }
      }

      const req = client.request(options, (res: http.IncomingMessage) => {
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            resolve({
              success: false,
              url: target,
              error: `HTTP ${res.statusCode} from ${target}`,
            });
            return;
          }
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            let models: { id: string; name: string }[] = [];

            if (Array.isArray(parsed.data)) {
              // OpenAI / OpenAI-compatible / Anthropic
              models = (parsed.data as Array<Record<string, unknown>>).map((m) => ({
                id: (m.id as string) || '',
                name: (m.id as string) || (m.name as string) || '',
              }));
            } else if (Array.isArray(parsed.models)) {
              // Google
              models = (parsed.models as Array<Record<string, unknown>>).map((m) => ({
                id: (m.name as string) || '',
                name: (m.displayName as string) || (m.name as string) || '',
              }));
            } else if (Array.isArray(parsed.model_ids)) {
              models = (parsed.model_ids as string[]).map((id) => ({ id, name: id }));
            }

            // Nested data fallback
            if (models.length === 0 && parsed.data && typeof parsed.data === 'object') {
              const nestedData = (parsed.data as Record<string, unknown>).data;
              if (Array.isArray(nestedData)) {
                models = (nestedData as Array<Record<string, unknown>>).map((m) => ({
                  id: (m.id as string) || '',
                  name: (m.id as string) || (m.name as string) || '',
                }));
              }
            }

            resolve({ success: true, models, url: target });
          } catch (parseErr) {
            resolve({
              success: false,
              url: target,
              error: `Failed to parse response: ${(parseErr as Error).message}`,
            });
          }
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ success: false, url: target, error: `Request timed out after ${timeoutMs}ms` });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        let message = err.message;
        if (message.includes('ECONNREFUSED')) {
          message = 'Connection refused — server may not be running';
        } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
          message = 'Host not found — check the API URL';
        } else if (message.includes('CERT') || message.includes('certificate') || message.includes('SSL')) {
          message = 'SSL/TLS error — try --allow-unauthorized for self-signed certs';
        }
        resolve({ success: false, url: target, error: message });
      });

      req.end();
    } catch (err) {
      resolve({ success: false, error: `Invalid URL: ${(err as Error).message}` });
    }
  });
}

export async function runModelsFetch(ctx: CommandContext): Promise<number> {
  const options = ctx.options || {};

  const provider = (options.provider as string) || '';
  const apiUrl = (options.url as string) || (options['api-url'] as string) || '';
  const apiKey = (options.key as string) || (options['api-key'] as string) || undefined;
  const allowUnauthorized =
    Boolean(options['allow-unauthorized']) || Boolean(options.allowUnauthorized);

  if (!provider) {
    error('Missing --provider');
    return 2;
  }
  if (!apiUrl) {
    error('Missing --url');
    return 2;
  }

  if (!ctx.json) header('Fetch models');
  if (!ctx.json) info(`Provider: ${provider}`);
  if (!ctx.json) info(`URL:      ${apiUrl}`);

  const sp = ctx.json ? null : new Spinner('Querying /v1/models …');
  sp?.start();

  const result = await performFetch(apiUrl, provider, apiKey, allowUnauthorized);

  sp?.stop();

  if (!result.success) {
    if (!ctx.json) {
      error(result.error || 'Unknown error');
      if (result.url) info(`Tried: ${result.url}`);
    }
    if (ctx.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return 2;
  }

  const models = result.models || [];
  if (ctx.json) {
    console.log(JSON.stringify({ ...result, models }, null, 2));
    return 0;
  }

  ok(`Found ${models.length} model(s)`);
  if (result.url) info(`Source: ${c.gray(result.url)}`);
  console.log('');
  if (models.length === 0) {
    info('No models returned by the endpoint.');
    return 0;
  }

  for (const m of models) {
    if (m.id === m.name) {
      console.log(`  ${c.bold('•')} ${m.id}`);
    } else {
      console.log(`  ${c.bold('•')} ${m.id}  ${c.gray(`(${m.name})`)}`);
    }
  }
  console.log('');
  return 0;
}
