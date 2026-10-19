/**
 * `ag-doctor device` — manage and reset Antigravity IDE device telemetry identifiers.
 * Inspired by Antigravity-Manager's device module.
 *
 * Subcommands:
 *   show                   Display current machineId, macMachineId, devDeviceId, sqmId
 *   reset [--dry-run]      Regenerate device telemetry identifiers with automatic backup
 */
import type { CommandContext } from '../types';
import { ok, info, warn, error, header, c } from '../cli/output';
import {
  findStorageJsonPaths,
  readDeviceProfile,
  resetDeviceProfiles,
  DeviceProfile,
} from '../core/device';

export async function runDevice(ctx: CommandContext): Promise<number> {
  const sub = ctx.args.command[1] || 'show';

  if (sub === 'show') {
    return runDeviceShow(ctx);
  }

  if (sub === 'reset') {
    return runDeviceReset(ctx);
  }

  error(`Unknown device subcommand: ${sub}`);
  info(`Usage: ag-doctor device {show|reset} [--dry-run]`);
  return 1;
}

function runDeviceShow(ctx: CommandContext): number {
  const paths = findStorageJsonPaths();

  if (paths.length === 0) {
    if (ctx.json) {
      console.log(JSON.stringify({ error: 'No storage.json found' }));
    } else {
      warn('No Antigravity storage.json found on this system.');
    }
    return 1;
  }

  const profiles: { path: string; profile: DeviceProfile | null }[] = [];
  for (const p of paths) {
    profiles.push({ path: p, profile: readDeviceProfile(p) });
  }

  if (ctx.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return 0;
  }

  header('Antigravity Device Profile (Telemetry Identifiers)');

  for (const item of profiles) {
    console.log(`\n${c.bold('Location:')} ${c.cyan(item.path)}`);
    if (!item.profile) {
      console.log(`  ${c.yellow('Could not read device profile.')}`);
      continue;
    }
    const prof = item.profile;
    console.log(`  ${c.bold('machineId:')}         ${prof.machineId || c.dim('(none)')}`);
    console.log(`  ${c.bold('macMachineId:')}      ${prof.macMachineId || c.dim('(none)')}`);
    console.log(`  ${c.bold('devDeviceId:')}       ${prof.devDeviceId || c.dim('(none)')}`);
    console.log(`  ${c.bold('sqmId:')}             ${prof.sqmId || c.dim('(none)')}`);
    if (prof.serviceMachineId) {
      console.log(`  ${c.bold('serviceMachineId:')}  ${prof.serviceMachineId}`);
    }
  }

  return 0;
}

function runDeviceReset(ctx: CommandContext): number {
  const dryRun = Boolean(ctx.args.options['dry-run']);
  const paths = findStorageJsonPaths();

  if (paths.length === 0) {
    if (ctx.json) {
      console.log(JSON.stringify({ error: 'No storage.json found' }));
    } else {
      warn('No Antigravity storage.json found on this system.');
    }
    return 1;
  }

  const results = resetDeviceProfiles(dryRun);

  if (ctx.json) {
    console.log(JSON.stringify({ dryRun, results }, null, 2));
    return 0;
  }

  header(dryRun ? 'Device Reset (Dry Run)' : 'Device Reset');

  for (const res of results) {
    console.log(`\n${c.bold('Target:')} ${c.cyan(res.path)}`);
    if (res.backupPath) {
      console.log(`  ${c.green('Backup:')} ${res.backupPath}`);
    }
    console.log(`  ${c.bold('New machineId:')}    ${res.newProfile.machineId}`);
    console.log(`  ${c.bold('New macMachineId:')} ${res.newProfile.macMachineId}`);
    console.log(`  ${c.bold('New devDeviceId:')}  ${res.newProfile.devDeviceId}`);
    console.log(`  ${c.bold('New sqmId:')}        ${res.newProfile.sqmId}`);
  }

  if (!dryRun) {
    ok(`Device telemetry identifiers successfully reset across ${results.length} configuration file(s).`);
    info('Please restart Antigravity IDE for the new hardware/telemetry identity to take effect.');
  } else {
    info('Dry run complete. No files were modified.');
  }

  return 0;
}
