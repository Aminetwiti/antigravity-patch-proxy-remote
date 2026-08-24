/**
 * Centralized model capability detection.
 * Replaces ~9 duplicate regex blocks across proxy.ts.
 */

/** Helpers re-exported from src/presets/reasoningEffort.ts (single source of truth). */
import { isReasoningLikeModel } from '../presets/reasoningEffort';
export {
  REASONING_EFFORTS,
  THINKING_BUDGETS,
  adaptiveReasoningEffort,
  budgetReasoningEffort,
  coerceReasoningEffort,
  coerceThinkingBudget,
  isReasoningLikeModel,
  type ReasoningEffort as AdaptiveReasoningEffort,
  type ThinkingBudget as AdaptiveThinkingBudget,
} from '../presets/reasoningEffort';

export interface CustomModelConfig {
  name: string;
  provider: string;
  externalModelName?: string;
  displayName?: string;
  supportsImages?: boolean;
  supportsVision?: boolean;
}

export interface ModelCapabilities {
  isThinking: boolean;
  isDeepSeek: boolean;
  isClaude: boolean;
  maxTokens: number;
  maxOutputTokens: number;
  supportsImages: boolean;
}

export interface ModelNameCapabilities {
  isClaudeThinkingModel: boolean;
  isThinkingModel: boolean;
}

export interface ModelUXBadges {
  supportsVision: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  isLocal: boolean;
  contextWindowLabel: string;
}


// ─── Reasoning Modes (fetched dynamically from /v1/models) ───────────────────────
// These modes are NOT hardcoded — they are returned from the API endpoint
// and stored alongside the model for the proxy to use.

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'auto' | 'none';

export type ThinkingBudget = 'auto' | 'disabled' | 'enabled';

export type ModelMode = 'thinking' | 'reasoning' | 'non-thinking' | 'auto';

export interface ModelModeConfig {
  /**
   * The model ID (e.g. 'o1-preview', 'claude-3-7-sonnet').
   */
  id: string;
  /**
   * Display name for the model.
   */
  name: string;
  /**
   * The provider this model belongs to.
   */
  provider: string;
  /**
   * Maximum context window tokens.
   */
  maxTokens: number;
  /**
   * Maximum output tokens.
   */
  maxOutputTokens: number;
  /**
   * Whether this model supports thinking/reasoning.
   */
  supportsReasoning: boolean;
  /**
   * Whether this model supports images.
   */
  supportsImages: boolean;
  /**
   * The reasoning effort this model supports (if any).
   * e.g. o1 supports 'low', 'medium', 'high'
   * e.g. o3 supports 'low', 'medium', 'high'
   */
  supportedReasoningEfforts?: ReasoningEffort[];
  /**
   * The thinking budget this model supports (if any).
   */
  supportedThinkingBudgets?: ThinkingBudget[];
  /**
   * Default mode for this model.
   */
  defaultMode?: ModelMode;
}

// ─── Detection ────────────────────────────────────────────────────────────

const THINKING_PATTERN = /thinking|reasoning|reasoner|o1|o3|r1|opus-4|sonnet-4|claude-4|3-7|4-7|3\.7|4\.7/i;
const DEEPSEEK_PATTERN = /deepseek/i;
const CLAUDE_PATTERN = /claude|opus|sonnet/i;
const CLAUDE_THINKING_PATTERN = /opus-4|sonnet-4|claude-4|claude-3-5|claude-3-7/i;
const THINKING_MODEL_PATTERN = /opus-4|sonnet-4|claude-4/i;
const IMAGE_SUPPORT_PATTERN =
  /gpt-4o|gpt-4-turbo|gpt-4\.5|claude|gemini|glm|zhipu|vision|vl|llava|bakllava|qwenvl|qwen.*vl|qvq|pixtral|yi-vision|cogvlm|cogview|kimi|moonshot|minimax|abab|internvl|internlm|doubao|step|stepfun|baichuan|janus|paligemma|florence|multimodal|vlm|visual|mllama|llama-3\.2|llama-4|phi-3.*vision|phi-3\.5.*vision|phi-4/i;
const NO_IMAGE_PATTERN =
  /deepseek(?!.*(?:vision|vl|janus))|llama(?!.*(?:vision|vl|3\.2|4|mllama))|mixtral(?!.*vision)|mistral(?!.*(?:pixtral|vision))|codestral|qwen(?!.*(?:vl|qvq|vision))/i;

/**
 * Detects model capabilities from a custom model config object.
 */
export function detectModelCapabilities(m: CustomModelConfig, includeDisplayName = true): ModelCapabilities {
  const nameLower = (m.name || '').toLowerCase();
  const extLower = (m.externalModelName || '').toLowerCase();
  const displayLower = includeDisplayName ? (m.displayName || '').toLowerCase() : '';

  const isThinking =
    m.provider === 'anthropic' ||
    m.provider === 'openai' ||
    m.provider === 'openrouter' ||
    THINKING_PATTERN.test(nameLower) ||
    THINKING_PATTERN.test(extLower) ||
    (includeDisplayName && THINKING_PATTERN.test(displayLower));

  const isDeepSeek =
    DEEPSEEK_PATTERN.test(nameLower) ||
    DEEPSEEK_PATTERN.test(extLower) ||
    (includeDisplayName && DEEPSEEK_PATTERN.test(displayLower));

  const isClaude = m.provider === 'anthropic' || CLAUDE_PATTERN.test(nameLower) || CLAUDE_PATTERN.test(extLower);

  const maxTokens = isClaude ? 200_000 : 1_048_576;
  const maxOutputTokens = isDeepSeek ? 32_768 : isThinking ? 32_768 : 16_384;

  // Image support:
  // 1. Explicit model override takes precedence
  if (typeof m.supportsImages === 'boolean') {
    return { isThinking, isDeepSeek, isClaude, maxTokens, maxOutputTokens, supportsImages: m.supportsImages };
  }
  if (typeof m.supportsVision === 'boolean') {
    return { isThinking, isDeepSeek, isClaude, maxTokens, maxOutputTokens, supportsImages: m.supportsVision };
  }

  // 2. Automated detection based on provider and name patterns
  const allNames = nameLower + ' ' + extLower + ' ' + displayLower;
  const supportsImages =
    m.provider === 'anthropic' ||
    m.provider === 'google' ||
    IMAGE_SUPPORT_PATTERN.test(allNames) ||
    (m.provider === 'openai' && !NO_IMAGE_PATTERN.test(allNames)) ||
    (m.provider === 'openrouter' && !NO_IMAGE_PATTERN.test(allNames)) ||
    (!NO_IMAGE_PATTERN.test(allNames) && m.provider !== 'ollama' && m.provider !== 'lmstudio');

  return { isThinking, isDeepSeek, isClaude, maxTokens, maxOutputTokens, supportsImages };
}

/**
 * Simplified detection for Gemini↔Anthropic translation (checks modelName string only).
 */
export function detectModelCapabilitiesByName(modelName: string): ModelNameCapabilities {
  const lower = (modelName || '').toLowerCase();
  return {
    isClaudeThinkingModel: CLAUDE_THINKING_PATTERN.test(lower),
    isThinkingModel: THINKING_MODEL_PATTERN.test(lower),
  };
}

/**
 * Maps a model from the /v1/models endpoint to a ModelModeConfig,
 * detecting its reasoning/thinking capabilities dynamically.
 */
export function mapApiModelToModeConfig(apiModel: { id: string; name: string }, provider: string): ModelModeConfig {
  const id = apiModel.id;
  const name = apiModel.name || id;
  const lower = id.toLowerCase();

  // Detect reasoning support from the model ID (not hardcoded)
  const supportsReasoning =
    THINKING_PATTERN.test(id) ||
    /o1|o3|r1|reasoning|thinking|reasoner/i.test(id);

  // Map reasoning efforts based on model type
  let supportedReasoningEfforts: ReasoningEffort[] | undefined;
  let supportedThinkingBudgets: ThinkingBudget[] | undefined;
  let defaultMode: ModelMode = 'auto';

  if (/o1|o3|r1/i.test(id)) {
    // OpenAI o1, o3, DeepSeek R1: support low/medium/high reasoning effort
    supportedReasoningEfforts = ['low', 'medium', 'high'];
    defaultMode = 'auto';
  } else if (/thinking|reasoning|reasoner/i.test(id)) {
    // General thinking models: support auto/enabled/disabled
    supportedThinkingBudgets = ['auto', 'enabled', 'disabled'];
    defaultMode = 'auto';
  } else if (/claude|opus|sonnet/i.test(id)) {
    // Claude: support auto/enabled/disabled
    supportedThinkingBudgets = ['auto', 'enabled', 'disabled'];
    defaultMode = 'auto';
  } else {
    // Non-thinking models: no reasoning effort, default to 'none'
    supportedReasoningEfforts = undefined;
    supportedThinkingBudgets = undefined;
    defaultMode = 'non-thinking';
  }

  return {
    id,
    name,
    provider,
    supportsReasoning,
    supportsImages: IMAGE_SUPPORT_PATTERN.test(id) && !NO_IMAGE_PATTERN.test(id),
    maxOutputTokens: supportsReasoning ? 32_768 : 16_384,
    maxTokens: 1_048_576,
    supportedReasoningEfforts,
    supportedThinkingBudgets,
    defaultMode,
  };
}

/**
 * Computes UX badges for a model (Vision 🖼️, Tools 🛠️, Thinking 🧠, Local 💻, Context Window Label).
 */
export function detectModelUXBadges(m: CustomModelConfig): ModelUXBadges {
  const caps = detectModelCapabilities(m);
  const isLocal = m.provider === 'ollama' || m.provider === 'lmstudio' || m.provider === 'llamacpp';
  const supportsTools = true; // All proxy translators map tool calls
  const contextWindowLabel = caps.maxTokens >= 1_000_000 ? '1M' : `${Math.round(caps.maxTokens / 1000)}k`;

  return {
    supportsVision: caps.supportsImages,
    supportsTools,
    supportsThinking: caps.isThinking,
    isLocal,
    contextWindowLabel,
  };
}

/**
 * Merge two `ModelModeConfig` records into a single one.
 *
 * Rules:
 *  - `id`/`name`/`provider` come from `base`.
 *  - `supportsReasoning` and `supportsImages` OR-combined.
 *  - `maxTokens` and `maxOutputTokens` take the larger value.
 *  - `supportedReasoningEfforts` / `supportedThinkingBudgets` are the union
 *    of both inputs (deduplicated, preserving order).
 *  - `defaultMode` is preferred when set, otherwise undefined.
 *
 * @example
 * mergeModelCapabilities(apiModel, presetModel)
 */
export function mergeModelCapabilities(
  base: ModelModeConfig,
  override: ModelModeConfig,
): ModelModeConfig {
  const mergedReasoning: ReasoningEffort[] | undefined = mergeReasoningList(
    base.supportedReasoningEfforts,
    override.supportedReasoningEfforts,
  );
  const mergedBudgets: ThinkingBudget[] | undefined = mergeThinkingList(
    base.supportedThinkingBudgets,
    override.supportedThinkingBudgets,
  );

  return {
    id: base.id,
    name: base.name,
    provider: base.provider,
    supportsReasoning: Boolean(base.supportsReasoning || override.supportsReasoning),
    supportsImages: Boolean(base.supportsImages && override.supportsImages),
    maxOutputTokens: Math.max(base.maxOutputTokens, override.maxOutputTokens),
    maxTokens: Math.max(base.maxTokens, override.maxTokens),
    supportedReasoningEfforts: mergedReasoning,
    supportedThinkingBudgets: mergedBudgets,
    defaultMode: base.defaultMode ?? override.defaultMode,
  };
}

function mergeReasoningList(
  a?: readonly ReasoningEffort[],
  b?: readonly ReasoningEffort[],
): ReasoningEffort[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: ReasoningEffort[] = [];
  for (const list of [a, b]) {
    if (!list) continue;
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

function mergeThinkingList(
  a?: readonly ThinkingBudget[],
  b?: readonly ThinkingBudget[],
): ThinkingBudget[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: ThinkingBudget[] = [];
  for (const list of [a, b]) {
    if (!list) continue;
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Returns the preferred mode for a model, falling back to a deterministic
 * default based on capabilities. Inspired by the UCP preset-templates
 * `resolvePresetTemplateConfigurationDefault` helper.
 */
export function resolveDefaultMode(model: ModelModeConfig): ModelMode {
  if (model.defaultMode) {
    return model.defaultMode;
  }
  if (model.supportsReasoning) {
    return 'auto';
  }
  return 'non-thinking';
}

/**
 * Detects whether a model config string is a "thinking" or "reasoning" one.
 * Convenience wrapper around `isReasoningLikeModel`.
 */
export function modelHasReasoningCapability(modelName: string): boolean {
  return isReasoningLikeModel(modelName);
}


