import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

export let memoryLoadCodeAssistCache: string | null = null;
export let memoryLoadCodeAssistTime = 0;

export function getLoadCodeAssistCachePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      log.warn('[Proxy] Failed to create cache directory:', e);
    }
  }
  return path.join(dir, 'load_code_assist_cache.json');
}

export function unlockCodeAssistPayload(rawJson: string): string {
  try {
    const data = JSON.parse(rawJson);
    if (data && typeof data === 'object') {
      const tiers = Array.isArray(data.allowedTiers) ? data.allowedTiers : [];
      const hasPro = tiers.some((t: any) => t?.id === 'g1-pro-tier');
      if (!hasPro) {
        tiers.push({ id: 'g1-pro-tier', isDefault: true });
        data.allowedTiers = tiers;
      }
      if (!data.currentTier || data.currentTier.id === 'free-tier') {
        data.currentTier = { id: 'g1-pro-tier', name: 'Google AI Pro' };
      }
      if (!data.paidTier) {
        data.paidTier = { id: 'g1-pro-tier', name: 'Google AI Pro' };
      }
      return JSON.stringify(data);
    }
  } catch {
    // If not valid JSON, return as-is
  }
  return rawJson;
}

export function loadCachedCodeAssist(): string | null {
  if (memoryLoadCodeAssistCache) return unlockCodeAssistPayload(memoryLoadCodeAssistCache);
  try {
    const p = getLoadCodeAssistCachePath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8').trim();
      if (content.startsWith('{')) {
        const unlocked = unlockCodeAssistPayload(content);
        memoryLoadCodeAssistCache = unlocked;
        memoryLoadCodeAssistTime = Date.now();
        return unlocked;
      }
    }
  } catch (e) {
    log.debug('[Proxy] Failed to load cached code assist:', e);
  }
  return null;
}

export function saveCachedCodeAssist(content: string): void {
  try {
    const unlocked = unlockCodeAssistPayload(content);
    memoryLoadCodeAssistCache = unlocked;
    memoryLoadCodeAssistTime = Date.now();
    const p = getLoadCodeAssistCachePath();
    fs.writeFileSync(p, unlocked, 'utf-8');
  } catch (e) {
    log.warn('[Proxy] Failed to save cached code assist:', e);
  }
}

export function isTelemetryRpcUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.includes('/exa.language_server_pb.LanguageServerService/Record') ||
    url.includes('/exa.language_server_pb.LanguageServerService/DetectBattleModeAutoTrigger') ||
    url.includes('recordTrajectoryAnalytics') ||
    url.includes('writeTrajectoryAcls') ||
    url.includes('/v1internal:record')
  );
}
