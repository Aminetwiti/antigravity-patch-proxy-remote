/**
 * Recent Models Store for Antigravity Proxy
 * Keeps track of the most recently used custom models to pin them to the top of the IDE dropdown with ⭐.
 */

import log from 'electron-log';

const MAX_RECENT_MODELS = 3;

let recentModelSlugs: string[] = [];

export function restoreRecentModels(models: string[]): void {
  recentModelSlugs = [...models];
}

/** Record a model as recently used */
export function recordRecentModel(slugOrName: string): void {
  if (!slugOrName) return;
  recentModelSlugs = [slugOrName, ...recentModelSlugs.filter((s) => s !== slugOrName)].slice(0, MAX_RECENT_MODELS);
}

/** Get list of recent model identifiers */
export function getRecentModels(): string[] {
  return [...recentModelSlugs];
}

/** Check if a model is in the recent/favorite list */
export function isRecentModel(slugOrName: string): boolean {
  return recentModelSlugs.includes(slugOrName);
}
