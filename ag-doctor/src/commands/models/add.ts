/**
 * `ag-doctor models add` — interactive model creation.
 */
import type { CommandContext, CustomModel } from '../../types';
import { addCustomModel, loadCustomModels, validateCustomModels, modelKey } from '../../core/custom-models';
import { ask, askSecret, confirm } from '../../cli/prompts';
import { ok, error, info, header } from '../../cli/output';
import { PROVIDERS, resolveProvider, suggestProvider } from './providers';

const DEFAULT_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/models/',
  deepseek: 'https://api.deepseek.com/anthropic',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  kimi: 'https://api.moonshot.ai/anthropic/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  lmstudio: 'http://localhost:1234/v1',
  llamacpp: 'http://localhost:8080/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  // Internal proxy used by the user's setup. We probe /v1/models via
  // buildModelsUrl(), which returns /openai/v1/models — see checks/connectivity.ts.
  kimchi: 'https://llm.kimchi.dev/openai/v1/chat/completions',
};

export async function runModelsAdd(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('Add custom model');

  const options = ctx.options || {};

  let provider = options.provider as string | undefined;
  if (!provider) {
    provider = await ask(`Provider [${PROVIDERS.join('|')}]: `, 'custom');
  }

  const resolved = resolveProvider(provider);
  if (!resolved) {
    const suggestion = suggestProvider(provider);
    error(`Unknown provider: ${provider}${suggestion ? ` (did you mean "${suggestion}"?)` : ''}`);
    info(`Available: ${PROVIDERS.join(', ')}`);
    return 2;
  }
  provider = resolved.provider;

  let name = options.name as string | undefined;
  if (!name) {
    name = await ask('Model ID (e.g. models/my-model): ', '');
  }
  if (!name.startsWith('models/')) {
    error('Model ID must start with "models/"');
    return 2;
  }

  let externalModelName = options.external as string ?? options['external-name'] as string ?? undefined;
  if (!externalModelName) {
    externalModelName = await ask('External model name: ', name.replace(/^models\//, ''));
  }

  let apiUrl = options.url as string ?? options['api-url'] as string ?? undefined;
  if (!apiUrl) {
    apiUrl = await ask(`API URL [${DEFAULT_URLS[provider] ?? ''}]: `, DEFAULT_URLS[provider] ?? '');
  }

  let apiKey = options.key as string ?? options['api-key'] as string ?? undefined;
  if (apiKey === undefined) {
    apiKey = await askSecret('API key (leave empty for local): ');
  }

  let displayName = options.display as string ?? options['display-name'] as string ?? undefined;
  if (!displayName) {
    displayName = await ask('Display name (optional): ', name);
  }

  const model: CustomModel = {
    name,
    displayName,
    provider,
    apiKey: apiKey || undefined,
    apiUrl,
    externalModelName,
  };

  const file = { models: [model] };
  const issues = validateCustomModels(file);
  if (issues.length > 0) {
    error('Validation failed:');
    for (const i of issues) console.log(`  - ${i.model}.${i.field}: ${i.message}`);
    return 2;
  }

  const existing = loadCustomModels();
  if (existing.models.some((m) => modelKey(m) === modelKey(model))) {
    const overwrite = ctx.yes || await confirm(`Model "${model.name}" already exists for provider "${model.provider}". Overwrite?`, false);
    if (!overwrite) {
      info('Aborted');
      return 1;
    }
  }

  addCustomModel(model);
  ok(`Saved ${name}`);
  info('Note: encryption happens automatically when the running app next reads this file.');
  return 0;
}
