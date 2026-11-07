import { execFile } from 'child_process';
import log from 'electron-log';

export interface DiscoveredLocalCredential {
  accessToken?: string;
  refreshToken?: string;
  expiry?: string;
  authMethod?: string;
}

/**
 * Discovers Google OAuth credentials saved by Antigravity CLI or Antigravity IDE
 * in the operating system's native credential store.
 * 
 * - Windows: Windows Credential Manager target `gemini:antigravity`
 * - macOS: Keychain Service `gemini:antigravity`
 * - Linux: secret-tool service `gemini` username `antigravity`
 */
export async function discoverLocalAntigravityCredential(): Promise<DiscoveredLocalCredential | null> {
  const platform = process.platform;

  if (platform === 'win32') {
    return discoverWindowsCredential();
  } else if (platform === 'darwin') {
    return discoverMacCredential();
  } else if (platform === 'linux') {
    return discoverLinuxCredential();
  }

  return null;
}

function discoverWindowsCredential(): Promise<DiscoveredLocalCredential | null> {
  return new Promise((resolve) => {
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CredMgr {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)]
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
        IntPtr ptr;
        if (CredRead(target, 1, 0, out ptr)) {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, cred.CredentialBlobSize);
            CredFree(ptr);
            return System.Text.Encoding.UTF8.GetString(blob);
        }
        return null;
    }
}
"@
$res = [CredMgr]::Read('gemini:antigravity')
if ($res) { Write-Output $res }
`;

    const child = execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
      timeout: 5000,
    }, (err, stdout) => {
      if (err || !stdout) {
        if (err) log.debug('[LocalDiscovery] Windows Credential lookup error:', err.message);
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        const tokenObj = parsed.token || parsed;
        resolve({
          accessToken: tokenObj.access_token,
          refreshToken: tokenObj.refresh_token,
          expiry: tokenObj.expiry,
          authMethod: parsed.auth_method,
        });
      } catch (e) {
        log.warn('[LocalDiscovery] Failed to parse Windows credential payload:', e);
        resolve(null);
      }
    });

    child.on('error', () => resolve(null));
  });
}

function discoverMacCredential(): Promise<DiscoveredLocalCredential | null> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'gemini:antigravity', '-w'], {
      timeout: 5000,
    }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const tokenObj = parsed.token || parsed;
        resolve({
          accessToken: tokenObj.access_token,
          refreshToken: tokenObj.refresh_token,
          expiry: tokenObj.expiry,
          authMethod: parsed.auth_method,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

function discoverLinuxCredential(): Promise<DiscoveredLocalCredential | null> {
  return new Promise((resolve) => {
    execFile('secret-tool', ['lookup', 'service', 'gemini', 'username', 'antigravity'], {
      timeout: 5000,
    }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const tokenObj = parsed.token || parsed;
        resolve({
          accessToken: tokenObj.access_token,
          refreshToken: tokenObj.refresh_token,
          expiry: tokenObj.expiry,
          authMethod: parsed.auth_method,
        });
      } catch {
        resolve(null);
      }
    });
  });
}
