/**
 * Catalogue of Well-Known Provider Presets.
 * Offers 1-click configuration for standard LLM providers in the UI.
 */

export interface PresetModel {
  id: string;
  displayName: string;
  description?: string;
  enabled?: boolean;
}

export interface PresetProvider {
  id: string;
  name: string;
  category: 'General' | 'Local' | 'Experimental';
  provider: string;
  apiUrl: string;
  models: PresetModel[];
  description?: string;
  docsUrl?: string;
}

export const WELL_KNOWN_PRESETS: PresetProvider[] = [
  {
    id: 'openai-preset',
    name: 'OpenAI',
    category: 'General',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    description: 'OpenAI official API (GPT-4o, GPT-4o-mini, o1, o3-mini)',
    docsUrl: 'https://platform.openai.com',
    models: [],
  },
  {
    id: 'anthropic-preset',
    name: 'Anthropic',
    category: 'General',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    description: 'Anthropic Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus',
    docsUrl: 'https://console.anthropic.com',
    models: [],
  },
  {
    id: 'openrouter-preset',
    name: 'OpenRouter',
    category: 'General',
    provider: 'openrouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    description: 'Unified gateway for 200+ models (Claude, GPT, DeepSeek, Llama)',
    docsUrl: 'https://openrouter.ai',
    models: [],
  },
  {
    id: 'deepseek-preset',
    name: 'DeepSeek',
    category: 'General',
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    description: 'DeepSeek V3 and DeepSeek R1 reasoning model',
    docsUrl: 'https://platform.deepseek.com',
    models: [],
  },
  {
    id: 'groq-preset',
    name: 'Groq (Ultra-Fast LPUs)',
    category: 'General',
    provider: 'groq',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    description: 'Ultra-low latency inference for Llama 3.3, Mixtral, DeepSeek',
    docsUrl: 'https://console.groq.com',
    models: [],
  },
  {
    id: 'google-ai-studio-preset',
    name: 'Google AI Studio',
    category: 'General',
    provider: 'google',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
    description: 'Google Gemini 3.8 Flash Tiered, Gemini 3.1 Pro High via AI Studio API key',
    docsUrl: 'https://aistudio.google.com',
    models: [],
  },
  {
    id: 'ollama-preset',
    name: 'Ollama (Local)',
    category: 'Local',
    provider: 'ollama',
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    description: 'Run open-source LLMs locally on your own GPU/CPU',
    docsUrl: 'https://ollama.com',
    models: [],
  },
  {
    id: 'xai-preset',
    name: 'xAI (Grok)',
    category: 'General',
    provider: 'xai',
    apiUrl: 'https://api.x.ai/v1/chat/completions',
    description: 'xAI Grok conversational models with reasoning support',
    docsUrl: 'https://docs.x.ai',
    models: [],
  },
  {
    id: 'moonshot-preset',
    name: 'Moonshot (Kimi)',
    category: 'General',
    provider: 'moonshot',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    description: 'Moonshot Kimi K2 with 128K-256K context windows',
    docsUrl: 'https://platform.moonshot.cn',
    models: [],
  },
  {
    id: 'mistral-preset',
    name: 'Mistral',
    category: 'General',
    provider: 'mistral',
    apiUrl: 'https://api.mistral.ai/v1/chat/completions',
    description: 'Mistral Large 3, Codestral, Pixtral multimodal',
    docsUrl: 'https://docs.mistral.ai',
    models: [],
  },
  {
    id: 'cohere-preset',
    name: 'Cohere',
    category: 'General',
    provider: 'cohere',
    apiUrl: 'https://api.cohere.com/v1/chat',
    description: 'Cohere Command R+ with grounded RAG support',
    docsUrl: 'https://docs.cohere.com',
    models: [],
  },
  {
    id: 'groq-preset-extended',
    name: 'Groq (Extended)',
    category: 'General',
    provider: 'groq',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    description: 'Groq Gemma 2, Llama 3.1, Whisper and additional models',
    docsUrl: 'https://console.groq.com',
    models: [],
  },
  {
    id: 'openai-preset-extended',
    name: 'OpenAI (Extended)',
    category: 'General',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    description: 'OpenAI o3, o4-mini, GPT-4.1 family',
    docsUrl: 'https://platform.openai.com',
    models: [],
  },
  {
    id: 'anthropic-preset-extended',
    name: 'Anthropic (Extended)',
    category: 'General',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    description: 'Anthropic Claude 4 Sonnet / Opus / Haiku',
    docsUrl: 'https://console.anthropic.com',
    models: [],
  },
  {
    id: 'openrouter-preset-extended',
    name: 'OpenRouter (Top Trending)',
    category: 'General',
    provider: 'openrouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    description: 'Trending on OpenRouter: Qwen 3, GLM, Mistral, Kimi K2',
    docsUrl: 'https://openrouter.ai',
    models: [],
  },
  {
    id: 'deepseek-preset-extended',
    name: 'DeepSeek (Extended)',
    category: 'General',
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    description: 'DeepSeek V3, R1, Coder Variant',
    docsUrl: 'https://platform.deepseek.com',
    models: [],
  },
];
