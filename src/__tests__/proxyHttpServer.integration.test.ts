import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Electron environment
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-proxy-test-home-'));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home' || name === 'userData') return tempHome;
      return path.join(tempHome, name);
    }),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { startProxy, stopProxy, getProxyPort } from '../proxy';
import { saveProviders } from '../customModelStore';

function httpRequest(
  url: string,
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('Proxy HTTP Server Real Integration Test', () => {
  let proxyPort: number;
  let mockUpstream: http.Server;
  let mockUpstreamPort: number;
  let upstreamReceivedRequest: { headers: http.IncomingHttpHeaders; body: string } | null = null;

  beforeAll(async () => {
    // 1. Setup mock upstream server simulating an LLM API endpoint
    mockUpstream = http.createServer((req, res) => {
      let reqBody = '';
      req.on('data', (chunk) => (reqBody += chunk));
      req.on('end', () => {
        upstreamReceivedRequest = { headers: req.headers, body: reqBody };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock-999',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Upstream response through proxy pipeline.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => mockUpstream.listen(0, '127.0.0.1', () => resolve()));
    mockUpstreamPort = (mockUpstream.address() as import('net').AddressInfo).port;

    // 2. Configure a custom model pointing to the mock upstream
    await saveProviders([
      {
        id: 'integration-provider',
        name: 'Mock Upstream LLM',
        provider: 'openai',
        apiUrl: `http://127.0.0.1:${mockUpstreamPort}/v1`,
        apiKey: 'sk-integration-test-key',
        enabled: true,
        models: [
          {
            id: 'mock-gpt',
            displayName: 'Mock GPT Integration',
            enabled: true,
          },
        ],
      },
    ]);

    // 3. Start the proxy on an OS-assigned dynamic port (port 0)
    process.env.AG_PROXY_PORT = '0';
    process.env.AG_PROXY_HOST = '127.0.0.1';
    proxyPort = await startProxy();
  });

  afterAll(async () => {
    await stopProxy();
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch (_) {}
  });

  it('binds to a valid dynamic port and returns it via getProxyPort()', () => {
    expect(proxyPort).toBeGreaterThan(1024);
    expect(getProxyPort()).toBe(proxyPort);
  });

  it('handles CORS OPTIONS preflight request with appropriate headers', async () => {
    const res = await httpRequest(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('rejects invalid JSON payloads on JSON API routes with HTTP 400', async () => {
    const res = await httpRequest(
      `http://127.0.0.1:${proxyPort}/call_mcp_tool`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      '{ bad json here: true ',
    );

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error?.message).toContain('Invalid JSON body');
  });

  it('rejects /GetAvailableModels without ls parameter with HTTP 400', async () => {
    const res = await httpRequest(
      `http://127.0.0.1:${proxyPort}/GetAvailableModels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('Missing ls parameter');
  });

  it('intercepts /chat/completions, relays to upstream provider, and returns response', async () => {
    const requestPayload = {
      model: 'mock-gpt',
      messages: [{ role: 'user', content: 'Ping from real proxy integration test' }],
      temperature: 0.7,
    };

    const res = await httpRequest(
      `http://127.0.0.1:${proxyPort}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-upstream-url': `http://127.0.0.1:${mockUpstreamPort}/v1/chat/completions`,
        },
      },
      JSON.stringify(requestPayload),
    );

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.id).toBe('chatcmpl-mock-999');
    expect(parsed.choices[0].message.content).toBe('Upstream response through proxy pipeline.');

    // Verify upstream received sanitized request
    expect(upstreamReceivedRequest).not.toBeNull();
    const upstreamBody = JSON.parse(upstreamReceivedRequest!.body);
    expect(upstreamBody.messages[0].content).toBe('Ping from real proxy integration test');
  });
});
