/**
 * `ag-doctor plugins` — manage user-defined check plugins.
 *
 * Subcommands:
 *   list                  List all installed plugins
 *   add <file>            Install a plugin from a JSON file
 *   remove <id>           Remove a plugin by id
 *   enable <id>           Re-enable a disabled plugin
 *   disable <id>          Disable a plugin without deleting it
 *   show <id>             Show plugin details
 *   path                  Print the plugins directory path
 *   init <id>             Create a sample plugin template
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import {
  loadPlugins,
  addPlugin,
  removePlugin,
  getPlugin,
  setPluginEnabled,
  getPluginsDir,
  ensurePluginsDir,
  validatePlugin,
  type PluginDefinition,
} from '../core/plugins';
import { ok, info, warn, error, header, c } from '../cli/output';

function printPluginTable(plugins: PluginDefinition[]): void {
  if (plugins.length === 0) {
    info('No plugins installed.');
    info(`Use \`ag-doctor plugins init <id>\` to create a sample, or drop a .json file in ${getPluginsDir()}`);
    return;
  }

  // Column widths
  const idW = Math.max(2, ...plugins.map((p) => p.id.length));
  const titleW = Math.max(5, ...plugins.map((p) => p.title.length));

  console.log(`${c.bold('ID'.padEnd(idW))}  ${c.bold('TITLE'.padEnd(titleW))}  ${c.bold('STATUS')}`);
  console.log(`${'-'.repeat(idW)}  ${'-'.repeat(titleW)}  ${'-'.repeat(6)}`);

  for (const p of plugins) {
    const status = p.enabled === false ? c.gray('disabled') : c.green('enabled');
    console.log(`${p.id.padEnd(idW)}  ${p.title.padEnd(titleW)}  ${status}`);
  }
}

function printPluginDetail(p: PluginDefinition): void {
  console.log(`${c.bold('ID:')}          ${p.id}`);
  console.log(`${c.bold('Title:')}       ${p.title}`);
  console.log(`${c.bold('Command:')}     ${p.command}`);
  console.log(`${c.bold('Enabled:')}     ${p.enabled !== false ? 'yes' : 'no'}`);
  if (p.expectExit !== undefined) console.log(`${c.bold('Expect exit:')}  ${p.expectExit}`);
  if (p.expectPattern) console.log(`${c.bold('Pattern:')}     ${p.expectPattern}`);
  if (p.warnAbove !== undefined) console.log(`${c.bold('Warn above:')}  ${p.warnAbove}`);
  if (p.errorAbove !== undefined) console.log(`${c.bold('Error above:')} ${p.errorAbove}`);
  if (p.timeoutMs) console.log(`${c.bold('Timeout:')}     ${p.timeoutMs}ms`);
}

function createSamplePlugin(id: string): string {
  const sample: PluginDefinition = {
    id,
    title: `Sample plugin: ${id}`,
    command: 'echo "Hello from plugin"',
    expectExit: 0,
    expectPattern: 'Hello',
    warnAbove: 50,
    errorAbove: 90,
    timeoutMs: 5000,
    enabled: true,
  };

  ensurePluginsDir();
  const filePath = path.join(getPluginsDir(), `${id}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Plugin "${id}" already exists at ${filePath}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(sample, null, 2) + '\n', 'utf-8');
  return filePath;
}

export async function runPlugins(ctx: CommandContext, sub: string | undefined, rest: string[]): Promise<number> {
  switch (sub) {
    case undefined:
    case 'list':
    case 'ls': {
      const { plugins, errors } = loadPlugins();
      if (!ctx.json) header('ag-doctor — Plugins');
      if (errors.length > 0) {
        warn(`${errors.length} plugin file(s) failed to load:`);
        for (const e of errors) console.log(`  ${c.red('✗')} ${e}`);
      }
      if (ctx.json) {
        console.log(JSON.stringify({ plugins, errors }, null, 2));
      } else {
        printPluginTable(plugins);
        console.log('');
        info(`Plugins directory: ${getPluginsDir()}`);
      }
      return 0;
    }

    case 'add': {
      const filePath = rest[0];
      if (!filePath) {
        error('Usage: ag-doctor plugins add <file.json>');
        return 2;
      }
      if (!fs.existsSync(filePath)) {
        error(`File not found: ${filePath}`);
        return 2;
      }
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const plugin = validatePlugin(raw);
        const installedPath = addPlugin(plugin);
        ok(`Plugin "${plugin.id}" installed at ${installedPath}`);
        return 0;
      } catch (e) {
        error(`Failed to install plugin: ${(e as Error).message}`);
        return 2;
      }
    }

    case 'remove':
    case 'rm': {
      const id = rest[0];
      if (!id) {
        error('Usage: ag-doctor plugins remove <id>');
        return 2;
      }
      const removed = removePlugin(id);
      if (removed) ok(`Plugin "${id}" removed.`);
      else { error(`Plugin "${id}" not found.`); return 2; }
      return 0;
    }

    case 'enable': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor plugins enable <id>'); return 2; }
      const ok2 = setPluginEnabled(id, true);
      if (ok2) ok(`Plugin "${id}" enabled.`);
      else { error(`Plugin "${id}" not found.`); return 2; }
      return 0;
    }

    case 'disable': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor plugins disable <id>'); return 2; }
      const ok2 = setPluginEnabled(id, false);
      if (ok2) ok(`Plugin "${id}" disabled.`);
      else { error(`Plugin "${id}" not found.`); return 2; }
      return 0;
    }

    case 'show': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor plugins show <id>'); return 2; }
      const p = getPlugin(id);
      if (!p) { error(`Plugin "${id}" not found.`); return 2; }
      if (ctx.json) console.log(JSON.stringify(p, null, 2));
      else printPluginDetail(p);
      return 0;
    }

    case 'path': {
      console.log(getPluginsDir());
      return 0;
    }

    case 'init': {
      const id = rest[0];
      if (!id) { error('Usage: ag-doctor plugins init <id>'); return 2; }
      if (!/^[a-z0-9-]+$/.test(id)) {
        error('Plugin id must be lowercase alphanumeric + dashes');
        return 2;
      }
      try {
        const filePath = createSamplePlugin(id);
        ok(`Sample plugin created at ${filePath}`);
        info('Edit the file to customize the check, then run `ag-doctor doctor` to test it.');
        return 0;
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
    }

    default:
      console.error(`Unknown plugins subcommand: ${sub}`);
      console.error('Usage: ag-doctor plugins {list|add|remove|enable|disable|show|path|init}');
      return 2;
  }
}
