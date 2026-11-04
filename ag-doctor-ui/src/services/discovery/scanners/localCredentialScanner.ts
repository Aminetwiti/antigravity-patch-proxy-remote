/**
 * localCredentialScanner.ts — Scans local state.vscdb and Windows Credential Manager for Antigravity tokens.
 */

import * as path from 'path';
import { execFile } from 'child_process';
import { DiscoveredAccount } from '../discoveryTypes';
import { refreshGoogleToken } from '../clients/oauthTokenRefresher';
import { fetchGoogleUserInfo } from '../clients/cloudCodeQuotaClient';
import { ensureCloudCodeProject } from '../clients/cloudCodeProjectClient';
import { fetchGoogleAccountQuotas } from '../clients/userQuotaClient';

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

/**
 * Fallback reader for Windows Credential Manager `gemini:antigravity`.
 */
export function readWindowsCredentialManager(): Promise<DiscoveredAccount | null> {
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
