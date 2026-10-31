import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface VerificationChallengeResult {
  found: boolean;
  validationUrl?: string;
  qrCodeDataUrl?: string;
  logFile?: string;
  timestamp?: string;
  accountEmail?: string;
  reason?: string;
  message?: string;
  carrierWarning?: string;
  error?: string;
}

/**
 * Returns potential root directories containing Antigravity / Antigravity IDE logs.
 */
export function getAntigravityLogRoots(): string[] {
  const roots: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    roots.push(
      path.join(appData, 'Antigravity IDE', 'logs'),
      path.join(appData, 'Antigravity', 'logs'),
      path.join(userProfile, '.gemini', 'antigravity', 'logs')
    );
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    roots.push(
      path.join(home, 'Library', 'Application Support', 'Antigravity IDE', 'logs'),
      path.join(home, 'Library', 'Application Support', 'Antigravity', 'logs'),
      path.join(home, 'Library', 'Logs', 'Antigravity IDE'),
      path.join(home, 'Library', 'Logs', 'Antigravity'),
      path.join(home, '.gemini', 'antigravity', 'logs')
    );
  } else {
    const home = process.env.HOME || '';
    roots.push(
      path.join(home, '.config', 'Antigravity IDE', 'logs'),
      path.join(home, '.config', 'Antigravity', 'logs'),
      path.join(home, '.gemini', 'antigravity', 'logs')
    );
  }
  return roots.filter((r) => {
    try {
      return fs.existsSync(r);
    } catch {
      return false;
    }
  });
}

/**
 * Cleans extracted validation URLs by decoding HTML entities and escaped chars.
 */
export function cleanValidationUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  url = url.replace(/&amp;/g, '&');
  url = url.replace(/\\u0026/g, '&');
  url = url.replace(/\\"/g, '');
  url = url.replace(/["';\)\],]+$/, '');
  return url;
}

/**
 * Searches a single log file content for validation URLs and error markers.
 */
export function parseValidationFromLogContent(content: string): {
  url?: string;
  reason?: string;
  message?: string;
  email?: string;
} | null {
  if (!content) return null;

  // Regex pattern matching Google Account verification links
  const urlRegex = /https:\/\/accounts\.google\.com\/signin\/(?:continue|oauth)[^"'\s\\]+/i;
  const match = content.match(urlRegex);

  // Check if VALIDATION_REQUIRED or related errors are present
  const isValidationRequired =
    content.includes('VALIDATION_REQUIRED') ||
    content.includes('Verify your account to continue') ||
    content.includes('validation_url') ||
    content.includes('The device you used to scan the QR code was used too many times');

  if (match) {
    const cleanedUrl = cleanValidationUrl(match[0]);

    // Extract nearby email if present
    const emailMatch = content.match(/([a-zA-Z0-9_.+-]+@gmail\.com|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
    const email = emailMatch ? emailMatch[1] : undefined;

    return {
      url: cleanedUrl,
      reason: isValidationRequired ? 'VALIDATION_REQUIRED' : 'CHALLENGE_REQUIRED',
      message: 'Vérification interactive requise par Google Cloud Code / Antigravity.',
      email,
    };
  }

  if (isValidationRequired) {
    return {
      reason: 'VALIDATION_REQUIRED',
      message: 'Vérification requise détectée mais l\'URL spécifique n\'a pas pu être extraite.',
    };
  }

  return null;
}

/**
 * Scans recent Antigravity logs to detect any active Google security challenge (validation_url)
 * and generates a high-resolution QR code data URL for mobile phone resolution.
 */
export async function detectAntigravityVerificationChallenge(): Promise<VerificationChallengeResult> {
  const roots = getAntigravityLogRoots();
  if (roots.length === 0) {
    return {
      found: false,
      message: 'Aucun répertoire de logs Antigravity trouvé sur le système.',
    };
  }

  const logFiles: Array<{ path: string; mtime: number }> = [];

  for (const root of roots) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          // Check inside session folder (e.g. 20261015T163306)
          const targetFiles = ['ls-main.log', 'language_server.log', 'auth.log'];
          for (const tf of targetFiles) {
            const subLog = path.join(fullPath, tf);
            if (fs.existsSync(subLog)) {
              try {
                const stat = fs.statSync(subLog);
                logFiles.push({ path: subLog, mtime: stat.mtimeMs });
              } catch {
                // Ignore stat errors
              }
            }
          }
        } else if (entry.isFile() && (entry.name.endsWith('.log') || entry.name.includes('ls-main'))) {
          try {
            const stat = fs.statSync(fullPath);
            logFiles.push({ path: fullPath, mtime: stat.mtimeMs });
          } catch {
            // Ignore stat errors
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  // Sort by modification time descending (newest log files first)
  logFiles.sort((a, b) => b.mtime - a.mtime);

  // Inspect the top 15 most recent log files
  const candidates = logFiles.slice(0, 15);

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate.path);
      const readSize = Math.min(stat.size, 150 * 1024); // Last 150 KB
      const buffer = Buffer.alloc(readSize);
      const fd = fs.openSync(candidate.path, 'r');
      fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const parsed = parseValidationFromLogContent(content);

      if (parsed?.url) {
        let qrCodeDataUrl: string | undefined;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const qrcode = require('qrcode');
          qrCodeDataUrl = await qrcode.toDataURL(parsed.url, {
            width: 240,
            margin: 1,
            color: { dark: '#000000FF', light: '#FFFFFFFF' },
          });
        } catch {
          // Best effort QR generation
        }

        return {
          found: true,
          validationUrl: parsed.url,
          qrCodeDataUrl,
          logFile: candidate.path,
          timestamp: new Date(candidate.mtime).toISOString(),
          accountEmail: parsed.email,
          reason: parsed.reason,
          message: parsed.message,
          carrierWarning:
            'Attention : Ne pas envoyer de SMS vers les numéros courts US (244444 / 96831) qui échouent hors USA. Privilégiez l\'option "Vérification sur l\'appareil (Device check)" ou Google Prompt / Authenticator.',
        };
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    found: false,
    message: 'Aucune validation_url active détectée dans les logs récents d\'Antigravity.',
  };
}

/**
 * Resets local Antigravity onboarding and kills any hung language server processes
 * so the freshly validated Google authentication is immediately picked up.
 */
export function resetAntigravityOnboarding(): { success: boolean; message: string; error?: string } {
  try {
    // 1. Terminate running language_server processes
    if (process.platform === 'win32') {
      try {
        execSync('taskkill /F /IM language_server.exe /T', { stdio: 'ignore', windowsHide: true });
      } catch {
        // Process might not be running
      }
    } else {
      try {
        execSync('pkill -f language_server', { stdio: 'ignore' });
      } catch {
        // Process might not be running
      }
    }

    // 2. Remove stale onboarding lock / cached error state files
    let clearedCount = 0;
    const candidateFolders: string[] = [];

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || '';
      candidateFolders.push(
        path.join(appData, 'Antigravity IDE', 'User', 'workspaceStorage'),
        path.join(appData, 'Antigravity', 'User', 'workspaceStorage')
      );
    } else if (process.platform === 'darwin') {
      const home = process.env.HOME || '';
      candidateFolders.push(
        path.join(home, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'workspaceStorage'),
        path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'workspaceStorage')
      );
    } else {
      const home = process.env.HOME || '';
      candidateFolders.push(
        path.join(home, '.config', 'Antigravity IDE', 'User', 'workspaceStorage'),
        path.join(home, '.config', 'Antigravity', 'User', 'workspaceStorage')
      );
    }

    for (const folder of candidateFolders) {
      if (fs.existsSync(folder)) {
        try {
          const files = fs.readdirSync(folder);
          for (const f of files) {
            if (f.includes('quota') || f.includes('auth') || f.includes('onboarding')) {
              try {
                fs.rmSync(path.join(folder, f), { recursive: true, force: true });
                clearedCount++;
              } catch {
                // Ignore individual file removal errors
              }
            }
          }
        } catch {
          // Ignore directory access error
        }
      }
    }

    return {
      success: true,
      message: `Processus réinitialisé (${clearedCount} fichiers de session temporaires purgés). Vous pouvez relancer la connexion dans Antigravity.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Échec de la réinitialisation de l\'onboarding Antigravity.',
      error: err?.message || String(err),
    };
  }
}
