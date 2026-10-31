/**
 * Core module: OS Credential Manager interface for Antigravity & Gemini.
 *
 * Provides safe, surgical enumeration and deletion of credentials stored by
 * Antigravity CLI (agy) or Antigravity IDE, without touching other system credentials.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPlatform, isWsl } from './platform';

const execFileAsync = promisify(execFile);

/** Known target keywords identifying Antigravity / Gemini CLI credentials. */
export const CREDENTIAL_KEYWORDS = ['gemini:antigravity', 'antigravity', 'agy'];

/**
 * Enumerate Antigravity-related credential targets from the OS credential store.
 */
export async function listAntigravityCredentials(): Promise<string[]> {
  const platform = getPlatform();

  if (platform === 'win32' || isWsl()) {
    try {
      const cmd = platform === 'win32' ? 'cmdkey' : '/mnt/c/Windows/System32/cmdkey.exe';
      const { stdout } = await execFileAsync(cmd, ['/list'], { timeout: 8000 });
      return parseWindowsCmdkeyTargets(stdout);
    } catch {
      return [];
    }
  }

  // macOS and Linux do not expose a flat list command without prompting or keys,
  // so we return standard candidate service identifiers if configured.
  return [];
}

/**
 * Parse output of Windows `cmdkey /list` to extract Antigravity targets.
 */
export function parseWindowsCmdkeyTargets(stdout: string): string[] {
  const targets: string[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Target:')) {
      const target = trimmed.replace(/^Target:\s*/, '').trim();
      const lower = target.toLowerCase();
      if (CREDENTIAL_KEYWORDS.some((kw) => lower.includes(kw))) {
        targets.push(target);
      }
    }
  }

  return targets;
}

/**
 * Remove Antigravity-related entries from the OS credential store.
 * Returns lists of deleted entries and errors if any occurred.
 */
export async function purgeAntigravityCredentials(): Promise<{ purged: string[]; errors: string[] }> {
  const platform = getPlatform();
  const purged: string[] = [];
  const errors: string[] = [];

  if (platform === 'win32' || isWsl()) {
    const cmd = platform === 'win32' ? 'cmdkey' : '/mnt/c/Windows/System32/cmdkey.exe';
    const targets = await listAntigravityCredentials();

    // If cmdkey /list didn't match anything specific, also attempt the exact default target 'gemini:antigravity'
    const toDelete = new Set<string>(targets);
    toDelete.add('gemini:antigravity');

    for (const target of toDelete) {
      try {
        await execFileAsync(cmd, [`/delete:${target}`], { timeout: 8000 });
        purged.push(target);
      } catch (e) {
        // cmdkey exits with error if the specific target was not present, which is normal
        const msg = (e as Error).message;
        if (!msg.includes('Element not found') && !msg.includes('not found')) {
          errors.push(`${target}: ${msg}`);
        }
      }
    }

    return { purged, errors };
  }

  if (platform === 'darwin') {
    for (const service of ['gemini', 'antigravity', 'agy', 'Antigravity IDE']) {
      try {
        await execFileAsync('security', ['delete-generic-password', '-s', service], { timeout: 8000 });
        purged.push(service);
      } catch {
        // Ignored if not found
      }
    }
    return { purged, errors };
  }

  // Linux: libsecret / secret-tool
  for (const service of ['gemini', 'antigravity', 'agy', 'Antigravity IDE']) {
    try {
      await execFileAsync('secret-tool', ['clear', 'service', service], { timeout: 8000 });
      purged.push(service);
    } catch {
      // Ignored if tool is not installed or service is not found
    }
  }

  return { purged, errors };
}
