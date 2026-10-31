/**
 * `ag-doctor models remove <name>` — delete a model.
 */
import type { CommandContext } from '../../types';
import { loadCustomModels, removeCustomModel } from '../../core/custom-models';
import { snapshotBefore } from '../../core/snapshot';
import { ok, error, warn, info } from '../../cli/output';
import { confirm } from '../../cli/prompts';

export async function runModelsRemove(ctx: CommandContext, name: string): Promise<number> {
  if (!name) {
    error('Usage: ag-doctor models remove <name>');
    return 2;
  }
  const file = loadCustomModels();
  if (!file.models.some((m) => m.name === name)) {
    warn(`Model "${name}" not found`);
    return 1;
  }
  if (!ctx.yes) {
    const ok2 = await confirm(`Delete "${name}"?`, false);
    if (!ok2) {
      info('Aborted');
      return 1;
    }
  }
  const snap = snapshotBefore(`models remove ${name}`);
  if (snap) info(`Snapshot ${snap.id} created`);
  removeCustomModel(name);
  ok(`Removed ${name}`);
  return 0;
}
