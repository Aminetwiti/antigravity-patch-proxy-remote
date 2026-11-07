import { ipcMain } from 'electron';
import * as http from 'http';
import * as https from 'https';
import log from 'electron-log/main';
import * as cryptoStore from '../cryptoStore';
import * as customModelStore from '../customModelStore';
import { IPC_CHANNELS } from './channels';

interface TestModelParams {
  apiUrl: string;
  provider: string;
  apiKey?: string;
  allowUnauthorized?: boolean;
}

interface ConnectionTestResult {
  success: boolean;
  status?: number;
  message?: string;
  error?: string;
  latencyMs?: number;
}

// ─── Fetch Models Types ────────────────────────────────────────────────────────────

interface FetchModelsParams {
  apiUrl: string;
  provider: string;
  apiKey?: string;
  allowUnauthorized?: boolean;
}

interface FetchModelsResult {
  success: boolean;
  models?: { id: string; name: string; inputModalities?: string[] }[];
  error?: string;
}

export function isStrictLoopbackHost(hostname: string): boolean {
  const lower = (hostname || '').toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1';
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = (hostname || '').toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower.endsWith('.local')) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }
  return false;
}

  interface NormalizedModelEntry {
    id: string;
    name: string;
  }

  function parseModelListResponse(parsed: Record<string, unknown>): NormalizedModelEntry[] {
    if (Array.isArray(parsed.data)) {
      return (parsed.data as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.id || ''),
        name: String(m.id || m.name || ''),
      }));
    }
    if (Array.isArray(parsed.models)) {
      return (parsed.models as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.name || ''),
        name: String(m.displayName || m.name || ''),
      }));
    }
    if (Array.isArray(parsed.model_ids)) {
      return (parsed.model_ids as string[]).map((id) => ({
        id: String(id),
        name: String(id),
      }));
    }
    if (parsed.data && typeof parsed.data === 'object' && Array.isArray((parsed.data as Record<string, unknown>).data)) {
      return ((parsed.data as Record<string, unknown>).data as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.id || ''),
        name: String(m.id || m.name || ''),
      }));
    }
    return [];
  }

export function registerConnectionHandlers(): void {
  // P3-17: Test model connectivity — sends a lightweight HEAD/GET to the model endpoint
  ipcMain.handle(IPC_CHANNELS.STORAGE_TEST_MODEL_CONNECTION, async (_event, model: TestModelParams) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<ConnectionTestResult>((resolve) => {
      try {
        let urlStr = model.apiUrl || '';
        if (!urlStr) {
          resolve({ success: false, error: 'No API URL provided' });
          return;
        }

        const providerLower = (model.provider || '').toLowerCase();
        // Normalize URL for chat API endpoints
        if (providerLower === 'openai' || providerLower === 'custom' || providerLower === 'ollama') {
          urlStr = urlStr.replace(/\/v1\/v1(?=\/|$)/gi, '/v1');
          const urlLower = urlStr.toLowerCase();
          if (!urlLower.includes('/chat/completions') && !urlLower.includes('/completions')) {
            urlStr = urlStr.replace(/\/+$/, '');
            if (urlStr.endsWith('/v1')) {
              urlStr += '/chat/completions';
            } else {
              urlStr += '/v1/chat/completions';
            }
          }
          urlStr = urlStr.replace(/\/v1\/v1(?=\/|$)/gi, '/v1');
        }

        const url = new URL(urlStr);
        const client = url.protocol === 'https:' ? https : http;

        interface RequestOptions {
          method: string;
          hostname: string;
          port: number;
          path: string;
          timeout: number;
          rejectUnauthorized: boolean;
          headers?: Record<string, string>;
        }

        const options: RequestOptions = {
          method: 'HEAD',
          hostname: url.hostname,
          port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
          path: url.pathname + url.search,
          timeout: 10000,
          rejectUnauthorized: model.allowUnauthorized && isPrivateOrLoopbackHost(url.hostname) ? false : true,
        };

        // Add auth header
        if (model.apiKey && model.apiKey !== 'none') {
          let key = model.apiKey;
          try {
            key = cryptoStore.decryptString(model.apiKey);
          } catch {
            /* key might not be encrypted */
          }

          if (model.provider === 'anthropic') {
            options.headers = {
              'x-api-key': key,
              'anthropic-version': '2025-04-01',
            };
          } else if (model.provider === 'google') {
            if (key.startsWith('ya29')) {
              options.headers = {
                Authorization: `Bearer ${key}`,
              };
            } else {
              options.headers = {
                'x-goog-api-key': key,
              };
            }
          } else {
            options.headers = {
              Authorization: `Bearer ${key}`,
            };
          }
        }

        const startTime = Date.now();
        const getLatency = () => Math.round(Date.now() - startTime);

        function doRequest(method: string) {
          options.method = method;
          const req = client.request(options);

          req.on('response', (res: http.IncomingMessage) => {
            // Some APIs reject HEAD requests entirely. If we tried HEAD and got a method error, fallback to GET.
            if (method === 'HEAD' && (res.statusCode === 405 || res.statusCode === 404 || res.statusCode === 403)) {
              res.resume();
              doRequest('GET');
              return;
            }

            // Distinguish auth failures (401/403) from network reachable.
            if (res.statusCode === 401 || res.statusCode === 403) {
              res.resume();
              resolve({ success: false, status: res.statusCode, error: `Authentication failed (HTTP ${res.statusCode})`, latencyMs: getLatency() });
              return;
            }
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 500) {
              res.resume();
              resolve({ success: false, status: res.statusCode, error: `HTTP ${res.statusCode}`, latencyMs: getLatency() });
              return;
            }
            let body = '';
            let bytes = 0;
            const MAX_BODY = 256 * 1024;
            res.on('data', (chunk: Buffer | string) => {
              bytes += chunk.length;
              if (bytes > MAX_BODY) {
                req.destroy();
                resolve({ success: false, error: 'Response too large', latencyMs: getLatency() });
                return;
              }
              body += chunk.toString();
            });
            res.on('end', () => {
              const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400;
              resolve({ success: ok, status: res.statusCode, message: `HTTP ${res.statusCode}`, latencyMs: getLatency() });
            });
          });

          req.setTimeout(10000, () => {
            req.destroy();
            resolve({ success: false, error: 'Request timed out', latencyMs: getLatency() });
          });

          req.on('error', (err: NodeJS.ErrnoException) => {
            let message = err.message;
            if (message.includes('ECONNREFUSED')) {
              message = 'Connection refused — server may not be running';
            } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
              message = 'Host not found — check the API URL';
            } else if (message.includes('CERT') || message.includes('certificate') || message.includes('SSL')) {
              message = 'SSL/TLS error — try enabling "allowUnauthorized" for self-signed certs';
            }
            resolve({ success: false, error: message, latencyMs: getLatency() });
          });

          req.end();
        }

        doRequest('HEAD');
      } catch (err) {
        resolve({ success: false, error: `Invalid URL: ${(err as Error).message}` });
      }
    });
  });


  // ─── Fetch Models from /v1/models endpoint ──────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.STORAGE_FETCH_MODELS, async (_event, params: FetchModelsParams) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');

    return new Promise<FetchModelsResult>((resolve) => {
      try {
        // Build the models list URL from the provider's base URL
        // e.g. https://api.openai.com/v1/chat/completions → /v1/models
        // e.g. https://api.anthropic.com/v1/messages → /v1/models
        // e.g. http://localhost:11434/v1/chat/completions → /v1/models
        let baseUrl = (typeof params?.apiUrl === 'string' && params.apiUrl) ? params.apiUrl : (typeof (params as any)?.baseUrl === 'string' ? (params as any).baseUrl : '');

        if (!baseUrl || typeof baseUrl !== 'string') {
          resolve({ success: false, error: 'No API URL provided' });
          return;
        }

        // Strip the chat/completions or /messages path to get the base
        const urlLower = baseUrl.toLowerCase();
        // Detect Google AI Studio URLs (e.g. .../v1beta/models/...)
        const isGooglePath = /\/v\d+beta\/models/i.test(baseUrl) || /\/v\d+\/models/i.test(baseUrl);

        if (urlLower.includes('/chat/completions') || urlLower.includes('/completions')) {
          baseUrl = baseUrl.replace(/\/chat\/completions|\/completions$/i, '');
        } else if (urlLower.includes('/messages')) {
          baseUrl = baseUrl.replace(/\/messages$/i, '');
        } else if (isGooglePath || urlLower.includes(':generatecontent') || urlLower.includes('/generatecontent') || urlLower.includes(':streamgeneratecontent') || urlLower.includes('/streamgeneratecontent')) {
          // Google: strip everything after /models/{modelName}
          baseUrl = baseUrl.replace(/\/models\/[^/]+.*$/i, '/models');
        }

        // Trim trailing slashes
        baseUrl = baseUrl.replace(/\/+$/, '');

        // For URLs that already end with /models, return as-is
        if (baseUrl.endsWith('/models')) {
          // keep as-is
        } else if (baseUrl.endsWith('/v1')) {
          baseUrl += '/models';
        } else {
          baseUrl += '/v1/models';
        }

        const url = new URL(baseUrl);
        const client = url.protocol === 'https:' ? https : http;

        const options: https.RequestOptions = {
          method: 'GET',
          hostname: url.hostname,
          port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
          path: url.pathname + url.search,
          timeout: 15000,
          rejectUnauthorized: params.allowUnauthorized && isPrivateOrLoopbackHost(url.hostname) ? false : true,
          headers: {
            'Content-Type': 'application/json',
          },
        };

        const providerLower = (params.provider || '').toLowerCase();

        // Add auth header
        const apiKey = (params as { apiKey?: string }).apiKey;
        if (apiKey && apiKey !== 'none' && !customModelStore.isMaskedApiKey(apiKey)) {
          let key = apiKey;
          try {
            key = cryptoStore.decryptString(apiKey);
          } catch {
            /* key might not be encrypted */
          }

          if (providerLower === 'anthropic') {
            (options.headers as Record<string, string>)['x-api-key'] = key;
            (options.headers as Record<string, string>)['anthropic-version'] = '2025-04-01';
          } else if (providerLower === 'google') {
            (options.headers as Record<string, string>)['x-goog-api-key'] = key;
          } else {
            (options.headers as Record<string, string>)['Authorization'] = `Bearer ${key}`;
          }
        }

        const req = client.request(options, (res: http.IncomingMessage) => {
          let body = '';
          let bytes = 0;
          const MAX_BODY = 4 * 1024 * 1024;

          res.on('data', (chunk: string | Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_BODY) {
              req.destroy();
              resolve({ success: false, error: 'Response too large' });
              return;
            }
            body += chunk.toString();
          });

          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
              return;
            }
            try {
              const parsed = JSON.parse(body) as Record<string, unknown>;
              const models = parseModelListResponse(parsed);
              resolve({
                success: true,
                models,
              });
            } catch (parseErr) {
              resolve({
                success: false,
                error: `Failed to parse response: ${(parseErr as Error).message}`,
              });
            }
          });
        });

        req.setTimeout(15000, () => {
          req.destroy();
          resolve({ success: false, error: 'Request timed out after 15 seconds' });
        });

        req.on('error', (err: NodeJS.ErrnoException) => {
          let message = err.message;
          if (message.includes('ECONNREFUSED')) {
            message = 'Connection refused — server may not be running';
          } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
            message = 'Host not found — check the API URL';
          } else if (message.includes('CERT') || message.includes('certificate') || message.includes('SSL')) {
            message = 'SSL/TLS error — try enabling "allowUnauthorized" for self-signed certs';
          }
          resolve({ success: false, error: message });
        });

        req.end();
      } catch (err) {
        resolve({ success: false, error: `Invalid URL: ${(err as Error).message}` });
      }
    });
  });

  /**
   * IPC handler to fetch available models from a provider's API.
   * Supports OpenAI-compatible providers (GET /v1/models).
   */
  ipcMain.handle(IPC_CHANNELS.STORAGE_FETCH_PROVIDER_MODELS, async (_event, params: FetchModelsParams): Promise<FetchModelsResult> => {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(params.apiUrl);

        // Determine the base URL and construct /v1/models endpoint
        let modelsUrl = params.apiUrl;

        // If the URL ends with a specific endpoint like /chat/completions, extract base
        if (modelsUrl.includes('/chat/completions')) {
          modelsUrl = modelsUrl.replace(/\/chat\/completions.*$/, '/models');
        } else if (modelsUrl.includes('/v1/messages')) {
          // Anthropic doesn't have a /models endpoint, return error
          resolve({ success: false, error: 'Anthropic provider does not support model listing via API' });
          return;
        } else if (!modelsUrl.endsWith('/models')) {
          // Assume it's a base URL, append /v1/models
          const cleanModelsUrl = modelsUrl.replace(/\/+$/, '');
          modelsUrl = cleanModelsUrl.endsWith('/v1') ? `${cleanModelsUrl}/models` : `${cleanModelsUrl}/v1/models`;
        }
        modelsUrl = modelsUrl.replace(/\/v1\/v1(?=\/|$)/gi, '/v1');

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (params.apiKey && params.apiKey !== 'none') {
          const decryptedKey = cryptoStore.decryptString(params.apiKey) as string;
          headers['Authorization'] = `Bearer ${decryptedKey}`;
        }

        const reqOptions = {
          method: 'GET',
          headers,
          timeout: 10000,
          rejectUnauthorized: params.allowUnauthorized && isPrivateOrLoopbackHost(parsedUrl.hostname) ? false : true,
        };

        log.info(`[IPC] Fetching models from: ${modelsUrl}`);

        const req = protocol.request(modelsUrl, reqOptions, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(body) as { data?: Array<{ id: string; name?: string; object?: string; input_modalities?: string[] }> };

                if (parsed.data && Array.isArray(parsed.data)) {
                  const models = parsed.data
                    .filter((m) => m.id && m.object === 'model')
                    .map((m) => ({
                      id: m.id,
                      name: (m.name as string) || m.id,
                      inputModalities: m.input_modalities || ['text'], // Default to text-only if not specified
                    }));

                  resolve({ success: true, models });
                } else {
                  resolve({ success: false, error: 'Invalid response format from API' });
                }
              } catch (err) {
                resolve({ success: false, error: `Failed to parse response: ${(err as Error).message}` });
              }
            } else {
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${body}` });
            }
          });
        });

        req.on('error', (err) => {
          let message = err.message;
          if (message.includes('ECONNREFUSED')) {
            message = 'Connection refused — is the server running?';
          } else if (message.includes('ENOTFOUND')) {
            message = 'Host not found — check the URL';
          } else if (message.includes('CERT') || message.includes('certificate') || message.includes('SSL')) {
            message = 'SSL/TLS error — try enabling "allowUnauthorized" for self-signed certs';
          }
          resolve({ success: false, error: message });
        });

        req.end();
      } catch (err) {
        resolve({ success: false, error: `Invalid URL: ${(err as Error).message}` });
      }
    });
  });
}
