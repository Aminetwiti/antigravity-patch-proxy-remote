/**
 * Core module: Antigravity account authentication & eligibility status.
 *
 * Diagnoses 403 / VALIDATION_REQUIRED errors, inspects OS credentials,
 * terminates stuck processes, and assists with Google Account age verification.
 */
import fs from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { getLsLogPath } from './paths';
import { getPlatform, isWsl } from './platform';
import { listAntigravityCredentials, purgeAntigravityCredentials } from './credentials';
import { openInBrowser } from './browser';

const execFileAsync = promisify(execFile);

export const GOOGLE_AGE_VERIFICATION_URL = 'https://myaccount.google.com/age-verification';
export const GOOGLE_CONNECTIONS_URL = 'https://myaccount.google.com/connections';

export interface AuthDiagnosticResult {
  credentialsFound: string[];
  hasEligibilityError: boolean;
  lastErrorLine?: string;
  logPath: string;
}

/** Error patterns indicating Google account eligibility / age verification blocks. */
const ELIGIBILITY_PATTERNS = [
  /VALIDATION_REQUIRED/i,
  /not eligible for (?:Antigravity|gemini code assist)/i,
  /Eligibility check failed/i,
  /403 Forbidden/i,
];

/**
 * Scan recent language server logs for Google account eligibility errors.
 */
export function scanAuthEligibilityErrors(maxLines = 200): { hasError: boolean; lastErrorLine?: string; logPath: string } {
  const logPath = getLsLogPath();
  if (!fs.existsSync(logPath)) {
    return { hasError: false, logPath };
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const recent = lines.slice(-maxLines);

    for (let i = recent.length - 1; i >= 0; i--) {
      const line = recent[i]!;
      if (ELIGIBILITY_PATTERNS.some((pat) => pat.test(line))) {
        return {
          hasError: true,
          lastErrorLine: line.trim(),
          logPath,
        };
      }
    }
  } catch {
    // Read errors ignored
  }

  return { hasError: false, logPath };
}

/**
 * Run a full diagnostic of the local Antigravity authentication state.
 */
export async function diagnoseAuthState(): Promise<AuthDiagnosticResult> {
  const credentialsFound = await listAntigravityCredentials();
  const logScan = scanAuthEligibilityErrors();

  return {
    credentialsFound,
    hasEligibilityError: logScan.hasError,
    lastErrorLine: logScan.lastErrorLine,
    logPath: logScan.logPath,
  };
}

/**
 * Kill all processes related to Antigravity and the CLI.
 */
export async function killAllAuthProcesses(): Promise<string[]> {
  const platform = getPlatform();
  const killed: string[] = [];

  const targets = ['agy.exe', 'Antigravity.exe', 'Antigravity IDE.exe', 'language_server.exe'];
  const unixTargets = ['agy', 'Antigravity', 'Antigravity IDE', 'language_server'];

  if (platform === 'win32' || isWsl()) {
    const taskkill = platform === 'win32' ? 'taskkill' : '/mnt/c/Windows/System32/taskkill.exe';
    for (const name of targets) {
      try {
        await execFileAsync(taskkill, ['/F', '/IM', name], platform === 'win32' ? { windowsHide: true } : undefined);
        killed.push(name);
      } catch {
        // Process wasn't running
      }
    }
    return killed;
  }

  for (const name of unixTargets) {
    try {
      await execFileAsync('pkill', ['-f', name]);
      killed.push(name);
    } catch {
      // Process wasn't running
    }
  }

  return killed;
}

/**
 * Launch an interactive terminal running the `agy` CLI for re-authentication.
 */
export function launchAgyTerminal(): boolean {
  const platform = getPlatform();

  try {
    if (platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', 'agy'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return true;
    }

    if (platform === 'darwin') {
      execFile('osascript', ['-e', 'tell app "Terminal" to do script "agy"'], () => {});
      return true;
    }

    // Linux
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'alacritty', 'kitty', 'xterm'];
    for (const term of terminals) {
      try {
        const args = term === 'gnome-terminal' ? ['--', 'agy'] : ['-e', 'agy'];
        const child = spawn(term, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }

  return false;
}
