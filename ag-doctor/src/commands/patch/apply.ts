/**
 * `ag-doctor patch apply` — apply the patch.
 *
 * Applies the classic binary patch (language_server URL redirect) and, when
 * the Antigravity IDE (v1.107.0+) is installed, the IDE cloud endpoint
 * override (jetski.cloudCodeUrl → local proxy).
 */
import type { CommandContext } from '../../types';
import { applyPatch, getPatchStatus } from '../../core/binary-patch';
import { applyIdePatch, getIdePatchStatus } from '../../core/ide-patch';
import { killAntigravityProcesses } from '../../core/process';
import { snapshotBefore } from '../../core/snapshot';
import { confirm } from '../../cli/prompts';
import { ok, error, warn, info } from '../../cli/output';

export async function runPatchApply(ctx: CommandContext): Promise<number> {
  info('Applying patch...');
  // Safety: kill Antigravity first so we don't patch a running binary
  const procs = await killAntigravityProcesses();
  if (procs.killed > 0) {
    info(`Killed ${procs.killed} Antigravity process(es)`);
  }
  if (!ctx.yes) {
    const ok2 = await confirm('Apply patch to language_server binary and/or IDE settings?', false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  // Snapshot before mutating anything
  const snap = snapshotBefore('patch apply');
  if (snap) info(`Snapshot ${snap.id} created`);

  let hadAction = false;

  // 1. Classic binary patch (only when the classic install exists)
  const patchStatus = getPatchStatus();
  if (!patchStatus.binaryPath || !patchStatus.exists) {
    info('Classic install not found — skipping binary patch');
  } else if (patchStatus.applied) {
    info('Classic binary patch: already applied');
  } else {
    const r = applyPatch();
    if (!r.ok) {
      error(r.message);
      return 2;
    }
    hadAction = true;
    ok(r.message);
  }

  // 2. IDE (v1.107.0+) settings override
  const ide = getIdePatchStatus();
  if (ide.installDir) {
    const ri = applyIdePatch();
    if (!ri.ok) {
      error(ri.message);
      return 2;
    }
    hadAction = true;
    ok(ri.message);
  }

  if (!hadAction) {
    warn('Nothing to apply — no classic install and no Antigravity IDE found');
  }
  return 0;
}
