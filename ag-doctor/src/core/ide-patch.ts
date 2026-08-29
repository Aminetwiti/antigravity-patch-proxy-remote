/**
 * IDE (Antigravity IDE v1.107.0+) patch — cloud endpoint override.
 *
 * The VS Code-based "Antigravity IDE" resolves its Cloud Code endpoint with:
 *
 *   function ieo({... cloudCodeUrlOverride }) {
 *     return cloudCodeUrlOverride || (isGoogleInternal ? ... : "https://cloudcode-pa.googleapis.com");
 *   }
 *
 * and the override comes from the standard VS Code setting `jetski.cloudCodeUrl`
 * (read via `workspace.getConfiguration("jetski").get("cloudCodeUrl")` in the
 * bundled extension). No binary/asar surgery is needed: writing
 *
  *   "jetski.cloudCodeUrl": "http://localhost:<DEFAULT_MITM_PORT>"
  *
  * into the IDE's User settings.json makes the extension spawn the language
  * server with `--cloud_code_endpoint http://localhost:<DEFAULT_MITM_PORT>`, routing all
 * Cloud Code traffic through the local proxy — the same effect the classic
 * binary patch had for the 2.x shell.
 *
 * Settings files may contain comments / trailing commas (VS Code format), so
 * this module edits them with string operations, never JSON.parse/stringify.
 * A `.bak` copy is created before the first mutation, mirroring the binary
 * patch backup convention.
 */
import fs from 'fs';
import path from 'path';
import { findAntigravityIdeInstallDir, getIdeSettingsJson } from './paths';
import { DEFAULT_MITM_PORT } from './config';

/** Read the IDE product version from resources/app/package.json (best-effort). */
export function getIdeVersion(installDir?: string): string | null {
  const dir = installDir ?? findAntigravityIdeInstallDir();
  if (!dir) return null;
  try {
    const pkgPath = path.join(dir, 'resources', 'app', 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** The VS Code setting key that overrides the Cloud Code endpoint. */
export const IDE_ENDPOINT_SETTING = 'jetski.cloudCodeUrl';
/** The value the patch writes (the local proxy). */
export const IDE_PATCHED_ENDPOINT = `http://localhost:${DEFAULT_MITM_PORT}`;

export interface IdePatchStatus {
  /** IDE install directory, or null if the IDE is not installed. */
  installDir: string | null;
  /** Path to the settings.json the patch targets (may not exist yet). */
  settingsPath: string | null;
  /** The settings file exists on disk. */
  exists: boolean;
  /** The override is present with exactly the patched value. */
  applied: boolean;
  /** The override is present but holds a different (user-set) value. */
  hasCustomValue: boolean;
  /** A .bak backup of the original settings file exists. */
  backupExists: boolean;
  /** Current value of the setting (when present). */
  currentValue: string | null;
}

const KEY_RE = /"jetski\.cloudCodeUrl"\s*:\s*("[^"]*"|true|false|null|\d+)/;

/** Read the current setting value without mutating the file. */
function readCurrentValue(content: string): string | null {
  const m = content.match(KEY_RE);
  if (!m) return null;
  const raw = m[1]!;
  if (raw.startsWith('"')) {
    return JSON.parse(raw) as string;
  }
  return raw;
}

export function getIdePatchStatus(): IdePatchStatus {
  const installDir = findAntigravityIdeInstallDir();
  const settingsPath = getIdeSettingsJson(installDir ?? undefined);
  const exists = settingsPath ? fs.existsSync(settingsPath) : false;

  let currentValue: string | null = null;
  if (exists && settingsPath) {
    try {
      currentValue = readCurrentValue(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      currentValue = null;
    }
  }

  return {
    installDir,
    settingsPath,
    exists,
    applied: currentValue === IDE_PATCHED_ENDPOINT,
    hasCustomValue: currentValue !== null && currentValue !== IDE_PATCHED_ENDPOINT,
    backupExists: settingsPath ? fs.existsSync(settingsPath + '.bak') : false,
    currentValue,
  };
}

/** Replace the setting value, or insert the key right after the opening `{`. */
function upsertSetting(content: string, value: string): string {
  if (KEY_RE.test(content)) {
    return content.replace(KEY_RE, (m, val: string) => {
      // Preserve the original key spacing for a clean diff.
      const quote = val.startsWith('"') ? '"' : '';
      const before = m.slice(0, m.length - val.length);
      return `${before}${quote}${value}${quote}`;
    });
  }
  // Insert after the first '{' (settings can start with comments/BOM).
  const brace = content.indexOf('{');
  if (brace === -1) {
    return `{\n  "${IDE_ENDPOINT_SETTING}": "${value}",\n}\n`;
  }
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  return (
    content.slice(0, brace + 1) +
    nl +
    `  "${IDE_ENDPOINT_SETTING}": "${value}",` +
    nl +
    content.slice(brace + 1)
  );
}

/** Remove the setting key and its trailing comma (leaves other content intact). */
function removeSetting(content: string): string {
  let out = content.replace(
    /,\s*"jetski\.cloudCodeUrl"\s*:\s*"[^"]*"/,
    '',
  );
  out = out.replace(/"jetski\.cloudCodeUrl"\s*:\s*"[^"]*",?\s*/, '');
  return out;
}

function ensureSettingsDir(settingsPath: string): boolean {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply the IDE endpoint override. Returns { ok, message }.
 * - Creates a .bak backup before the first mutation (like the binary patch).
 * - Creates the settings file (with just the override) if it doesn't exist.
 */
export function applyIdePatch(): { ok: boolean; message: string } {
  const status = getIdePatchStatus();
  if (!status.installDir) {
    return { ok: false, message: 'Antigravity IDE not found — nothing to patch' };
  }
  if (!status.settingsPath) {
    return { ok: false, message: 'Could not resolve the IDE settings.json path' };
  }
  if (status.applied) {
    return { ok: true, message: `IDE already patched (${IDE_ENDPOINT_SETTING}=${IDE_PATCHED_ENDPOINT})` };
  }
  if (status.hasCustomValue) {
    return {
      ok: false,
      message: `IDE setting ${IDE_ENDPOINT_SETTING} is set to "${status.currentValue}" — refusing to overwrite a user value. Remove it manually or run patch restore first.`,
    };
  }

  if (!status.exists) {
    if (!ensureSettingsDir(status.settingsPath)) {
      return { ok: false, message: `Cannot create settings directory for ${status.settingsPath}` };
    }
    fs.writeFileSync(
      status.settingsPath,
      `{\n  "${IDE_ENDPOINT_SETTING}": "${IDE_PATCHED_ENDPOINT}",\n}\n`,
      'utf-8',
    );
    return { ok: true, message: `IDE patched (created settings.json with ${IDE_ENDPOINT_SETTING})` };
  }

  // Backup before mutation (first time only).
  if (!status.backupExists) {
    fs.copyFileSync(status.settingsPath, status.settingsPath + '.bak');
  }

  let content: string;
  try {
    content = fs.readFileSync(status.settingsPath, 'utf-8');
  } catch (e) {
    return { ok: false, message: `Failed to read settings.json: ${(e as Error).message}` };
  }

  const updated = upsertSetting(content, IDE_PATCHED_ENDPOINT);
  try {
    fs.writeFileSync(status.settingsPath, updated, 'utf-8');
  } catch (e) {
    return { ok: false, message: `Failed to write settings.json: ${(e as Error).message}` };
  }

  // Also ensure out/main.js has the autostart hook so IDE starts the proxy independently
  injectIdeMainHook(status.installDir);

  return {
    ok: true,
    message: `IDE patched (${IDE_ENDPOINT_SETTING}=${IDE_PATCHED_ENDPOINT}; backup at ${status.settingsPath}.bak)`,
  };
}

const IDE_MAIN_HOOK_SIG = '// Antigravity IDE Proxy Auto-Starter Hook';
const IDE_MAIN_HOOK = `// Antigravity IDE Proxy Auto-Starter Hook
try {
  const _net = require('net');
  const _proxyPort = ${DEFAULT_MITM_PORT};
  const _s = _net.connect({ port: _proxyPort, host: '127.0.0.1' }, () => { _s.destroy(); });
  _s.on('error', () => {
    try {
      const _path = require('path');
      const _fs = require('fs');
      const _os = require('os');
      const _cp = require('child_process');
      const _runner = _path.join(_os.homedir(), '.gemini', 'antigravity', 'proxy', 'standalone-runner.js');
      if (_fs.existsSync(_runner)) {
        _cp.spawn('node', [_runner], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: Object.assign({}, process.env, { AG_PROXY_PORT: String(_proxyPort) })
        }).unref();
      }
    } catch (_) {}
  });
} catch (_) {}

`;

function injectIdeMainHook(installDir: string): void {
  try {
    const mainJsPath = path.join(installDir, 'resources', 'app', 'out', 'main.js');
    if (!fs.existsSync(mainJsPath)) return;
    const content = fs.readFileSync(mainJsPath, 'utf-8');
    if (content.includes(IDE_MAIN_HOOK_SIG)) return;
    if (!fs.existsSync(mainJsPath + '.bak')) {
      fs.copyFileSync(mainJsPath, mainJsPath + '.bak');
    }
    fs.writeFileSync(mainJsPath, IDE_MAIN_HOOK + content, 'utf-8');
  } catch {}
}

/**
 * Remove the override, restoring the original endpoint behaviour.
 *
 * The .bak copy created by applyIdePatch is deliberately NOT used here:
 * restoring from it would discard any settings the user changed in between.
 * This function removes only the override key, preserving all other edits.
 * The .bak remains as a manual recovery option.
 */
export function restoreIdePatch(): { ok: boolean; message: string } {
  const status = getIdePatchStatus();
  if (!status.installDir) {
    return { ok: false, message: 'Antigravity IDE not found' };
  }
  if (!status.settingsPath || !status.exists) {
    return { ok: false, message: 'No IDE settings file to restore' };
  }
  if (!status.applied && !status.hasCustomValue) {
    return { ok: false, message: 'IDE patch is not applied' };
  }

  let content: string;
  try {
    content = fs.readFileSync(status.settingsPath, 'utf-8');
  } catch (e) {
    return { ok: false, message: `Failed to read settings.json: ${(e as Error).message}` };
  }
  const updated = removeSetting(content);
  try {
    fs.writeFileSync(status.settingsPath, updated, 'utf-8');
  } catch (e) {
    return { ok: false, message: `Failed to write settings.json: ${(e as Error).message}` };
  }
  return { ok: true, message: 'IDE endpoint override removed' };
}
