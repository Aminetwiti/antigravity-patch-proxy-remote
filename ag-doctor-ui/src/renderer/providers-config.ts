/**
 * Declarative provider presets and default upstream URLs for the renderer UI.
 */

export interface RendererProviderPreset {
  id: string;
  name: string;
  defaultApiUrl: string;
  defaultModel: string;
}

export const RENDERER_PROVIDER_PRESETS: Record<string, RendererProviderPreset> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultApiUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultApiUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    defaultApiUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultApiUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultApiUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-r1',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
  },
};

export function getRendererDefaultUrl(providerType: string): string {
  const normalized = (providerType || '').toLowerCase().trim();
  return RENDERER_PROVIDER_PRESETS[normalized]?.defaultApiUrl || 'https://api.openai.com/v1';
}
