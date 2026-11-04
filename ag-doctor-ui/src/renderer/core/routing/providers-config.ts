/**
 * Declarative provider presets and default upstream URLs for the renderer UI.
 */

export interface RendererProviderPreset {
  id: string;
  name: string;
  defaultApiUrl: string;
  defaultModel: string;
  providerType?: 'openai' | 'anthropic' | 'google' | 'custom';
  defaultKey?: string;
}

export const RENDERER_PROVIDER_PRESETS: Record<string, RendererProviderPreset> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultApiUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    providerType: 'openai',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultApiUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    providerType: 'anthropic',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    defaultApiUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    providerType: 'custom',
    defaultKey: 'ollama',
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    defaultApiUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    providerType: 'openai',
    defaultKey: 'lm-studio',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultApiUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    providerType: 'openai',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter AI',
    defaultApiUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-r1',
    providerType: 'openai',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek Cloud',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    providerType: 'openai',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash-tiered',
    providerType: 'google',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash-tiered',
    providerType: 'google',
  },
  localai: {
    id: 'localai',
    name: 'LocalAI',
    defaultApiUrl: 'http://localhost:8000/v1',
    defaultModel: 'default',
    providerType: 'custom',
  },
};

export function getRendererDefaultUrl(providerType: string): string {
  const normalized = (providerType || '').toLowerCase().trim();
  return RENDERER_PROVIDER_PRESETS[normalized]?.defaultApiUrl || 'https://api.openai.com/v1';
}
