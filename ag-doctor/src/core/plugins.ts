/**
 * Plugin system — load user-defined checks from ~/.gemini/antigravity/checks/*.json
 *
 * A plugin is a JSON file describing a custom check that will be executed
 * as part of the `doctor` command. This allows users to extend ag-doctor
 * without modifying its source code.
 *
 * Plugin schema:
 * {
 *   "id": "disk-space",                          // unique identifier
 *   "title": "Check disk space",                 // human-readable name
 *   "command": "df -h / | tail -1",              // shell command to execute
 *   "expectExit": 0,                             // expected exit code (default: 0)
 *   "expectPattern": "(\\d+)%",                   // regex to extract value from output
 *   "warnAbove": 80,                             // threshold for warn status
 *   "errorAbove": 95,                            // threshold for error status
 *   "timeoutMs": 5000,                           // command timeout (default: 5000)
 *   "enabled": true                              // set false to disable without deleting
 * }
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAntigravityDataDir } from './paths';
import { getProfilePath } from './profile';

const execAsync = promisify(exec);

export interface PluginDefinition {
  id: string;
  title: string;
  command: string;
  expectExit?: number;
  expectPattern?: string;
  warnAbove?: number;
  errorAbove?: number;
  warnBelow?: number;
  errorBelow?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface PluginCheckResult {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  message: string;
  details?: string;
  fixable: boolean;
  source: 'plugin';
}

/** Path to the plugins directory. */
export function getPluginsDir(): string {
  return getProfilePath('checks');
}

/** Ensure the plugins directory exists. */
export function ensurePluginsDir(): string {
  const dir = getPluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validate a plugin definition.
 * Throws an Error if the plugin is malformed.
 */
export function validatePlugin(raw: unknown, sourceFile?: string): PluginDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Plugin is not an object${sourceFile ? ` (${sourceFile})` : ''}`);
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new Error(`Plugin missing 'id' (string)${sourceFile ? ` (${sourceFile})` : ''}`);
  }
  if (!/^[a-z0-9-]+$/.test(p.id)) {
    throw new Error(`Plugin id must be lowercase alphanumeric + dashes: "${p.id}"`);
  }
  if (typeof p.title !== 'string' || p.title.length === 0) {
    throw new Error(`Plugin "${p.id}" missing 'title' (string)`);
  }
  if (typeof p.command !== 'string' || p.command.length === 0) {
    throw new Error(`Plugin "${p.id}" missing 'command' (string)`);
  }

  if (p.expectExit !== undefined && typeof p.expectExit !== 'number') {
    throw new Error(`Plugin "${p.id}" 'expectExit' must be a number`);
  }
  if (p.expectPattern !== undefined && typeof p.expectPattern !== 'string') {
    throw new Error(`Plugin "${p.id}" 'expectPattern' must be a string`);
  }
  if (p.warnAbove !== undefined && typeof p.warnAbove !== 'number') {
    throw new Error(`Plugin "${p.id}" 'warnAbove' must be a number`);
  }
  if (p.errorAbove !== undefined && typeof p.errorAbove !== 'number') {
    throw new Error(`Plugin "${p.id}" 'errorAbove' must be a number`);
  }
  if (p.warnBelow !== undefined && typeof p.warnBelow !== 'number') {
    throw new Error(`Plugin "${p.id}" 'warnBelow' must be a number`);
  }
  if (p.errorBelow !== undefined && typeof p.errorBelow !== 'number') {
    throw new Error(`Plugin "${p.id}" 'errorBelow' must be a number`);
  }
  if (p.timeoutMs !== undefined && typeof p.timeoutMs !== 'number') {
    throw new Error(`Plugin "${p.id}" 'timeoutMs' must be a number`);
  }
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') {
    throw new Error(`Plugin "${p.id}" 'enabled' must be a boolean`);
  }

  return {
    id: p.id,
    title: p.title,
    command: p.command,
    expectExit: typeof p.expectExit === 'number' ? p.expectExit : 0,
    expectPattern: typeof p.expectPattern === 'string' ? p.expectPattern : undefined,
    warnAbove: typeof p.warnAbove === 'number' ? p.warnAbove : undefined,
    errorAbove: typeof p.errorAbove === 'number' ? p.errorAbove : undefined,
    warnBelow: typeof p.warnBelow === 'number' ? p.warnBelow : undefined,
    errorBelow: typeof p.errorBelow === 'number' ? p.errorBelow : undefined,
    timeoutMs: typeof p.timeoutMs === 'number' ? p.timeoutMs : 5000,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
  };
}

/**
 * Load all plugins from the plugins directory.
 * Returns a list of (plugin, sourceFile) tuples.
 * Skips invalid files but collects errors.
 */
export function loadPlugins(): { plugins: PluginDefinition[]; errors: string[] } {
  const dir = getPluginsDir();
  const plugins: PluginDefinition[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(dir)) {
    return { plugins, errors };
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const plugin = validatePlugin(raw, file);
      if (plugin.enabled) {
        plugins.push(plugin);
      }
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }

  // Sort by id for deterministic order
  plugins.sort((a, b) => a.id.localeCompare(b.id));

  return { plugins, errors };
}

/**
 * Execute a single plugin and return a check result.
 */
export async function runPlugin(plugin: PluginDefinition): Promise<PluginCheckResult> {
  const timeoutMs = plugin.timeoutMs ?? 5000;

  try {
    const { stdout, stderr } = await execAsync(plugin.command, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024, // 1 MB
    });

    const output = (stdout + stderr).trim();

    // Check exit code — we can't directly get the exit code from execAsync,
    // but if the command fails (non-zero exit), exec throws. So reaching here
    // means exit code was 0. If expectExit is 0, this is OK.
    // For non-zero expectExit, we use a shell wrapper.
    const expectExit = plugin.expectExit ?? 0;
    if (expectExit !== 0) {
      // Re-run with explicit exit code check
      return await runPluginWithExplicitExit(plugin);
    }

    return evaluateOutput(plugin, output, 0);
  } catch (e: any) {
    // exec throws on non-zero exit or timeout
    const err = e as Error & { code?: string; killed?: boolean; stdout?: string; stderr?: string };
    if (err.killed || err.code === 'ETIMEDOUT') {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'error',
        message: `Plugin timed out after ${timeoutMs}ms`,
        details: `Command: ${plugin.command}`,
        fixable: false,
        source: 'plugin',
      };
    }
    // Non-zero exit — treat as error unless expectExit matches
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    const output = ((err.stdout ?? '') + (err.stderr ?? '')).trim();
    return evaluateOutput(plugin, output, exitCode);
  }
}

/**
 * Run a plugin with explicit exit code capture (using $? in shell).
 */
async function runPluginWithExplicitExit(plugin: PluginDefinition): Promise<PluginCheckResult> {
  const timeoutMs = plugin.timeoutMs ?? 5000;
  const wrapperCmd = `${plugin.command}; echo "AGPLUGIN_EXIT=$?"`;

  try {
    const { stdout, stderr } = await execAsync(wrapperCmd, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    const allOutput = stdout + stderr;
    const lines = allOutput.trim().split(/\r?\n/);
    const lastLine = lines[lines.length - 1] ?? '';
    const match = lastLine.match(/AGPLUGIN_EXIT=(\d+)/);
    const exitCode = match ? Number(match[1]) : 0;
    const output = lines.slice(0, -1).join('\n').trim();

    return evaluateOutput(plugin, output, exitCode);
  } catch (e: any) {
    const err = e as Error & { code?: string; killed?: boolean };
    if (err.killed || err.code === 'ETIMEDOUT') {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'error',
        message: `Plugin timed out after ${timeoutMs}ms`,
        details: `Command: ${plugin.command}`,
        fixable: false,
        source: 'plugin',
      };
    }
    return {
      id: plugin.id,
      title: plugin.title,
      status: 'error',
      message: `Plugin execution failed: ${(err as Error).message}`,
      details: `Command: ${plugin.command}`,
      fixable: false,
      source: 'plugin',
    };
  }
}

/**
 * Evaluate plugin output against thresholds and patterns.
 */
function evaluateOutput(
  plugin: PluginDefinition,
  output: string,
  exitCode: number,
): PluginCheckResult {
  const expectExit = plugin.expectExit ?? 0;

  // Exit code mismatch
  if (exitCode !== expectExit) {
    return {
      id: plugin.id,
      title: plugin.title,
      status: 'error',
      message: `Plugin exited with code ${exitCode} (expected ${expectExit})`,
      details: output || undefined,
      fixable: false,
      source: 'plugin',
    };
  }

  // Extract numeric value from output if pattern provided
  let value: number | undefined;
  if (plugin.expectPattern) {
    try {
      const re = new RegExp(plugin.expectPattern);
      const m = output.match(re);
      if (m && m[1]) {
        value = Number(m[1]);
      }
    } catch {
      // invalid regex — skip
    }
  }

  // Apply thresholds
  if (value !== undefined && !isNaN(value)) {
    if (plugin.errorAbove !== undefined && value >= plugin.errorAbove) {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'error',
        message: `${plugin.title}: ${value} (>= ${plugin.errorAbove})`,
        details: output,
        fixable: false,
        source: 'plugin',
      };
    }
    if (plugin.warnAbove !== undefined && value >= plugin.warnAbove) {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'warn',
        message: `${plugin.title}: ${value} (>= ${plugin.warnAbove})`,
        details: output,
        fixable: false,
        source: 'plugin',
      };
    }
    if (plugin.errorBelow !== undefined && value < plugin.errorBelow) {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'error',
        message: `${plugin.title}: ${value} (< ${plugin.errorBelow})`,
        details: output,
        fixable: false,
        source: 'plugin',
      };
    }
    if (plugin.warnBelow !== undefined && value < plugin.warnBelow) {
      return {
        id: plugin.id,
        title: plugin.title,
        status: 'warn',
        message: `${plugin.title}: ${value} (< ${plugin.warnBelow})`,
        details: output,
        fixable: false,
        source: 'plugin',
      };
    }
    return {
      id: plugin.id,
      title: plugin.title,
      status: 'ok',
      message: `${plugin.title}: ${value}`,
      details: output,
      fixable: false,
      source: 'plugin',
    };
  }

  // No pattern / no value — just report based on exit code
  return {
    id: plugin.id,
    title: plugin.title,
    status: 'ok',
    message: 'Plugin passed',
    details: output || undefined,
    fixable: false,
    source: 'plugin',
  };
}

/**
 * Add a new plugin by writing a JSON file.
 */
export function addPlugin(plugin: PluginDefinition): string {
  validatePlugin(plugin);
  ensurePluginsDir();
  const filePath = path.join(getPluginsDir(), `${plugin.id}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Plugin "${plugin.id}" already exists at ${filePath}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(plugin, null, 2) + '\n', 'utf-8');
  return filePath;
}

/**
 * Remove a plugin by id.
 */
export function removePlugin(id: string): boolean {
  const filePath = path.join(getPluginsDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

/**
 * Get a plugin by id.
 */
export function getPlugin(id: string): PluginDefinition | null {
  const filePath = path.join(getPluginsDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return validatePlugin(raw, `${id}.json`);
  } catch {
    return null;
  }
}

/**
 * Enable or disable a plugin without deleting it.
 */
export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const plugin = getPlugin(id);
  if (!plugin) return false;
  plugin.enabled = enabled;
  const filePath = path.join(getPluginsDir(), `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(plugin, null, 2) + '\n', 'utf-8');
  return true;
}
