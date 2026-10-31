/**
 * Cross-platform helper to open a URL in the user's default web browser.
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { getPlatform, isWsl } from './platform';

const execFileAsync = promisify(execFile);

export async function openInBrowser(url: string): Promise<boolean> {
  const platform = getPlatform();

  try {
    if (platform === 'win32') {
      await execFileAsync('cmd.exe', ['/c', 'start', '', url], { windowsHide: true });
      return true;
    }

    if (isWsl()) {
      // WSL can invoke Windows start via cmd.exe
      const child = spawn('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return true;
    }

    if (platform === 'darwin') {
      await execFileAsync('open', [url]);
      return true;
    }

    // Linux
    await execFileAsync('xdg-open', [url]);
    return true;
  } catch {
    return false;
  }
}
