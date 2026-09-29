import log from 'electron-log';
import { loadCustomModels } from './modelLoader';
import { detectModelCapabilities, getCanonicalModelKey } from './modelUtils';
import { generateModelPlaceholderId, toSlug } from './idGenerator';
import { getCachedHealth, ModelHealthResult } from './modelHealthChecker';
import { isRecentModel } from './recentModelsStore';
import type { CustomModel } from './types';
import { expandModelsWithEffort } from './effortExpander';
import { isObsoleteModel } from '../constants';

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
    const effort = m._effortSuffix || '';
    const key = `${getCanonicalModelKey(m.externalModelName || m.name, m.displayName)}${effort}`;

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

export function resolvePlanModelEnum(modelName?: string): string {
  if (!modelName) return 'MODEL_PLACEHOLDER_M54';
  const norm = modelName.toLowerCase();
  if (norm.includes('flash')) return 'MODEL_PLACEHOLDER_M16';
  return 'MODEL_PLACEHOLDER_M54';
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
      planModel: resolvePlanModelEnum(m.externalModelName || m.name),
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
  const filteredCustom = (customModels || []).filter(
    (m) => !isObsoleteModel(m.externalModelName || m.name, m.displayName),
  );
  const sortedCustomModels = deduplicateModels(sortCustomModels(expandModelsWithEffort(filteredCustom)));
  const customCanonKeys = new Set(
    sortedCustomModels.map((m) => getCanonicalModelKey(m.externalModelName || m.name, m.displayName)),
  );
  if (Array.isArray(target)) {
    const cleanTarget = target.filter((t: any) => {
      const id = t?.name || t?.model || t?.id || '';
      const disp = t?.displayName || '';
      return !isObsoleteModel(id, disp) && !customCanonKeys.has(getCanonicalModelKey(id, disp));
    });
    const mapped = sortedCustomModels.map((m) => {
      const cap = detectModelCapabilities(m, true);
      const pid = generateModelPlaceholderId(m);
      return {
        name: 'models/' + pid,
        model: pid,
        planModel: resolvePlanModelEnum(m.externalModelName || m.name),
        requestedModel: pid,
        version: '1.0',
        displayName: formatDisplayName(m),
        description: m.description,
        inputTokenLimit: cap.maxTokens,
        outputTokenLimit: cap.maxOutputTokens,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        temperature: 0.7,
        topP: 0.9,
        topK: cap.isThinking ? undefined : 40,
        reasoningEffort: m.reasoningEffort || undefined,
        thinkingBudget: m.thinkingBudget || undefined,
        mode: m.mode || undefined,
      };
    });
    return [...mapped, ...cleanTarget];
  } else if (target && typeof target === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
      const disp = (v as any)?.displayName || '';
      const innerModel = (v as any)?.model;
      const isNativeModel = typeof innerModel === 'string' && innerModel.startsWith('MODEL_');
      if ((isNativeModel || !isObsoleteModel(k, disp)) && !customCanonKeys.has(getCanonicalModelKey(k, disp))) {
        result[k] = v;
      }
    }
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
        planModel: resolvePlanModelEnum(m.externalModelName || m.name),
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
      (result as Record<string, unknown>)[`models/${pid}`] = entry;
      if (m.name && m.name !== pid && m.name !== slug && !(m.name in (target as object))) {
        (result as Record<string, unknown>)[m.name] = entry;
      }
      if (m.externalModelName && m.externalModelName !== pid && m.externalModelName !== slug && !(m.externalModelName in (target as object))) {
        (result as Record<string, unknown>)[m.externalModelName] = entry;
      }
      log.debug(
        `[Proxy] Custom model "${m.displayName}" => slug: ${slug} => model: ${generateModelPlaceholderId(m)} => thinking: ${cap.isThinking} => images: ${cap.supportsImages}`,
      );
    });

    // Also register all custom models (including per-account entries marked _poolOnly)
    // so Language Server can resolve specific account placeholder keys (e.g. MODEL_PLACEHOLDER_M577)
    if (customModels && customModels.length > 0) {
      const allVariants = [...customModels, ...expandModelsWithEffort(customModels)];
      allVariants.forEach((m) => {
        const pid = generateModelPlaceholderId(m);
        if (!(result as Record<string, unknown>)[pid]) {
          const cap = detectModelCapabilities(m, true);
          const slug = toSlug(m);
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
            planModel: resolvePlanModelEnum(m.externalModelName || m.name),
            requestedModel: pid,
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            modelProvider: 'MODEL_PROVIDER_GOOGLE',
          };
          (result as Record<string, unknown>)[pid] = entry;
          (result as Record<string, unknown>)[`models/${pid}`] = entry;
          if (slug && !(result as Record<string, unknown>)[slug]) {
            (result as Record<string, unknown>)[slug] = entry;
          }
          if (m.name && !(result as Record<string, unknown>)[m.name]) {
            (result as Record<string, unknown>)[m.name] = entry;
          }
          if (m.externalModelName && !(result as Record<string, unknown>)[m.externalModelName]) {
            (result as Record<string, unknown>)[m.externalModelName] = entry;
          }
        }
      });
    }

    // Register aliases for existing Google models so internal enum keys
    // (e.g. entry.model === 'MODEL_PLACEHOLDER_M50' for gemini-3.1-flash-lite,
    //  or 'MODEL_PLACEHOLDER_M71' for gemini-3.6-flash-high)
    // are directly resolvable by key in Language Server's model table.
    for (const [k, v] of Object.entries(result)) {
      if (v && typeof v === 'object') {
        const innerModel = (v as { model?: unknown }).model;
        if (typeof innerModel === 'string' && innerModel && innerModel !== k) {
          if (!result[innerModel]) {
            result[innerModel] = v;
          }
          if (!result[`models/${innerModel}`]) {
            result[`models/${innerModel}`] = v;
          }
        }
      }
    }

    // Compatibility fallback: ensure legacy/placeholder models (e.g. MODEL_PLACEHOLDER_M0..M600)
    // resolve cleanly in Language Server without "unknown model key: model not found"
    const fallbackPid = sortedCustomModels.length > 0 ? generateModelPlaceholderId(sortedCustomModels[0]) : '';
    const fallbackEntry = (fallbackPid && (result as Record<string, unknown>)[fallbackPid]) ||
      (result as Record<string, unknown>)['gemini-3.8-flash'] ||
      (result as Record<string, unknown>)['gemini-3.7-flash'] ||
      (result as Record<string, unknown>)['gemini-3.6-flash'] ||
      DEFAULT_CANONICAL_GOOGLE_MODELS['gemini-3.8-flash'] ||
      DEFAULT_CANONICAL_GOOGLE_MODELS['gemini-3.6-flash'];

    if (fallbackEntry) {
      for (let i = 0; i <= 650; i++) {
        const legacyKey = `MODEL_PLACEHOLDER_M${i}`;
        if (!result[legacyKey]) {
          const placeholderEntry = {
            ...(fallbackEntry as Record<string, unknown>),
            displayName: `Model Placeholder ${i}`,
            model: legacyKey,
            planModel: legacyKey,
            requestedModel: legacyKey,
          };
          (result as Record<string, unknown>)[legacyKey] = placeholderEntry;
          (result as Record<string, unknown>)[`models/${legacyKey}`] = placeholderEntry;
        } else if (!result[`models/${legacyKey}`]) {
          (result as Record<string, unknown>)[`models/${legacyKey}`] = result[legacyKey];
        }
      }
    }

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
    planModel: 'MODEL_PLACEHOLDER_M16',
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
    planModel: 'MODEL_PLACEHOLDER_M16',
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
    planModel: 'MODEL_PLACEHOLDER_M16',
    requestedModel: 'gemini-3.6-flash',
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
    planModel: 'MODEL_PLACEHOLDER_M54',
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
    planModel: 'MODEL_PLACEHOLDER_M54',
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
    planModel: 'MODEL_PLACEHOLDER_M54',
    requestedModel: 'gpt-oss-120b',
    apiProvider: 'API_PROVIDER_OPENAI',
    modelProvider: 'MODEL_PROVIDER_OPENAI',
    supportsImages: false,
    supportsVision: false,
    supportsThinking: false,
  },
  'gpt-oss-120b-medium': {
    displayName: 'GPT-OSS 120B (Medium)',
    maxTokens: 131072,
    maxOutputTokens: 16384,
    model: 'gpt-oss-120b-medium',
    planModel: 'MODEL_PLACEHOLDER_M54',
    requestedModel: 'gpt-oss-120b-medium',
    apiProvider: 'API_PROVIDER_OPENAI',
    modelProvider: 'MODEL_PROVIDER_OPENAI',
    supportsImages: false,
    supportsVision: false,
    supportsThinking: true,
  },
  'gemini-3.6-flash-high': {
    displayName: 'Gemini 3.6 Flash (High)',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.6-flash-high',
    planModel: 'MODEL_PLACEHOLDER_M16',
    requestedModel: 'gemini-3.6-flash-high',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.6-flash-medium': {
    displayName: 'Gemini 3.6 Flash (Medium)',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.6-flash-medium',
    planModel: 'MODEL_PLACEHOLDER_M16',
    requestedModel: 'gemini-3.6-flash-medium',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.6-flash-low': {
    displayName: 'Gemini 3.6 Flash (Low)',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.6-flash-low',
    planModel: 'MODEL_PLACEHOLDER_M16',
    requestedModel: 'gemini-3.6-flash-low',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-pro-agent': {
    displayName: 'Gemini Pro Agent',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-pro-agent',
    planModel: 'MODEL_PLACEHOLDER_M54',
    requestedModel: 'gemini-pro-agent',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.1-pro-low': {
    displayName: 'Gemini 3.1 Pro (Low)',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.1-pro-low',
    planModel: 'MODEL_PLACEHOLDER_M54',
    requestedModel: 'gemini-3.1-pro-low',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
  },
  'gemini-3.1-flash-lite': {
    displayName: 'Gemini 3.1 Flash Lite',
    maxTokens: 1048576,
    maxOutputTokens: 65536,
    model: 'gemini-3.1-flash-lite',
    planModel: 'MODEL_PLACEHOLDER_M16',
    requestedModel: 'gemini-3.1-flash-lite',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportsImages: true,
    supportsVision: true,
    supportsThinking: true,
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
          const customCanonKeys = new Set(
            sortedCustomModels.map((m) => getCanonicalModelKey(m.externalModelName || m.name, m.displayName)),
          );
          // Keep genuine original models first; filter out any duplicate or stale custom entries,
          // as well as any original Google model IDs whose canonical key matches an injected custom model
          let originalModelIds = group.modelIds.filter(
            (id) =>
              !customSlugs.includes(id) &&
              !id.startsWith('custom-') &&
              !id.startsWith('MODEL_PLACEHOLDER_') &&
              !customPlaceholders.has(id) &&
              !customCanonKeys.has(getCanonicalModelKey(id)),
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
