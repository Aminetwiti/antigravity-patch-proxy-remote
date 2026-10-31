/**
 * `ag-doctor config` — read/write persistent configuration.
 *
 * Subcommands:
 *   list                 Show all settings (JSON)
 *   get <key>            Get a single dotted-path value (e.g. ui.theme)
 *   set <key> <value>    Set a single value
 *   reset                Restore defaults
 *   path                 Print the config file path
 */
import fs from 'fs';
import type { CommandContext } from '../types';
import {
  loadConfig,
  saveConfig,
  resetConfig,
  setConfigValue,
  getConfigValue,
  getConfigPath,
  DEFAULT_CONFIG,
  DEFAULT_MITM_PORT,
} from '../core/config';
import { c, header, ok, error, info, table } from '../cli/output';

const USAGE = `ag-doctor config — manage persistent settings

Usage:
  ag-doctor config list                 Show all settings (JSON)
  ag-doctor config get <key>            Get a single value (e.g. ui.theme)
  ag-doctor config set <key> <value>    Set a single value
  ag-doctor config reset                Restore defaults
  ag-doctor config path                 Print config file path

Examples:
  ag-doctor config set mitmPort ${DEFAULT_MITM_PORT}
  ag-doctor config set ui.theme light
  ag-doctor config set snapshot.enabled false
  ag-doctor config get doctorInterval
`;

export async function runConfig(ctx: CommandContext, sub: string | undefined, rest: string[]): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case 'list':
    case 'ls':
      return runList(ctx);
    case 'get':
      return runGet(ctx, rest[0]);
    case 'set':
      return runSet(ctx, rest[0], rest[1]);
    case 'reset':
      return runReset(ctx);
    case 'path':
      console.log(getConfigPath());
      return 0;
    default:
      error(`Unknown config subcommand: ${sub}`);
      console.log(USAGE);
      return 2;
  }
}

function runList(ctx: CommandContext): number {
  if (!ctx.json) header('Configuration');
  const cfg = loadConfig();
  if (ctx.json) {
    console.log(JSON.stringify({ path: getConfigPath(), config: cfg }, null, 2));
    return 0;
  }
  info(`File: ${getConfigPath()}`);
  console.log('');
  table([
    ['mitmPort', String(cfg.mitmPort)],
    ['logLines', String(cfg.logLines)],
    ['doctorInterval', `${cfg.doctorInterval} ms`],
    ['ui.theme', cfg.ui.theme],
    ['ui.accent', cfg.ui.accent],
    ['history.maxRuns', String(cfg.history.maxRuns)],
    ['snapshot.enabled', cfg.snapshot.enabled ? c.green('yes') : c.yellow('no')],
    ['snapshot.maxSnapshots', String(cfg.snapshot.maxSnapshots)],
    ['ui.retryButton', cfg.ui.retryButton ? c.green('yes') : c.yellow('no')],
    ['ui.suggestionPills', cfg.ui.suggestionPills ? c.green('yes') : c.yellow('no')],
    ['ui.suggestions', `${cfg.ui.suggestions?.length || 0} items`],
  ]);
  return 0;
}

function runGet(ctx: CommandContext, key: string | undefined): number {
  if (!key) {
    error('Usage: ag-doctor config get <key>');
    return 2;
  }
  const v = getConfigValue(key);
  if (v === undefined) {
    error(`Unknown key: ${key}`);
    return 2;
  }
  if (ctx.json) {
    console.log(JSON.stringify({ key, value: v }, null, 2));
  } else {
    console.log(typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return 0;
}

function runSet(ctx: CommandContext, key: string | undefined, value: string | undefined): number {
  if (!key || value === undefined) {
    error('Usage: ag-doctor config set <key> <value>');
    return 2;
  }
  try {
    const cfg = setConfigValue(key, value);
    if (ctx.json) {
      console.log(JSON.stringify({ key, value: getConfigValue(key), config: cfg }, null, 2));
    } else {
      ok(`${key} = ${getConfigValue(key)}`);
    }
    return 0;
  } catch (e) {
    error((e as Error).message);
    return 2;
  }
}

function runReset(ctx: CommandContext): number {
  const cfg = resetConfig();
  if (ctx.json) {
    console.log(JSON.stringify({ reset: true, config: cfg }, null, 2));
  } else {
    ok(`Config reset to defaults at ${getConfigPath()}`);
  }
  return 0;
}
