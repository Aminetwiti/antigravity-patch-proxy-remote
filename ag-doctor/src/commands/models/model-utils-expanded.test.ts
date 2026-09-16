import { describe, expect, it } from 'vitest';

/**
 * Model ID normalization, provider detection, base URL validation, and capability flags test suite.
 */

interface ModelInfo {
  id: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'custom';
  normalizedId: string;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
}

function normalizeModelId(rawId: string): string {
  let cleaned = rawId.trim().toLowerCase();
  if (cleaned.startsWith('openai/')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('anthropic/')) cleaned = cleaned.slice(10);
  if (cleaned.startsWith('google/')) cleaned = cleaned.slice(7);
  return cleaned;
}

function detectProvider(modelId: string): 'openai' | 'anthropic' | 'gemini' | 'custom' {
  const norm = normalizeModelId(modelId);
  if (norm.startsWith('gpt-') || norm.startsWith('o1-') || norm.startsWith('o3-')) return 'openai';
  if (norm.startsWith('claude-')) return 'anthropic';
  if (norm.startsWith('gemini-')) return 'gemini';
  return 'custom';
}

function inferCapabilities(modelId: string): ModelInfo {
  const norm = normalizeModelId(modelId);
  const provider = detectProvider(modelId);

  let contextWindow = 8192;
  if (norm.includes('128k') || norm.startsWith('gpt-4o') || norm.startsWith('o1-')) contextWindow = 128000;
  if (norm.includes('1m') || norm.startsWith('gemini-3.1-pro-high') || norm.startsWith('gemini-3.8-flash-tiered')) contextWindow = 1000000;
  if (norm.startsWith('claude-3')) contextWindow = 200000;

  const supportsVision = norm.includes('vision') || norm.includes('4o') || norm.startsWith('claude-3') || norm.startsWith('gemini-');
  const supportsFunctionCalling = !norm.startsWith('o1-mini');

  return {
    id: modelId,
    provider,
    normalizedId: norm,
    contextWindow,
    supportsStreaming: true,
    supportsVision,
    supportsFunctionCalling,
  };
}

function validateBaseUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || typeof url !== 'string') return { valid: false, reason: 'URL must be a non-empty string' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'URL protocol must be http or https' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed URL format' };
  }
}

describe('Model Utils & Capability Inference (25 tests)', () => {
  it('normalizes OpenAI prefix', () => {
    expect(normalizeModelId('openai/gpt-4o')).toBe('gpt-4o');
  });

  it('normalizes Anthropic prefix', () => {
    expect(normalizeModelId('anthropic/claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
  });

  it('normalizes Google prefix', () => {
    expect(normalizeModelId('google/gemini-3.8-flash-tiered-exp')).toBe('gemini-3.8-flash-tiered-exp');
  });

  it('trims whitespace and converts uppercase to lowercase', () => {
    expect(normalizeModelId('  GPT-4O-MINI  ')).toBe('gpt-4o-mini');
  });

  it('detects OpenAI provider for gpt-4o', () => {
    expect(detectProvider('gpt-4o')).toBe('openai');
  });

  it('detects OpenAI provider for o1-preview', () => {
    expect(detectProvider('o1-preview')).toBe('openai');
  });

  it('detects OpenAI provider for o3-mini', () => {
    expect(detectProvider('o3-mini')).toBe('openai');
  });

  it('detects Anthropic provider for claude-3-5-sonnet', () => {
    expect(detectProvider('claude-3-5-sonnet')).toBe('anthropic');
  });

  it('detects Gemini provider for gemini-3.1-pro-high', () => {
    expect(detectProvider('gemini-3.1-pro-high')).toBe('gemini');
  });

  it('detects Custom provider for llama-3-70b', () => {
    expect(detectProvider('llama-3-70b')).toBe('custom');
  });

  it('infers 128k context window for gpt-4o', () => {
    const info = inferCapabilities('gpt-4o');
    expect(info.contextWindow).toBe(128000);
  });

  it('infers 1M context window for gemini-3.1-pro-high', () => {
    const info = inferCapabilities('gemini-3.1-pro-high');
    expect(info.contextWindow).toBe(1000000);
  });

  it('infers 200k context window for claude-3-5-sonnet', () => {
    const info = inferCapabilities('claude-3-5-sonnet');
    expect(info.contextWindow).toBe(200000);
  });

  it('infers 8192 default context window for custom models', () => {
    const info = inferCapabilities('custom-model-v1');
    expect(info.contextWindow).toBe(8192);
  });

  it('infers vision support for gpt-4o', () => {
    expect(inferCapabilities('gpt-4o').supportsVision).toBe(true);
  });

  it('infers vision support for claude-3-haiku', () => {
    expect(inferCapabilities('claude-3-haiku').supportsVision).toBe(true);
  });

  it('infers vision support for gemini-3.8-flash-tiered', () => {
    expect(inferCapabilities('gemini-3.8-flash-tiered').supportsVision).toBe(true);
  });

  it('disables function calling for o1-mini', () => {
    expect(inferCapabilities('o1-mini').supportsFunctionCalling).toBe(false);
  });

  it('enables function calling for gpt-4o-mini', () => {
    expect(inferCapabilities('gpt-4o-mini').supportsFunctionCalling).toBe(true);
  });

  it('validates valid https base URL', () => {
    const res = validateBaseUrl('https://api.openai.com/v1');
    expect(res.valid).toBe(true);
  });

  it('validates valid http localhost base URL', () => {
    const res = validateBaseUrl('http://localhost:9999/v1');
    expect(res.valid).toBe(true);
  });

  it('rejects invalid protocol ftp://', () => {
    const res = validateBaseUrl('ftp://api.openai.com');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('protocol must be http or https');
  });

  it('rejects malformed URLs', () => {
    const res = validateBaseUrl('not-a-url');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Malformed URL');
  });

  it('rejects empty string base URL', () => {
    const res = validateBaseUrl('');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('non-empty string');
  });

  it('returns normalizedId in inferCapabilities output', () => {
    const info = inferCapabilities('OpenAI/GPT-4O');
    expect(info.normalizedId).toBe('gpt-4o');
  });
});
