/**
 * Auto-Update Service for ag-doctor-ui.
 *
 * Implements a lightweight, zero-dependency update mechanism targeting GitHub Releases:
 * - Dual channels: Stable vs Beta (pre-releases).
 * - Full SemVer 2.0 comparison (including pre-release tags like 3.7.6-beta.1).
 * - Multi-platform asset resolution (Windows NSIS/portable, macOS DMG, Linux AppImage).
 * - Follows GitHub 302 download redirects with progress streaming.
 * - Respects system HTTP/HTTPS proxy configuration.
 */
import { app, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { spawn } from 'child_process';

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateSettings {
  autoCheck: boolean;
  lastCheckTime: number;
  checkIntervalHours: number;
  channel: UpdateChannel;
  repo: string;
}

export interface UpdateAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string;
  releaseUrl?: string;
  assetName?: string;
  assetSize?: number;
  channel: UpdateChannel;
  isPrerelease: boolean;
}

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

const DEFAULT_REPO = 'Aminetwiti/antigravity-patch-proxy';
const DEFAULT_INTERVAL_HOURS = 24;

let cachedDownloadedFilePath: string | null = null;
let downloadAbortController: { abort: () => void } | null = null;

export function getDataDir(): string {
  try {
    const home = app.getPath('home');
    const dir = path.join(home, '.gemini', 'antigravity');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch {
    return process.cwd();
  }
}

export function getSettingsPath(): string {
  return path.join(getDataDir(), 'update_settings.json');
}

export function getDefaultChannel(): UpdateChannel {
  try {
    const version = app.getVersion();
    return version.includes('-') ? 'beta' : 'stable';
  } catch {
    return 'stable';
  }
}

export function loadUpdateSettings(): UpdateSettings {
  const settingsPath = getSettingsPath();
  const defaults: UpdateSettings = {
    autoCheck: true,
    lastCheckTime: 0,
    checkIntervalHours: DEFAULT_INTERVAL_HOURS,
    channel: getDefaultChannel(),
    repo: process.env.AG_UPDATE_REPO || DEFAULT_REPO,
  };

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        channel: parsed.channel === 'beta' ? 'beta' : 'stable',
      };
    }
  } catch {
    // fallback to defaults on corruption or read error
  }
  return defaults;
}

export function saveUpdateSettings(partial: Partial<UpdateSettings>): UpdateSettings {
  const current = loadUpdateSettings();
  const updated: UpdateSettings = {
    ...current,
    ...partial,
  };
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[UpdateService] Failed to persist update settings:', err);
  }
  return updated;
}

/**
 * Compare two SemVer versions (e.g., "3.7.6" vs "3.7.5" or "3.7.6-beta.2" vs "3.7.6-beta.1").
 * Returns true if latest > current.
 */
export function compareVersions(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/, '');
    const [mainPart, prePart] = clean.split('-');
    const nums = (mainPart || '').split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);

    let pre: { tag: string; num: number } | null = null;
    if (prePart) {
      const [tag, numStr] = prePart.split('.');
      pre = {
        tag: (tag || '').toLowerCase(),
        num: numStr ? parseInt(numStr, 10) || 0 : 0,
      };
    }
    return { nums, pre };
  };

  const l = parse(latest);
  const c = parse(current);

  // 1. Compare major, minor, patch
  for (let i = 0; i < 3; i++) {
    const lNum = l.nums[i] ?? 0;
    const cNum = c.nums[i] ?? 0;
    if (lNum > cNum) return true;
    if (lNum < cNum) return false;
  }

  // 2. SemVer rule: release without pre-release > release with pre-release
  if (!l.pre && c.pre) return true; // e.g. 3.8.0 > 3.8.0-beta.1
  if (l.pre && !c.pre) return false; // e.g. 3.8.0-beta.1 < 3.8.0

  // 3. Both have pre-release
  if (l.pre && c.pre) {
    if (l.pre.tag !== c.pre.tag) {
      return l.pre.tag.localeCompare(c.pre.tag) > 0;
    }
    return l.pre.num > c.pre.num;
  }

  return false;
}

export function shouldCheckForUpdates(settings: UpdateSettings): boolean {
  if (!settings.autoCheck) return false;
  if (!settings.lastCheckTime) return true;
  const elapsedHours = (Date.now() - settings.lastCheckTime) / (1000 * 3600);
  const interval = settings.checkIntervalHours > 0 ? settings.checkIntervalHours : DEFAULT_INTERVAL_HOURS;
  return elapsedHours >= interval;
}

export function isPortableExecution(): boolean {
  if (process.platform !== 'win32') return false;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return true;
  try {
    const exeName = path.basename(process.execPath).toLowerCase();
    return exeName.includes('portable');
  } catch {
    return false;
  }
}

/**
 * Match release asset appropriate for the current platform and architecture.
 */
export function matchAssetForPlatform(
  assets: UpdateAsset[],
  platform = process.platform,
  arch = process.arch,
  portableOverride?: boolean
): UpdateAsset | null {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  if (platform === 'win32') {
    const isPort = portableOverride !== undefined ? portableOverride : isPortableExecution();
    if (isPort) {
      // Prioritize portable executable if currently running as portable
      const port = assets.find(
        (a) => a.name.endsWith('.exe') && (a.name.includes('portable') || a.name.includes('Portable') || a.name === 'ag-doctor-ui.exe')
      );
      if (port) return port;
    } else {
      // Prioritize NSIS setup executable if currently installed
      const nsis = assets.find((a) => a.name.endsWith('.exe') && (a.name.includes('Setup') || a.name.includes('setup')));
      if (nsis) return nsis;
    }
    // Fallback to any matching .exe
    const anyExe = assets.find((a) => a.name.endsWith('.exe'));
    if (anyExe) return anyExe;
  } else if (platform === 'darwin') {
    // macOS: prefer DMG matching architecture
    const archKey = arch === 'arm64' ? 'arm64' : 'x64';
    const dmgArch = assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(archKey));
    if (dmgArch) return dmgArch;
    const anyDmg = assets.find((a) => a.name.endsWith('.dmg'));
    if (anyDmg) return anyDmg;
    const anyZip = assets.find((a) => a.name.endsWith('.zip') || a.name.endsWith('.tar.gz'));
    if (anyZip) return anyZip;
  } else if (platform === 'linux') {
    // Linux: prefer AppImage
    const archKey = arch === 'arm64' ? 'aarch64' : 'amd64';
    const appImageArch = assets.find((a) => a.name.endsWith('.AppImage') && (a.name.includes(archKey) || a.name.includes(arch)));
    if (appImageArch) return appImageArch;
    const anyAppImage = assets.find((a) => a.name.endsWith('.AppImage'));
    if (anyAppImage) return anyAppImage;
    const anyDeb = assets.find((a) => a.name.endsWith('.deb') || a.name.endsWith('.rpm'));
    if (anyDeb) return anyDeb;
  }

  return assets[0] || null;
}

/**
 * Simple HTTP(S) JSON client with redirect support and timeout.
 */
export function fetchJson<T>(targetUrl: string, maxRedirects = 5): Promise<T> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many HTTP redirects'));
    }

    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'http:' ? http : https;

    const req = transport.get(
      targetUrl,
      {
        headers: {
          'User-Agent': 'ag-doctor-ui-updater',
          Accept: 'application/vnd.github.v3+json, application/json',
        },
        timeout: 10000,
      },
      (res) => {
        const { statusCode, headers } = res;

        // Follow redirects
        if (statusCode && [301, 302, 307, 308].includes(statusCode) && headers.location) {
          res.resume(); // drain stream
          return resolve(fetchJson<T>(headers.location, maxRedirects - 1));
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} when fetching ${targetUrl}`));
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as T;
            resolve(data);
          } catch (err) {
            reject(new Error(`Failed to parse response from ${targetUrl}: ${err}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout for ${targetUrl}`));
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Check GitHub repository for available updates.
 */
export async function checkForUpdates(
  channelOverride?: UpdateChannel,
  manual = false
): Promise<UpdateInfo> {
  const settings = loadUpdateSettings();
  const channel = channelOverride || settings.channel;
  const currentVersion = app.getVersion();
  const repo = settings.repo || DEFAULT_REPO;

  saveUpdateSettings({ lastCheckTime: Date.now() });

  const apiUrl =
    channel === 'stable'
      ? `https://api.github.com/repos/${repo}/releases/latest`
      : `https://api.github.com/repos/${repo}/releases?per_page=10`;

  let latestRelease: any = null;

  try {
    if (channel === 'stable') {
      latestRelease = await fetchJson<any>(apiUrl);
    } else {
      const releases = await fetchJson<any[]>(apiUrl);
      if (Array.isArray(releases) && releases.length > 0) {
        // Find latest release (including pre-releases)
        latestRelease = releases[0];
      }
    }
  } catch (err) {
    // If stable latest endpoint failed or repo has only prereleases, try general releases list
    if (channel === 'stable') {
      try {
        const fallbackUrl = `https://api.github.com/repos/${repo}/releases?per_page=10`;
        const list = await fetchJson<any[]>(fallbackUrl);
        const nonPre = list.find((r) => !r.prerelease);
        latestRelease = nonPre || list[0];
      } catch {
        // Propagate original error
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!latestRelease || !latestRelease.tag_name) {
    throw new Error('No valid releases found on repository');
  }

  const rawTag = latestRelease.tag_name as string;
  const latestVersion = rawTag.trim().replace(/^v/, '');
  const hasUpdate = compareVersions(latestVersion, currentVersion);

  const assets: UpdateAsset[] = Array.isArray(latestRelease.assets)
    ? latestRelease.assets.map((a: any) => ({
        name: a.name,
        browser_download_url: a.browser_download_url,
        size: a.size,
        content_type: a.content_type,
      }))
    : [];

  const matched = matchAssetForPlatform(assets);
  const downloadUrl = matched?.browser_download_url || latestRelease.html_url || `https://github.com/${repo}/releases/tag/${rawTag}`;

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseNotes: latestRelease.body || 'New update available.',
    publishedAt: latestRelease.published_at || new Date().toISOString(),
    downloadUrl,
    releaseUrl: latestRelease.html_url || `https://github.com/${repo}/releases/tag/${rawTag}`,
    assetName: matched?.name,
    assetSize: matched?.size,
    channel,
    isPrerelease: !!latestRelease.prerelease,
  };
}

/**
 * Download update asset to local temporary directory with progress tracking.
 */
export async function downloadUpdate(
  downloadUrl?: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    let targetUrl = downloadUrl;
    if (!targetUrl) {
      const info = await checkForUpdates();
      if (!info.hasUpdate || !info.downloadUrl) {
        return { success: false, error: 'No update available to download' };
      }
      targetUrl = info.downloadUrl;
    }

    const parsed = new URL(targetUrl);
    const baseName = path.basename(parsed.pathname) || 'ag-doctor-update.exe';
    const tempDir = path.join(app.getPath('temp'), 'ag-doctor-updates');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Use a clean target path, appending timestamp if locked/exists
    let destPath = path.join(tempDir, baseName);
    try {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
    } catch {
      // If locked (EBUSY), use unique name
      destPath = path.join(tempDir, `${Date.now()}-${baseName}`);
    }

    // Cancel any previous in-flight download
    if (downloadAbortController) {
      downloadAbortController.abort();
      downloadAbortController = null;
    }

    await new Promise<void>((resolve, reject) => {
      let aborted = false;

      const performDownload = (urlStr: string, redirectsLeft: number) => {
        if (redirectsLeft <= 0) {
          return reject(new Error('Too many redirects while downloading update'));
        }

        const u = new URL(urlStr);
        const transport = u.protocol === 'http:' ? http : https;

        const req = transport.get(
          urlStr,
          {
            headers: {
              'User-Agent': 'ag-doctor-ui-updater',
              Accept: 'application/octet-stream, */*',
            },
          },
          (res) => {
            if (aborted) {
              res.resume();
              return;
            }

            if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume();
              return performDownload(res.headers.location, redirectsLeft - 1);
            }

            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
            }

            const total = parseInt(res.headers['content-length'] || '0', 10);
            let transferred = 0;

            const file = fs.createWriteStream(destPath);
            downloadAbortController = {
              abort: () => {
                aborted = true;
                req.destroy();
                file.close();
                try {
                  fs.unlinkSync(destPath);
                } catch {}
              },
            };

            res.on('data', (chunk) => {
              transferred += chunk.length;
              if (onProgress && total > 0) {
                const percent = Math.min(100, Math.round((transferred / total) * 100));
                onProgress({ percent, transferred, total });
              }
            });

            res.pipe(file);

            file.on('finish', () => {
              file.close(() => {
                downloadAbortController = null;
                cachedDownloadedFilePath = destPath;
                resolve();
              });
            });

            file.on('error', (err) => {
              try {
                fs.unlinkSync(destPath);
              } catch {}
              reject(err);
            });
          }
        );

        req.on('error', (err) => {
          try {
            fs.unlinkSync(destPath);
          } catch {}
          reject(err);
        });
      };

      performDownload(targetUrl!, 5);
    });

    return { success: true, filePath: destPath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Execute the downloaded installer / package and close the app.
 */
export async function installUpdate(filePath?: string, silent = false): Promise<{ success: boolean; error?: string }> {
  const targetPath = filePath || cachedDownloadedFilePath;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { success: false, error: 'Downloaded update file not found' };
  }

  try {
    if (process.platform === 'win32') {
      if (targetPath.endsWith('.exe')) {
        // Spawn NSIS installer detached so it continues after app exits.
        // If silent is requested, pass /S flag.
        const args = silent ? ['/S'] : [];
        const child = spawn(targetPath, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        setTimeout(() => app.quit(), 500);
        return { success: true };
      }
    } else if (process.platform === 'darwin') {
      // macOS: open DMG or installer
      await shell.openPath(targetPath);
      return { success: true };
    } else if (process.platform === 'linux') {
      // Linux: ensure executable and run or reveal
      if (targetPath.endsWith('.AppImage')) {
        fs.chmodSync(targetPath, 0o755);
        const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        setTimeout(() => app.quit(), 500);
        return { success: true };
      } else {
        await shell.openPath(targetPath);
        return { success: true };
      }
    }

    await shell.openPath(targetPath);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Initialize automatic background update checks.
 */
export function initAutoUpdateScheduler(webContentsProvider: () => Electron.WebContents | null): void {
  // Initial check after 5 seconds
  setTimeout(async () => {
    const settings = loadUpdateSettings();
    if (shouldCheckForUpdates(settings)) {
      try {
        const info = await checkForUpdates(settings.channel);
        if (info.hasUpdate) {
          const wc = webContentsProvider();
          if (wc && !wc.isDestroyed()) {
            wc.send('ag:update:available', info);
          }
        }
      } catch (err) {
        console.warn('[UpdateService] Auto-check failed silently:', err);
      }
    }
  }, 5000);

  // Periodic recurring check every 4 hours
  setInterval(async () => {
    const settings = loadUpdateSettings();
    if (shouldCheckForUpdates(settings)) {
      try {
        const info = await checkForUpdates(settings.channel);
        if (info.hasUpdate) {
          const wc = webContentsProvider();
          if (wc && !wc.isDestroyed()) {
            wc.send('ag:update:available', info);
          }
        }
      } catch (err) {
        console.warn('[UpdateService] Periodic check failed silently:', err);
      }
    }
  }, 4 * 3600 * 1000);
}
