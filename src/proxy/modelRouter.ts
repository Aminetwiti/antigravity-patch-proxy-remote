/**
 * Smart Model Router for Antigravity Proxy
 * Analyzes prompt characteristics and provider health to select the best available model.
 */

import log from 'electron-log';
import type { CustomModel } from './types';

/** Map of hostnames currently in rate-limit cooldown (hostname -> timestamp when cooldown expires) */
const rateLimitedHosts = new Map<string, number>();

/** Cooldown duration for a rate-limited provider (60 seconds) */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

function extractHostname(apiUrl: string): string | null {
  try {
    return new URL(apiUrl).hostname;
  } catch (err) {
    log.debug(`[SmartRouter] Invalid URL ignored for rate limiting: ${apiUrl}`, err);
    return null;
  }
}

/** Mark a provider host as rate-limited */
export function markProviderRateLimited(apiUrl: string): void {
  const host = extractHostname(apiUrl);
  if (!host) return;
  const expiresAt = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  rateLimitedHosts.set(host, expiresAt);
  log.warn(`[SmartRouter] Provider host ${host} marked rate-limited until ${new Date(expiresAt).toISOString()}`);
}

/** Check if a provider host is currently rate-limited */
export function isProviderRateLimited(apiUrl: string): boolean {
  const host = extractHostname(apiUrl);
  if (!host) return false;
  const expiresAt = rateLimitedHosts.get(host);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    rateLimitedHosts.delete(host);
    return false;
  }
  return true;
}

export type TaskCategory = 'code' | 'thinking' | 'fast' | 'general';

/** Analyze prompt content to categorize the task */
export function categorizePrompt(promptText: string): TaskCategory {
  if (!promptText) return 'general';

  const lower = promptText.toLowerCase();

  // Code tasks: presence of code blocks, syntax keywords, refactoring, debugging
  const isCode =
    lower.includes('```') ||
    /\b(function|const|class|import|def|return|async|await|docker|ssh|git|bug|fix|refactor|error|exception|stacktrace|sql|api)\b/.test(lower);

  if (isCode) return 'code';

  // Thinking tasks: complex architecture, planning, deep analysis
  const isThinking =
    /\b(architect|design pattern|analyse|plan|compare|pros and cons|evaluate|strategy|benchmark)\b/.test(lower) ||
    promptText.length > 1500;

  if (isThinking) return 'thinking';

  // Fast tasks: short questions, greetings, simple definitions
  if (promptText.length < 100) return 'fast';

  return 'general';
}

/** Select the optimal model from available models based on task category and health */
export function selectBestModel(
  requestedModel: CustomModel,
  allModels: CustomModel[],
  promptText: string,
): CustomModel {
  // If requested model's provider is healthy, respect user choice
  if (!isProviderRateLimited(requestedModel.apiUrl)) {
    return requestedModel;
  }

  log.warn(`[SmartRouter] Requested model ${requestedModel.displayName || requestedModel.name} is rate-limited. Routing...`);

  const category = categorizePrompt(promptText);
  log.info(`[SmartRouter] Task categorized as: ${category}`);

  // Filter models whose providers are NOT rate-limited
  const healthyModels = allModels.filter((m) => !isProviderRateLimited(m.apiUrl));

  if (healthyModels.length === 0) {
    log.error('[SmartRouter] All providers are currently rate-limited!');
    return requestedModel; // Fallback to requested, which will return clean 429
  }

  // Pick best match by category
  const match = healthyModels.find((m) => {
    const nameLower = (m.externalModelName || m.name || '').toLowerCase();
    if (category === 'code') return nameLower.includes('qwen') || nameLower.includes('sonnet') || nameLower.includes('coder');
    if (category === 'thinking') return nameLower.includes('thinking') || nameLower.includes('r1') || nameLower.includes('pro');
    if (category === 'fast') return nameLower.includes('flash') || nameLower.includes('mini') || nameLower.includes('haiku');
    return true;
  });

  const selected = match || healthyModels[0];
  log.info(`[SmartRouter] Routed to candidate: ${selected.displayName || selected.name}`);
  return selected;
}
