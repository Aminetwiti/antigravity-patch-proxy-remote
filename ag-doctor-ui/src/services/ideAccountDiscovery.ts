import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

// Google Cloud Code OAuth client constants
const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

export interface QuotaBucket {
  bucketId: string;
  window: string;
  percentage: number;
  resetTime?: string;
}

export interface QuotaGroup {
  displayName: string;
  buckets: QuotaBucket[];
}

export interface AccountQuotaSummary {
  fiveHourPercentage: number;
  fiveHourResetTime?: string;
  weeklyPercentage: number;
  weeklyResetTime?: string;
  geminiFiveHourPct?: number;
  geminiFiveHourReset?: string;
  geminiWeeklyPct?: number;
  geminiWeeklyReset?: string;
  claudeFiveHourPct?: number;
  claudeFiveHourReset?: string;
  claudeWeeklyPct?: number;
  claudeWeeklyReset?: string;
  groups: QuotaGroup[];
}

export interface CloudCodeProjectInfo {
  projectId: string;
  tierId?: string;
  accountEmail?: string;
}

export interface DiscoveredAccount {
  email: string;
  name?: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  expiry?: number;
  source: 'antigravity-ide' | 'credential-manager';
  quotas?: AccountQuotaSummary;
  projectId?: string;
  tierId?: string;
}

/**
 * Returns candidate SQLite database paths for Antigravity across operating systems.
 */
export function getCandidateDbPaths(): string[] {
  const paths: string[] = [];
  const folders = ['Antigravity IDE', 'Antigravity'];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    for (const folder of folders) {
      paths.push(path.join(appData, folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    for (const folder of folders) {
      paths.push(path.join(home, 'Library', 'Application Support', folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  } else {
    const home = process.env.HOME || '';
    for (const folder of folders) {
      paths.push(path.join(home, '.config', folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  }

  return paths;
}

/**
 * Extracts Google access token and refresh token from a binary buffer.
 */
export function extractTokensFromBuffer(buf: Buffer): { accessToken: string | null; refreshToken: string | null } {
  const text = buf.toString('latin1');
  let accessMatch = text.match(/ya29\.[A-Za-z0-9_-]+/);
  let refreshMatch = text.match(/(?:g1\/\/|1\/\/)[A-Za-z0-9_-]+/);

  if (accessMatch && refreshMatch) {
    return { accessToken: accessMatch[0], refreshToken: refreshMatch[0] };
  }

  // Fallback: search for embedded base64 sequences
  const b64Matches = text.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const b64 of b64Matches) {
    try {
      const innerBuf = Buffer.from(b64, 'base64');
      const innerText = innerBuf.toString('latin1');
      if (!accessMatch) accessMatch = innerText.match(/ya29\.[A-Za-z0-9_-]+/);
      if (!refreshMatch) refreshMatch = innerText.match(/(?:g1\/\/|1\/\/)[A-Za-z0-9_-]+/);
      if (accessMatch && refreshMatch) {
        return { accessToken: accessMatch[0], refreshToken: refreshMatch[0] };
      }
    } catch {
      // Ignore base64 decoding errors for random substrings
    }
  }

  return {
    accessToken: accessMatch ? accessMatch[0] : null,
    refreshToken: refreshMatch ? refreshMatch[0] : null,
  };
}

// In-flight refresh token cache to deduplicate concurrent refresh requests
const inFlightRefreshes = new Map<string, Promise<{ accessToken: string; expiresIn: number } | null>>();

export function getInFlightRefreshCount(): number {
  return inFlightRefreshes.size;
}

/**
 * Refreshes an expired Google access token using the official Cloud Code credentials.
 * Deduplicates in-flight requests for the same refresh token.
 */
export async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  const cleanRefresh = refreshToken.startsWith('g1//') ? refreshToken.slice(1) : refreshToken;
  const existing = inFlightRefreshes.get(cleanRefresh);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: cleanRefresh,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as any;
      if (data.access_token) {
        return {
          accessToken: data.access_token,
          expiresIn: data.expires_in || 3600,
        };
      }
    } catch {
      // Network or timeout failure
    } finally {
      inFlightRefreshes.delete(cleanRefresh);
    }
    return null;
  })();

  inFlightRefreshes.set(cleanRefresh, refreshPromise);
  return refreshPromise;
}

/**
 * Discovers existing Cloud Code companion project, or triggers automatic onboarding if not found.
 */
export async function ensureCloudCodeProject(accessToken: string): Promise<CloudCodeProjectInfo | null> {
  const baseUrls = [
    'https://daily-cloudcode-pa.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ];

  for (const baseUrl of baseUrls) {
    try {
      const platformNum = process.platform === 'win32' ? 5 : (process.platform === 'darwin' ? 2 : 3);
      const metadataPayload = {
        ideType: 9,
        ide_type: 'ANTIGRAVITY',
        pluginType: 2,
        plugin_type: 2,
        platform: platformNum,
        ideName: 'antigravity',
        ide_name: 'antigravity',
      };

      // 1. Try loadCodeAssist
      const loadRes = await fetch(`${baseUrl}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({ metadata: metadataPayload }),
        signal: AbortSignal.timeout(6000),
      });

      if (loadRes.ok) {
        const loadData = (await loadRes.json()) as any;
        let accountEmail: string | undefined;
        if (loadData.manageSubscriptionUri) {
          const emailMatch = loadData.manageSubscriptionUri.match(/Email=([^&]+)/);
          if (emailMatch) {
            accountEmail = decodeURIComponent(emailMatch[1]);
          }
        }

        const defaultTier = loadData.allowedTiers?.find((tier: any) => tier.isDefault);
        const baseTier = defaultTier?.id || 'free-tier';
        const tierId = loadData.paidTier?.name ? `${loadData.paidTier.name}(${baseTier.replace('-tier', '')})` : baseTier;

        if (loadData.cloudaicompanionProject) {
          return {
            projectId: loadData.cloudaicompanionProject,
            tierId,
            accountEmail,
          };
        }

        // 2. If project not yet onboarded, trigger auto-onboarding
        const onboardRes = await fetch(`${baseUrl}/v1internal:onboardUser`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity',
          },
          body: JSON.stringify({
            tier_id: baseTier,
            metadata: metadataPayload,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (onboardRes.ok) {
          const onboardData = (await onboardRes.json()) as any;
          const discoveredId = onboardData.response?.cloudaicompanionProject?.id || onboardData.name;
          if (discoveredId) {
            return {
              projectId: discoveredId,
              tierId,
              accountEmail,
            };
          }
        }
      }
    } catch {
      // Try next base URL on network/timeout error
    }
  }

  return null;
}

/**
 * Fetches Google UserInfo (email, full name, avatar) for a valid access token.
 */
export async function fetchGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string; picture?: string } | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.email) {
        return {
          email: data.email,
          name: data.name || data.given_name,
          picture: data.picture,
        };
      }
    }
  } catch {
    // Ignore fetch error
  }
  return null;
}

/**
 * Queries Google Cloud Code for live user quota summary (5h and weekly buckets).
 */
export async function fetchGoogleAccountQuotas(accessToken: string): Promise<AccountQuotaSummary | null> {
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(7000),
      });

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) continue; // failover
        return null;
      }
      const data = (await res.json()) as any;
      const rawGroups = data.groups || [];

    const groups: QuotaGroup[] = [];
    let fiveHourPercentage = 100;
    let fiveHourResetTime: string | undefined;
    let weeklyPercentage = 100;
    let weeklyResetTime: string | undefined;

    let geminiFiveHourPct: number | undefined;
    let geminiFiveHourReset: string | undefined;
    let geminiWeeklyPct: number | undefined;
    let geminiWeeklyReset: string | undefined;

    let claudeFiveHourPct: number | undefined;
    let claudeFiveHourReset: string | undefined;
    let claudeWeeklyPct: number | undefined;
    let claudeWeeklyReset: string | undefined;

    for (const g of rawGroups) {
      const groupName = g.displayName || 'Quota Group';
      const isGeminiGroup = groupName.toLowerCase().includes('gemini');
      const isClaudeGroup = groupName.toLowerCase().includes('claude') || groupName.toLowerCase().includes('other') || groupName.toLowerCase().includes('3p') || groupName.toLowerCase().includes('gpt');
      const buckets: QuotaBucket[] = [];

      for (const b of g.buckets || []) {
        const remainingFrac = typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0;
        const pct = Math.round(remainingFrac * 100);
        const bucketId = b.bucketId || '';
        const windowStr = b.window || '';

        buckets.push({
          bucketId,
          window: windowStr,
          percentage: pct,
          resetTime: b.resetTime,
        });

        const is5h = bucketId.includes('5h') || windowStr.includes('5h') || windowStr.includes('hour');
        const isWeekly = bucketId.includes('weekly') || windowStr.includes('weekly');

        if (isGeminiGroup) {
          if (is5h) {
            geminiFiveHourPct = pct;
            geminiFiveHourReset = b.resetTime;
          }
          if (isWeekly) {
            geminiWeeklyPct = pct;
            geminiWeeklyReset = b.resetTime;
          }
        } else if (isClaudeGroup) {
          if (is5h) {
            claudeFiveHourPct = pct;
            claudeFiveHourReset = b.resetTime;
          }
          if (isWeekly) {
            claudeWeeklyPct = pct;
            claudeWeeklyReset = b.resetTime;
          }
        }

        // Gemini models group is the primary daily quota indicator for Antigravity
        if (is5h && (fiveHourPercentage === 100 || isGeminiGroup)) {
          fiveHourPercentage = pct;
          fiveHourResetTime = b.resetTime;
        }
        if (isWeekly && (weeklyPercentage === 100 || isGeminiGroup)) {
          weeklyPercentage = pct;
          weeklyResetTime = b.resetTime;
        }
      }

      groups.push({ displayName: groupName, buckets });
    }

      return {
        fiveHourPercentage,
        fiveHourResetTime,
        weeklyPercentage,
        weeklyResetTime,
        geminiFiveHourPct: geminiFiveHourPct ?? fiveHourPercentage,
        geminiFiveHourReset: geminiFiveHourReset ?? fiveHourResetTime,
        geminiWeeklyPct: geminiWeeklyPct ?? weeklyPercentage,
        geminiWeeklyReset: geminiWeeklyReset ?? weeklyResetTime,
        claudeFiveHourPct: claudeFiveHourPct ?? 100,
        claudeFiveHourReset,
        claudeWeeklyPct: claudeWeeklyPct ?? 100,
        claudeWeeklyReset,
        groups,
      };
    } catch {
      // Continue to next host on network failure
    }
  }
  return null;
}

/**
 * Triggers a minimal quota warmup ping to Google Cloud Code.
 */
export async function warmupGoogleAccount(accessToken: string): Promise<boolean> {
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) return true;
      if (res.status === 429 || res.status === 503) continue; // failover
    } catch {
      // Try next host
    }
  }
  return false;
}

/**
 * Fallback reader for Windows Credential Manager `gemini:antigravity`.
 */
function readWindowsCredentialManager(): Promise<DiscoveredAccount | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);

  return new Promise((resolve) => {
    const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CredReader {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr CredentialPtr);
    [DllImport("Advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr buffer);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    public static string Read(string target) {
        IntPtr credPtr;
        if (CredRead(target, 1, 0, out credPtr)) {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, cred.CredentialBlobSize);
            CredFree(credPtr);
            return System.Text.Encoding.UTF8.GetString(blob);
        }
        return null;
    }
}
'@
$res = [CredReader]::Read('gemini:antigravity')
if ($res) { Write-Output $res }
`;

    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 4000 }, async (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }

      try {
        const payload = JSON.parse(stdout.trim());
        const tokenObj = payload.token || payload;
        const accessToken = tokenObj.access_token;
        const refreshToken = tokenObj.refresh_token;

        if (!accessToken && !refreshToken) {
          resolve(null);
          return;
        }

        let effectiveAccess = accessToken;
        if (refreshToken) {
          const fresh = await refreshGoogleToken(refreshToken);
          if (fresh) effectiveAccess = fresh.accessToken;
        }

        if (!effectiveAccess) {
          resolve(null);
          return;
        }

        const userInfo = await fetchGoogleUserInfo(effectiveAccess);
        const quotas = await fetchGoogleAccountQuotas(effectiveAccess);
        const projectInfo = await ensureCloudCodeProject(effectiveAccess);

        resolve({
          email: userInfo?.email || projectInfo?.accountEmail || 'antigravity-user@google.com',
          name: userInfo?.name,
          picture: userInfo?.picture,
          accessToken: effectiveAccess,
          refreshToken,
          source: 'credential-manager',
          quotas: quotas || undefined,
          projectId: projectInfo?.projectId,
          tierId: projectInfo?.tierId,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

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
    } catch {
      // Continue to next DB or fallback
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
      } catch {}

      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath);

      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").get() as { value: string } | undefined;

      if (row && row.value) {
        let text = Buffer.from(row.value, 'base64').toString('utf8');
        text = text.replace(/ya29\.[A-Za-z0-9_-]+/, params.accessToken);
        if (params.refreshToken) {
          text = text.replace(/(?:g1\/\/|1\/\/)[A-Za-z0-9_-]+/, params.refreshToken);
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
