import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export * from './discoveryTypes';
export {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GEMINI_CLI_CLIENT_ID,
  GEMINI_CLI_CLIENT_SECRET,
  ANTIGRAVITY_V2_CLIENT_ID,
  ANTIGRAVITY_V2_CLIENT_SECRET,
  refreshGoogleToken,
  getInFlightRefreshCount,
} from './clients/oauthTokenRefresher';
export {
  ensureCloudCodeProject,
  ensureGeminiCliGcpProject,
} from './clients/cloudCodeProjectClient';
export {
  fetchRealGoogleModelQuotas,
  fetchGoogleUserInfo,
} from './clients/cloudCodeQuotaClient';
export {
  fetchGoogleAccountQuotas,
  warmupGoogleAccount,
} from './clients/userQuotaClient';
export {
  getCandidateDbPaths,
  extractTokensFromBuffer,
  readWindowsCredentialManager,
} from './scanners/localCredentialScanner';

import {
  DiscoveredAccount,
  AccountQuotaSummary,
  QuotaBucket,
  QuotaGroup,
  CloudCodeProjectInfo,
  AccountErrorDetails,
} from './discoveryTypes';
import { refreshGoogleToken } from './clients/oauthTokenRefresher';
import { ensureCloudCodeProject } from './clients/cloudCodeProjectClient';
import { fetchRealGoogleModelQuotas, fetchGoogleUserInfo } from './clients/cloudCodeQuotaClient';
import { fetchGoogleAccountQuotas } from './clients/userQuotaClient';
import { getCandidateDbPaths, extractTokensFromBuffer, readWindowsCredentialManager } from './scanners/localCredentialScanner';

/**
 * Main discovery entry point: finds the currently authenticated Antigravity account,
 * refreshes its token if necessary, and extracts profile and real-time quotas.
 */
export async function discoverIdeAccount(): Promise<DiscoveredAccount | null> {
  const candidateDbs = getCandidateDbPaths();

  for (const dbPath of candidateDbs) {
    if (!fs.existsSync(dbPath)) continue;

    try {
      // Use native node:sqlite DatabaseSync available in Node 22+
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });

      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").get() as { value: string } | undefined;
      const profileRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravity.profileUrl'").get() as { value: string } | undefined;

      if (row && row.value) {
        const buf = Buffer.from(row.value, 'base64');
        const extracted = extractTokensFromBuffer(buf);

        let effectiveAccessToken = extracted.accessToken;

        // If refresh token exists, refresh to get a guaranteed fresh token (valid 1 hour)
        if (extracted.refreshToken) {
          const fresh = await refreshGoogleToken(extracted.refreshToken);
          if (fresh) {
            effectiveAccessToken = fresh.accessToken;
          }
        }

        if (effectiveAccessToken) {
          let userInfo = await fetchGoogleUserInfo(effectiveAccessToken);

          // If token expired and wasn't refreshed yet, try refreshing once
          if (!userInfo && extracted.refreshToken && effectiveAccessToken === extracted.accessToken) {
            const fresh = await refreshGoogleToken(extracted.refreshToken);
            if (fresh) {
              effectiveAccessToken = fresh.accessToken;
              userInfo = await fetchGoogleUserInfo(effectiveAccessToken);
            }
          }

          if (userInfo || effectiveAccessToken) {
            const quotas = await fetchGoogleAccountQuotas(effectiveAccessToken);
            const projectInfo = await ensureCloudCodeProject(effectiveAccessToken);
            const picture = userInfo?.picture || (profileRow ? profileRow.value : undefined);

            return {
              email: userInfo?.email || projectInfo?.accountEmail || 'antigravity-account@google.com',
              name: userInfo?.name,
              picture,
              accessToken: effectiveAccessToken,
              refreshToken: extracted.refreshToken || undefined,
              source: 'antigravity-ide',
              quotas: quotas || undefined,
              projectId: projectInfo?.projectId,
              tierId: projectInfo?.tierId,
            };
          }
        }
      }
    } catch (dbErr) {
      console.debug?.('[IdeAccountDiscovery] Candidate DB read error:', dbErr);
    }
  }

  // Fallback: Windows Credential Manager
  const credManagerAccount = await readWindowsCredentialManager();
  if (credManagerAccount) {
    return credManagerAccount;
  }

  return null;
}

/**
 * Switches the active account in Antigravity's local SQLite database (`state.vscdb`).
 * Safely backs up `state.vscdb` to `state.vscdb.backup` before applying changes.
 */
export function switchActiveIdeAccount(params: {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  picture?: string;
}): { success: boolean; error?: string; dbPath?: string } {
  const candidateDbs = getCandidateDbPaths();
  let updatedAny = false;
  let lastDbPath = '';

  for (const dbPath of candidateDbs) {
    if (!fs.existsSync(dbPath)) continue;

    try {
      // Backup state.vscdb
      const backupPath = `${dbPath}.backup`;
      try {
        fs.copyFileSync(dbPath, backupPath);
      } catch (backupErr) {
        console.warn(`[IdeAccountDiscovery] Could not create backup at ${backupPath}:`, backupErr);
      }

      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath);

      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").get() as { value: string } | undefined;

      if (row && row.value) {
        let text = Buffer.from(row.value, 'base64').toString('utf8');
        const origText = text;
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') {
            parsed.access_token = params.accessToken;
            if (params.refreshToken) parsed.refresh_token = params.refreshToken;
            text = JSON.stringify(parsed);
          }
        } catch (parseErr) {
          console.debug?.('[IdeAccountDiscovery] Token is not valid JSON, applying fallback pattern replacement:', parseErr);
          text = text.replace(/ya29\.[A-Za-z0-9_-]+/, params.accessToken);
          if (params.refreshToken) {
            text = text.replace(/(?:g1\/\/|1\/\/)[A-Za-z0-9_-]+/, params.refreshToken);
          }
        }

        // If pattern replacement did not match (e.g. non-ya29 token format), build clean token blob (AUDIT-006)
        if (text === origText && !text.includes(params.accessToken)) {
          const fallbackObj = {
            access_token: params.accessToken,
            refresh_token: params.refreshToken || '',
            token_type: 'Bearer',
            expiry_date: Date.now() + 3600 * 1000,
          };
          text = JSON.stringify(fallbackObj);
        }

        const newVal = Buffer.from(text, 'utf8').toString('base64');
        db.prepare("UPDATE ItemTable SET value = ? WHERE key = 'antigravityUnifiedStateSync.oauthToken'").run(newVal);
      } else {
        // Construct basic JSON token blob if none existed
        const tokenObj = {
          access_token: params.accessToken,
          refresh_token: params.refreshToken || '',
          token_type: 'Bearer',
          expiry_date: Date.now() + 3600 * 1000,
        };
        const newVal = Buffer.from(JSON.stringify(tokenObj), 'utf8').toString('base64');
        db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.oauthToken', ?)").run(newVal);
      }

      if (params.picture) {
        db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravity.profileUrl', ?)").run(params.picture);
      }

      if (params.email) {
        db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravity.accountEmail', ?)").run(params.email);
      }

      db.close();
      updatedAny = true;
      lastDbPath = dbPath;
    } catch (err: any) {
      console.warn(`[ideAccountDiscovery] Failed to update DB ${dbPath}:`, err.message);
    }
  }

  if (updatedAny) {
    return { success: true, dbPath: lastDbPath };
  }

  return { success: false, error: 'Aucune base de données Antigravity IDE (state.vscdb) trouvée sur ce système.' };
}
