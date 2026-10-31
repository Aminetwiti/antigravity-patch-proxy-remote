import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import {
  detectOllama,
  detectLMStudio,
  detectAllLocalRunners,
} from '../services/localModelDetector';

describe('localModelDetector', () => {
  let ollamaServer: http.Server;
  let lmStudioServer: http.Server;
  let ollamaPort: number;
  let lmStudioPort: number;

  beforeAll(async () => {
    // Fake Ollama server
    ollamaServer = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              { name: 'llama3:latest', model: 'llama3:latest', size: 4000000000 },
              { name: 'mistral:latest', model: 'mistral:latest', size: 4100000000 },
            ],
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Fake LM Studio server
    lmStudioServer = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: 'qwen2.5-coder-7b-instruct' },
              { id: 'deepseek-r1-distill-qwen-7b' },
            ],
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      ollamaServer.listen(0, '127.0.0.1', () => {
        const addr = ollamaServer.address() as { port: number };
        ollamaPort = addr.port;
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      lmStudioServer.listen(0, '127.0.0.1', () => {
        const addr = lmStudioServer.address() as { port: number };
        lmStudioPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ollamaServer.close(() => resolve()));
    await new Promise<void>((resolve) => lmStudioServer.close(() => resolve()));
  });

  it('detects running Ollama instance and lists models', async () => {
    const res = await detectOllama(`http://127.0.0.1:${ollamaPort}`);
    expect(res).not.toBeNull();
    expect(res?.type).toBe('ollama');
    expect(res?.models.length).toBe(2);
    expect(res?.models.map((m) => m.id)).toEqual(['llama3:latest', 'mistral:latest']);
  });

  it('detects running LM Studio instance and lists models', async () => {
    const res = await detectLMStudio(`http://127.0.0.1:${lmStudioPort}`);
    expect(res).not.toBeNull();
    expect(res?.type).toBe('lmstudio');
    expect(res?.models.length).toBe(2);
    expect(res?.models.map((m) => m.id)).toEqual([
      'qwen2.5-coder-7b-instruct',
      'deepseek-r1-distill-qwen-7b',
    ]);
  });

  it('returns null gracefully if runner is not running', async () => {
    const res = await detectOllama('http://127.0.0.1:59999');
    expect(res).toBeNull();
  });

  it('detectAllLocalRunners returns an array without throwing', async () => {
    const runners = await detectAllLocalRunners();
    expect(Array.isArray(runners)).toBe(true);
  });
});
