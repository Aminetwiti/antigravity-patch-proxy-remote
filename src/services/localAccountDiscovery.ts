import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

export interface DiscoveredGoogleAccount {
  source: 'gcloud_adc' | 'gcloud_db' | 'antigravity_storage' | 'custom_config';
  accountEmail?: string;
  refreshToken: string;
  projectId?: string;
  path: string;
}

/**
 * Scans local system directories for existing Google Cloud SDK, ADC, or IDE tokens.
 * Zero external dependencies: pure standard library JSON / SQLite signature parser.
 */
export async function discoverLocalGoogleAccounts(): Promise<DiscoveredGoogleAccount[]> {
  const discovered: DiscoveredGoogleAccount[] = [];
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  // 1. Google Application Default Credentials (ADC)
  const gcloudAdcPaths = [
    path.join(appData, 'gcloud', 'application_default_credentials.json'),
    path.join(home, '.config', 'gcloud', 'application_default_credentials.json'),
  ];

  for (const adcPath of gcloudAdcPaths) {
    try {
      const content = await fs.readFile(adcPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.refresh_token && typeof parsed.refresh_token === 'string') {
        discovered.push({
          source: 'gcloud_adc',
          accountEmail: parsed.client_email || parsed.account || undefined,
          refreshToken: parsed.refresh_token,
          projectId: parsed.quota_project_id || parsed.project_id || undefined,
          path: adcPath,
        });
        log.info(`[LocalDiscovery] Found Google ADC refresh token at ${adcPath}`);
      }
    } catch (_) {}
  }

  // 2. Antigravity Scratch / Backup configs
  const scratchConfigs = [
    path.join(home, '.gemini', 'antigravity', 'custom_models.json'),
    path.join(home, '.gemini', 'antigravity', 'scratch', 'custom_models.json'),
  ];

  for (const cfgPath of scratchConfigs) {
    try {
      const content = await fs.readFile(cfgPath, 'utf8');
      const parsed = JSON.parse(content);
      const list = Array.isArray(parsed) ? parsed : (parsed.models || []);
      for (const m of list) {
        if (m && m.refreshToken && typeof m.refreshToken === 'string') {
          if (!discovered.some((d) => d.refreshToken === m.refreshToken)) {
            discovered.push({
              source: 'custom_config',
              accountEmail: m.accountEmail || m.accountName,
              refreshToken: m.refreshToken,
              projectId: m.projectId,
              path: cfgPath,
            });
          }
        }
      }
    } catch (_) {}
  }

  return discovered;
}
