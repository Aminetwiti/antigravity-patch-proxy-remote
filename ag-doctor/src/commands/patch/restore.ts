/**
 * `ag-doctor patch restore` — undo the patch.
 *
 * Restores the classic language_server binary from its .bak backup and
 * removes the Antigravity IDE cloud endpoint override (jetski.cloudCodeUrl).
 */
import type { CommandContext } from '../../types';
import { restorePatch, getPatchStatus } from '../../core/binary-patch';
import { restoreIdePatch, getIdePatchStatus } from '../../core/ide-patch';
import { killAntigravityProcesses } from '../../core/process';
import { snapshotBefore } from '../../core/snapshot';
import { confirm } from '../../cli/prompts';
import { ok, error, warn, info } from '../../cli/output';

export async function runPatchRestore(ctx: CommandContext): Promise<number> {
  info('Restoring original binary and settings...');
  // Safety: kill Antigravity processes first to release Windows file locks
  const procs = await killAntigravityProcesses();
  if (procs.killed > 0) {
    info(`Killed ${procs.killed} Antigravity process(es) to release file lock`);
  }

  if (!ctx.yes) {
    const ok2 = await confirm('Restore language_server from backup and remove the IDE endpoint override? This will undo the patch.', false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const snap = snapshotBefore('patch restore');
  if (snap) info(`Snapshot ${snap.id} created`);

  let hadAction = false;

  const r = restorePatch();
  if (!r.ok) {
    info(`Classic binary restore: ${r.message} (skipped)`);
  } else {
    hadAction = true;
    ok(r.message);
  }
  // Verify the classic binary is genuinely unpatched now — a swallowed failure
  // (e.g. missing .bak) must not leave the user believing the patch was undone.
  if (getPatchStatus().applied) {
    error('Classic binary is still patched — restore did not complete. Check that the .bak backup exists (ag-doctor patch status).');
    return 2;
  }

  const ide = getIdePatchStatus();
  if (ide.installDir) {
    const ri = restoreIdePatch();
    if (!ri.ok) {
      info(`IDE restore: ${ri.message} (skipped)`);
    } else {
      hadAction = true;
      ok(ri.message);
    }
  }
  // Same verification for the IDE override.
  const ideAfter = getIdePatchStatus();
  if (ideAfter.applied || ideAfter.hasCustomValue) {
    error('IDE cloud endpoint override is still present — restore did not complete.');
    return 2;
  }

  if (!hadAction) {
    warn('Nothing to restore');
  }
  return 0;
}
