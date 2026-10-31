/**
 * Pure helpers for provider/alias resolution in `models add`.
 * Kept dependency-free so it can be unit-tested in Node.
 */

export const PROVIDERS = [
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'google',
  'custom',
  'deepseek',
  'groq',
  'mistral',
  'cerebras',
  'kimi',
  'fireworks',
  'lmstudio',
  'llamacpp',
  'nvidia',
  'kimchi',
] as const;

export const PROVIDER_ALIASES: Record<string, string> = {
  'kimi-k2': 'kimi',
  moonshot: 'kimi',
  'llm.kimchi.dev': 'kimchi',
};

export type Provider = (typeof PROVIDERS)[number];

/**
 * Resolve a provider name, including aliases (case-insensitive).
 * Returns `null` if the provider is unknown.
 */
export function resolveProvider(input: string): { provider: Provider; wasAlias: boolean } | null {
  if (!input || typeof input !== 'string') return null;
  const normalized = input.toLowerCase();
  const aliased = PROVIDER_ALIASES[normalized];
  const candidate = aliased ?? normalized;
  if (!PROVIDERS.includes(candidate as Provider)) return null;
  return { provider: candidate as Provider, wasAlias: !!aliased };
}

/**
 * Suggest a provider or alias name based on a simple prefix match.
 */
export function suggestProvider(input: string): string | undefined {
  if (!input || typeof input !== 'string') return undefined;
  const normalized = input.toLowerCase();
  const allNames = [...PROVIDERS, ...Object.keys(PROVIDER_ALIASES)];
  return allNames.find(
    (p) => p.toLowerCase().startsWith(normalized) || normalized.startsWith(p.toLowerCase()),
  );
}
