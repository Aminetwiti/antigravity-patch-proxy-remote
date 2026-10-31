/**
 * Windows elevation helpers.
 *
 * `certutil -addstore` and `netsh winhttp set proxy` both require an
 * elevated (Administrator) process on Windows. Running them from a
 * non-elevated Node process yields an exit code of 5 (ERROR_ACCESS_DENIED)
 * with stderr that, depending on the Node.js version, may or may not
 * include the recognizable "Access is denied" / "0x80070005" strings.
 *
 * The reliable approach is:
 *   1. Detect whether the *current* process is elevated (cached).
 *   2. If not elevated, re-launch the command through `Start-Process -Verb
 *      RunAs` in a PowerShell that asks for UAC consent.
 *
 * The helper also handles macOS (sudo) and Linux (sudo) by re-launching
 * the command with sudo when not already root, so the higher-level
 * `installCaCert` / `setSystemProxy` functions can call a single
 * `runElevated()` entry point on every platform.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { getPlatform } from './platform';

const execFileAsync = promisify(execFile);

let cachedElevation: boolean | null = null;

/**
 * Returns true when the current Node process is running with Administrator
 * privileges on Windows, root on macOS/Linux.
 *
 * Cached after the first call because elevation status does not change
 * during the lifetime of the process.
 */
export async function isElevated(): Promise<boolean> {
  if (cachedElevation !== null) return cachedElevation;
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      // `net session` succeeds only when the process is in the Administrators
      // group. Any non-zero exit code means "not elevated".
      await execFileAsync('net', ['session'], { windowsHide: true });
      cachedElevation = true;
    } else if (platform === 'darwin' || platform === 'linux') {
      // process.getuid() === 0 is the canonical "running as root" check on
      // POSIX systems. On Windows it returns -1.
      cachedElevation = typeof process.getuid === 'function' && process.getuid() === 0;
    } else {
      cachedElevation = false;
    }
  } catch {
    cachedElevation = false;
  }
  return cachedElevation;
}

/**
 * Result of an elevated command execution.
 */
export interface ElevatedResult {
  ok: boolean;
  message: string;
  /** Raw captured stderr (may be empty even on success). */
  stderr: string;
  /** Raw captured stdout (may be empty even on success). */
  stdout: string;
  /** Process exit code (0 when ok, non-zero otherwise). */
  code: number;
  /** True when the command was re-launched via UAC/sudo. */
  elevated: boolean;
}

/**
 * Run a command, re-launching it with elevation if necessary.
 *
 * On Windows, elevation is requested through:
 *   Start-Process <exe> -ArgumentList <args> -Verb RunAs -Wait -WindowStyle Hidden
 * which triggers a UAC consent dialog. The call blocks until the user
 * accepts or dismisses the prompt and the elevated child exits.
 *
 * On macOS/Linux, the command is re-launched with `sudo -n` (non-interactive)
 * if a cached credential exists. If sudo needs a password and stdin is not
 * a TTY, the call fails fast — the caller is expected to surface a clear
 * "needs sudo password" message rather than hang.
 *
 * @param command  Executable to run (e.g. 'certutil', 'netsh', 'security').
 * @param args     Argument list, without shell quoting (we handle that).
 */
export async function runElevated(
  command: string,
  args: string[],
): Promise<ElevatedResult> {
  const platform = getPlatform();
  const elevated = await isElevated();

  // Helper: run directly, capture stdout/stderr even on non-zero exit.
  const runDirect = async (): Promise<ElevatedResult> => {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true });
      return { ok: true, message: 'ok', stdout, stderr, code: 0, elevated: false };
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string; code?: number };
      return {
        ok: false,
        message: err.message,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        code: typeof err.code === 'number' ? err.code : 1,
        elevated: false,
      };
    }
  };

  if (elevated) {
    return runDirect();
  }

  // Non-elevated: route through the platform's elevation mechanism.
  if (platform === 'win32') {
    return runElevatedWindows(command, args);
  }
  if (platform === 'darwin' || platform === 'linux') {
    return runElevatedPosix(command, args);
  }
  return runDirect();
}

/**
 * Windows-specific elevation: spawn `Start-Process -Verb RunAs -Wait` in
 * a hidden PowerShell window. `-Wait` blocks until the elevated child
 * finishes or the UAC prompt is dismissed.
 */
async function runElevatedWindows(command: string, args: string[]): Promise<ElevatedResult> {
  // Build a single-quoted argument list. `Start-Process -ArgumentList`
  // expects a single space-separated string where each token is wrapped in
  // double quotes; embedded double quotes are doubled.
  const quotedArgs = args.map((a) => {
    const escaped = a.replace(/"/g, '""');
    return `"${escaped}"`;
  });
  const argLine = quotedArgs.join(' ');

  const psScript =
    `$p = Start-Process -FilePath "${command}" -ArgumentList '${argLine}' ` +
    `-Verb RunAs -Wait -WindowStyle Hidden -PassThru; ` +
    `Write-Output ("EXITCODE=" + $p.ExitCode)`;

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { windowsHide: true },
    );
    const m = stdout.match(/EXITCODE=(\d+)/);
    const code = m ? parseInt(m[1], 10) : 0;
    return {
      ok: code === 0,
      message: code === 0 ? 'ok' : `elevated command exited with code ${code}`,
      stdout,
      stderr,
      code,
      elevated: true,
    };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string; code?: number };
    // UAC declined, or powershell not available — surface the original
    // message but make it actionable.
    const stderrText = err.stderr ?? err.stdout ?? err.message;
    const declined = /cancel|declined|denied/i.test(stderrText) || err.message.includes('cancel');
    return {
      ok: false,
      message: declined
        ? 'UAC prompt was cancelled by the user'
        : `Failed to elevate: ${stderrText}`,
      stdout: err.stdout ?? '',
      stderr: stderrText,
      code: typeof err.code === 'number' ? err.code : 1,
      elevated: true,
    };
  }
}

/**
 * POSIX elevation: prepend `sudo` to the command. We use `sudo -n` so the
 * call fails fast when no cached credential is available instead of
 * hanging on a password prompt.
 */
async function runElevatedPosix(command: string, args: string[]): Promise<ElevatedResult> {
  const sudoArgs = ['-n', command, ...args];
  try {
    const { stdout, stderr } = await execFileAsync('sudo', sudoArgs);
    return { ok: true, message: 'ok', stdout, stderr, code: 0, elevated: true };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      message:
        'sudo elevation failed (no cached password or user declined). ' +
        `Original error: ${err.message}`,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
      elevated: true,
    };
  }
}

/** Reset the cached elevation status. Exposed for tests. */
export function _resetElevationCache(): void {
  cachedElevation = null;
}

/** Re-export so callers can check the OS user for diagnostics. */
export function getCurrentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}
