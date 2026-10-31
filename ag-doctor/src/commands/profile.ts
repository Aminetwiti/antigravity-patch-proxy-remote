/**
 * `ag-doctor profile` — manage isolated configuration profiles.
 *
 * Subcommands:
 *   list                    List all profiles
 *   use <name>              Switch to a profile (or 'default' to clear)
 *   create <name>           Create a new empty profile
 *   create <name> --clone   Create a new profile, copying from active
 *   delete <name>           Delete a profile (--force to delete active)
 *   show                    Show details of the active profile
 *   path                    Print path to the active profile directory
 *   copy <src> <dst>        Duplicate a profile
 *   rename <old> <new>      Rename a profile
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
  getActiveProfile,
  getProfileDir,
  profileExists,
  copyProfile,
  validateProfileName,
  formatBytes,
  type ProfileInfo,
} from '../core/profile';
import { ok, info, warn, error, header, c } from '../cli/output';

function printProfileTable(profiles: ProfileInfo[], active: string | null, ctx: CommandContext): void {
  if (profiles.length === 0) {
    info('No profiles defined.');
    info(`Use \`ag-doctor profile create <name>\` to create one.`);
    return;
  }

  if (ctx.json) return;

  const nameW = Math.max(4, ...profiles.map((p) => p.name.length));
  const flags = (p: ProfileInfo) => {
    const parts: string[] = [];
    if (p.hasConfig) parts.push('cfg');
    if (p.hasModels) parts.push('models');
    if (p.hasChecks) parts.push('plugins');
    if (p.hasHistory) parts.push('history');
    return parts.join(',') || '-';
  };

  console.log(`${c.bold('NAME'.padEnd(nameW))}  ${c.bold('FLAGS'.padEnd(20))}  ${c.bold('SIZE')}    ${c.bold('MODIFIED')}`);
  console.log(`${'-'.repeat(nameW)}  ${'-'.repeat(20)}  ${'-'.repeat(8)}  ${'-'.repeat(19)}`);

  for (const p of profiles) {
    const isActive = p.name === active;
    const marker = isActive ? c.green('* ') : '  ';
    const name = isActive ? c.green(p.name.padEnd(nameW)) : p.name.padEnd(nameW);
    const f = flags(p).padEnd(20);
    const size = formatBytes(p.sizeBytes).padEnd(8);
    const mod = new Date(p.modifiedAt).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`${marker}${name}  ${f}  ${size}  ${c.gray(mod)}`);
  }
}

function printProfileDetail(p: ProfileInfo, isActive: boolean): void {
  console.log(`${c.bold('Name:')}      ${p.name}${isActive ? c.green(' (active)') : ''}`);
  console.log(`${c.bold('Path:')}      ${p.path}`);
  console.log(`${c.bold('Created:')}   ${p.createdAt}`);
  console.log(`${c.bold('Modified:')}  ${p.modifiedAt}`);
  console.log(`${c.bold('Size:')}      ${formatBytes(p.sizeBytes)}`);
  console.log(`${c.bold('Contents:')}`);
  console.log(`  ${p.hasConfig ? c.green('✓') : c.gray('○')} config.json`);
  console.log(`  ${p.hasModels ? c.green('✓') : c.gray('○')} custom_models.json`);
  console.log(`  ${p.hasChecks ? c.green('✓') : c.gray('○')} checks/`);
  console.log(`  ${p.hasHistory ? c.green('✓') : c.gray('○')} history/`);
}

export async function runProfile(ctx: CommandContext, sub: string | undefined, rest: string[]): Promise<number> {
  switch (sub) {
    case undefined:
    case 'list':
    case 'ls': {
      const profiles = listProfiles();
      const active = getActiveProfile();
      if (!ctx.json) header('ag-doctor — Profiles');
      if (ctx.json) {
        console.log(JSON.stringify({ active, profiles }, null, 2));
      } else {
        printProfileTable(profiles, active, ctx);
        if (active) console.log(`\n${c.green('*')} = active profile`);
        else console.log(`\n${c.gray('No active profile (using global config)')}`);
      }
      return 0;
    }

    case 'use':
    case 'switch': {
      const name = rest[0];
      if (!name) {
        error('Usage: ag-doctor profile use <name>   (use "default" to clear)');
        return 2;
      }
      if (name === 'default' || name === 'global') {
        setActiveProfile(null);
        ok('Switched to default (global) profile.');
        return 0;
      }
      try {
        validateProfileName(name);
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
      if (!profileExists(name)) {
        error(`Profile "${name}" does not exist. Create it first with \`ag-doctor profile create ${name}\``);
        return 2;
      }
      setActiveProfile(name);
      ok(`Switched to profile "${name}".`);
      info(`Data directory: ${getProfileDir(name)}`);
      return 0;
    }

    case 'create':
    case 'new': {
      const name = rest[0];
      if (!name) {
        error('Usage: ag-doctor profile create <name> [--clone]');
        return 2;
      }
      const clone = rest.includes('--clone') || rest.includes('-c');
      try {
        validateProfileName(name);
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
      try {
        const dir = createProfile(name, { fromActive: clone });
        ok(`Profile "${name}" created at ${dir}`);
        if (clone) info('Cloned config and models from active profile.');
        info(`Switch to it with: ag-doctor profile use ${name}`);
        return 0;
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
    }

    case 'delete':
    case 'rm': {
      const name = rest[0];
      if (!name) {
        error('Usage: ag-doctor profile delete <name> [--force]');
        return 2;
      }
      const force = rest.includes('--force') || rest.includes('-f');
      try {
        validateProfileName(name);
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
      try {
        const deleted = deleteProfile(name, { force });
        if (deleted) ok(`Profile "${name}" deleted.`);
        else { error(`Profile "${name}" does not exist.`); return 2; }
        return 0;
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
    }

    case 'show':
    case 'current': {
      const active = getActiveProfile();
      if (!active) {
        info('No active profile (using global config).');
        info(`Global config: ${path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.gemini', 'antigravity')}`);
        return 0;
      }
      const profiles = listProfiles();
      const p = profiles.find((x) => x.name === active);
      if (!p) {
        error(`Active profile "${active}" not found in profiles directory.`);
        return 2;
      }
      if (ctx.json) console.log(JSON.stringify(p, null, 2));
      else printProfileDetail(p, true);
      return 0;
    }

    case 'path': {
      const active = getActiveProfile();
      if (!active) {
        console.log('default');
      } else {
        console.log(getProfileDir(active));
      }
      return 0;
    }

    case 'copy':
    case 'cp': {
      const src = rest[0];
      const dst = rest[1];
      if (!src || !dst) {
        error('Usage: ag-doctor profile copy <src> <dst>');
        return 2;
      }
      try {
        const dir = copyProfile(src, dst);
        ok(`Profile "${src}" copied to "${dst}" at ${dir}`);
        return 0;
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
    }

    case 'rename':
    case 'mv': {
      const src = rest[0];
      const dst = rest[1];
      if (!src || !dst) {
        error('Usage: ag-doctor profile rename <old> <new>');
        return 2;
      }
      try {
        validateProfileName(dst);
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
      if (!profileExists(src)) {
        error(`Source profile "${src}" does not exist.`);
        return 2;
      }
      try {
        copyProfile(src, dst);
        const wasActive = getActiveProfile() === src;
        deleteProfile(src, { force: true });
        if (wasActive) setActiveProfile(dst);
        ok(`Profile "${src}" renamed to "${dst}".`);
        return 0;
      } catch (e) {
        error((e as Error).message);
        return 2;
      }
    }

    default:
      console.error(`Unknown profile subcommand: ${sub}`);
      console.error('Usage: ag-doctor profile {list|use|create|delete|show|path|copy|rename}');
      return 2;
  }
}
