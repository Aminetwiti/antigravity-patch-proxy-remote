import log from 'electron-log';
import { loadCustomModels } from './modelLoader';
import { detectModelCapabilities } from './modelUtils';
import { generateModelPlaceholderId, toSlug } from './idGenerator';
import { getCachedHealth, ModelHealthResult } from './modelHealthChecker';
import { isRecentModel } from './recentModelsStore';
import type { CustomModel } from './types';
import { expandModelsWithEffort } from './effortExpander';

function getHealthScore(health: ModelHealthResult | null): number {
  if (!health) return 2; // pending
  if (health.status === 'healthy') return 0;
  if (health.status === 'slow') return 1;
  if (health.status === 'cooldown') return 3;
  return 4; // unhealthy
}

function sortCustomModels(models: CustomModel[]): CustomModel[] {
  return [...models].sort((a, b) => {
    const favA = isRecentModel(a.name) ? 1 : 0;
    const favB = isRecentModel(b.name) ? 1 : 0;
    if (favA !== favB) return favB - favA;

    const healthA = getCachedHealth(a.name);
    const healthB = getCachedHealth(b.name);
    
    const scoreA = getHealthScore(healthA);
    const scoreB = getHealthScore(healthB);
    
    if (scoreA !== scoreB) return scoreA - scoreB;
    
    if (healthA?.status === 'healthy' && healthB?.status === 'healthy') {
       return (healthA.latencyMs || 0) - (healthB.latencyMs || 0);
    }
    
    return 0;
  });
}

export function deduplicateModels(models: CustomModel[]): CustomModel[] {
  const seenKeys = new Set<string>();
  return models.filter((m) => {
    // Per-account Google entries are dispatch/quota only — the unified
    // "auto-pool" entry represents them in the model dropdown.
    if (m._poolOnly) return false;
    const cleanDisp = (m.displayName || '').replace(/^\[[^\]]+\]\s*/, '').trim().toLowerCase();
    const rawName = (m.externalModelName || m.name || '').replace(/^models\//, '').trim().toLowerCase();
    const effort = m._effortSuffix || '';
    const key = `${m.provider}:${cleanDisp || rawName}:${rawName}${effort}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

function formatDisplayName(m: CustomModel): string {
  const health = getCachedHealth(m.name);
  const isFav = isRecentModel(m.name);
  let dispName = m.displayName || m.name;
  dispName = dispName.replace(/^\[[^\]]+\]\s*/, '');
  const favTag = isFav ? '⭐ ' : '';
  
  if (!health || health.status === 'healthy' || health.status === 'slow') {
    return `${favTag}🟢 • ${dispName}`;
  }
  
  // For unhealthy models, display error tag cleanly
  const err = health.error || 'Offline';
  return `${favTag}🔴 [${err}] • ${dispName}`;
}

export function getMappedCustomModels() {
  const customModels = deduplicateModels(sortCustomModels(expandModelsWithEffort(loadCustomModels())));
  const mappedCustom: Record<string, unknown> = {};
  customModels.forEach((m) => {
    const slug = toSlug(m);
    const pid = generateModelPlaceholderId(m);
    mappedCustom[slug] = {
      displayName: formatDisplayName(m),
      maxTokens: 1048576,
      maxOutputTokens: 4096,
      model: pid,
      planModel: pid,
      requestedModel: pid,
      apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
      modelProvider: 'MODEL_PROVIDER_GOOGLE',
    };
  });
  return mappedCustom;
}

export function getCustomModelsList() {
  const customModels = deduplicateModels(sortCustomModels(expandModelsWithEffort(loadCustomModels())));
  return customModels.map((m) => ({
    name: 'models/' + generateModelPlaceholderId(m),
    version: '1.0',
    displayName: formatDisplayName(m),
    description: m.description,
    inputTokenLimit: 1048576,
    outputTokenLimit: 4096,
    supportedGenerationMethods: ['generateContent', 'countTokens'],
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
  }));
}

export function mergeModels(target: unknown, customModels: CustomModel[]): unknown {
  const sortedCustomModels = deduplicateModels(sortCustomModels(expandModelsWithEffort(customModels)));
  if (Array.isArray(target)) {
    const mapped = sortedCustomModels.map((m) => {
      const cap = detectModelCapabilities(m, true);
      const pid = generateModelPlaceholderId(m);
      return {
        name: 'models/' + pid,
        model: pid,
        planModel: pid,
        requestedModel: pid,
        version: '1.0',
        displayName: formatDisplayName(m),
        description: m.description,
        inputTokenLimit: cap.maxTokens,
        outputTokenLimit: cap.maxOutputTokens,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        supportsImages: cap.supportsImages,
        supportsVision: cap.supportsImages,
        temperature: cap.isThinking ? undefined : 0.7,
        topP: cap.isThinking ? undefined : 0.9,
        topK: cap.isThinking ? undefined : 40,
        reasoningEffort: m.reasoningEffort || undefined,
        thinkingBudget: m.thinkingBudget || undefined,
        mode: m.mode || undefined,
      };
    });
    return [...mapped, ...target];
  } else if (target && typeof target === 'object') {
    const result = { ...(target as Record<string, unknown>) };
    sortedCustomModels.forEach((m) => {
      const slug = toSlug(m);
      const cap = detectModelCapabilities(m, true);
      const pid = generateModelPlaceholderId(m);
      const entry: Record<string, unknown> = {
        displayName: formatDisplayName(m),
        supportsImages: cap.supportsImages,
        supportsVision: cap.supportsImages,
        supportsThinking: cap.isThinking,
        reasoningEffort: m.reasoningEffort || undefined,
        thinkingBudget: m.thinkingBudget || undefined,
        mode: m.mode || undefined,
        recommended: true,
        maxTokens: cap.maxTokens,
        maxOutputTokens: cap.maxOutputTokens,
        tokenizerType: 'LLAMA_WITH_SPECIAL',
        model: pid,
        planModel: pid,
        requestedModel: pid,
        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
        modelProvider: 'MODEL_PROVIDER_GOOGLE',
      };
      if (cap.supportsImages) {
        entry.supportsVideo = false;
        entry.supportedMimeTypes = {
          'image/png': true,
          'image/jpeg': true,
          'image/webp': true,
          'image/gif': true,
          'image/heic': true,
          'image/heif': true,
          'text/plain': true,
          'text/markdown': true,
          'text/html': true,
          'text/css': true,
          'text/xml': true,
          'text/csv': true,
          'application/json': true,
          'application/pdf': true,
          'application/x-javascript': true,
          'application/x-typescript': true,
          'application/x-python-code': true,
          'application/x-ipynb+json': true,
        };
      } else {
        entry.supportsVideo = false;
        entry.supportedMimeTypes = {
          'text/plain': true,
          'text/markdown': true,
          'text/html': true,
          'text/css': true,
          'text/xml': true,
          'text/csv': true,
          'application/json': true,
          'application/pdf': true,
          'application/x-javascript': true,
          'application/x-typescript': true,
          'application/x-python-code': true,
          'application/x-ipynb+json': true,
        };
      }
      (result as Record<string, unknown>)[slug] = entry;
      (result as Record<string, unknown>)[pid] = entry;
      if (m.name && m.name !== pid && m.name !== slug && !(m.name in (target as object))) {
        (result as Record<string, unknown>)[m.name] = entry;
      }
      if (m.externalModelName && m.externalModelName !== pid && m.externalModelName !== slug && !(m.externalModelName in (target as object))) {
        (result as Record<string, unknown>)[m.externalModelName] = entry;
      }
      log.info(
        `[Proxy] Custom model "${m.displayName}" => slug: ${slug} => model: ${generateModelPlaceholderId(m)} => thinking: ${cap.isThinking} => images: ${cap.supportsImages}`,
      );
    });
    return result;

  }
  return target;
}

export const DEFAULT_CANONICAL_GOOGLE_MODELS: Record<string, Record<string, unknown>> = {
  'gemini-3.8-flash': {
    displayName: 'Gemini 3.8 Flash High Fast',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.8-flash',
    planModel: 'gemini-3.8-flash',
    requestedModel: 'gemini-3.8-flash',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.7-flash': {
    displayName: 'Gemini 3.7 Flash Medium',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.7-flash',
    planModel: 'gemini-3.7-flash',
    requestedModel: 'gemini-3.7-flash',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.6-flash': {
    displayName: 'Gemini 3.6 Flash Medium Fast',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.6-flash',
    planModel: 'gemini-3.6-flash',
    requestedModel: 'gemini-3.6-flash',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.1-pro': {
    displayName: 'Gemini 3.1 Pro Low',
    maxTokens: 2097152,
    maxOutputTokens: 65536,
    model: 'gemini-3.1-pro',
    planModel: 'gemini-3.1-pro',
    requestedModel: 'gemini-3.1-pro',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'claude-sonnet-4-6': {
    displayName: 'Claude Sonnet 4.6 (Thinking)',
    maxTokens: 200000,
    maxOutputTokens: 64000,
    model: 'claude-sonnet-4-6',
    planModel: 'claude-sonnet-4-6',
    requestedModel: 'claude-sonnet-4-6',
    apiProvider: 'API_PROVIDER_ANTHROPIC',
    modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'claude-opus-4-6': {
    displayName: 'Claude Opus 4.6 (Thinking)',
    maxTokens: 200000,
    maxOutputTokens: 64000,
    model: 'claude-opus-4-6',
    planModel: 'claude-opus-4-6',
    requestedModel: 'claude-opus-4-6',
    apiProvider: 'API_PROVIDER_ANTHROPIC',
    modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gpt-oss-120b': {
    displayName: 'GPT-OSS 120B (Medium)',
    maxTokens: 131072,
    maxOutputTokens: 16384,
    model: 'gpt-oss-120b',
    planModel: 'gpt-oss-120b',
    requestedModel: 'gpt-oss-120b',
    apiProvider: 'API_PROVIDER_OPENAI',
    modelProvider: 'MODEL_PROVIDER_OPENAI',
    supportsImages: false,
    supportsVision: false,
    supportsThinking: false,
  },
};

export const DEFAULT_CANONICAL_MODEL_IDS: string[] = Object.keys(DEFAULT_CANONICAL_GOOGLE_MODELS);

/**
 * Injects custom model slugs into `agentModelSorts` for Antigravity IDE (VS Code-based).
 *
 * Guarantees:
 * 1. Each custom model is added EXACTLY ONCE (prevents duplicate entries from slug + externalModelName).
 * 2. Original models appear FIRST (at the top); custom models are appended AFTER original models.
 * 3. Any duplicate IDs or stale custom entries already in group.modelIds are cleanly filtered.
 */
export function injectCustomSlugsIntoAgentModelSorts(
  googleJson: Record<string, unknown>,
  customModels: CustomModel[],
): void {
  const sortedCustomModels = customModels && customModels.length > 0
    ? deduplicateModels(sortCustomModels(expandModelsWithEffort(customModels)))
    : [];
  const customSlugs: string[] = [];

  sortedCustomModels.forEach((m) => {
    const slug = toSlug(m);
    m._slug = slug;
    if (!customSlugs.includes(slug)) {
      customSlugs.push(slug);
    }
  });

  if (!googleJson.agentModelSorts || !Array.isArray(googleJson.agentModelSorts)) {
    googleJson.agentModelSorts = [{ displayName: 'Recommended', groups: [{ modelIds: [...DEFAULT_CANONICAL_MODEL_IDS] }] }];
  }

  const customExternalNames = new Set(
    sortedCustomModels.map((m) => m.externalModelName).filter(Boolean) as string[],
  );
  const customPlaceholders = new Set(
    sortedCustomModels.map((m) => generateModelPlaceholderId(m)),
  );

  (googleJson.agentModelSorts as { groups?: { modelIds?: string[] }[] }[]).forEach((sort) => {
    if (sort.groups && Array.isArray(sort.groups)) {
      sort.groups.forEach((group) => {
        if (group.modelIds && Array.isArray(group.modelIds)) {
          // Keep genuine original models first; filter out any duplicate or stale custom entries
          let originalModelIds = group.modelIds.filter(
            (id) =>
              !customSlugs.includes(id) &&
              !id.startsWith('custom-') &&
              !id.startsWith('MODEL_PLACEHOLDER_') &&
              !customPlaceholders.has(id),
          );
          if (originalModelIds.length === 0) {
            originalModelIds = [...DEFAULT_CANONICAL_MODEL_IDS];
          }
          // Original models first, custom models appended cleanly after without repetition
          group.modelIds = [...originalModelIds, ...customSlugs];
        }
      });
    }
  });
}

/**
 * Builds a complete synthetic response for /v1internal:fetchAvailableModels
 * containing canonical Google/partner models and all loaded custom models,
 * with agentModelSorts and MODEL_PLACEHOLDER_M* compatibility entries.
 */
export function buildSyntheticModelsResponse(customModels?: CustomModel[]): Record<string, unknown> {
  const models = { ...DEFAULT_CANONICAL_GOOGLE_MODELS };
  const merged = mergeModels(models, customModels) as Record<string, unknown>;
  const response: Record<string, unknown> = {
    models: merged,
    agentModelSorts: [
      {
        displayName: 'Recommended',
        groups: [
          {
            modelIds: [...DEFAULT_CANONICAL_MODEL_IDS],
          },
        ],
      },
    ],
  };
  injectCustomSlugsIntoAgentModelSorts(response, customModels);
  return response;
}
