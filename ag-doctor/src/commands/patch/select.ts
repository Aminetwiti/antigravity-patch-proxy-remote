/**
 * `ag-doctor patch select` — set or clear a manual patch range override.
 */
import type { CommandContext } from '../../types';
import {
  KNOWN_PATCH_RANGES,
  setPatchVersionOverride,
  getPatchVersionOverride,
  isKnownPatchRange,
} from '../../core/config';
import { error, info, ok, warn } from '../../cli/output';

const USAGE = `ag-doctor patch select <range|auto>\n\nKnown ranges:\n  - ${KNOWN_PATCH_RANGES.join('\n  - ')}`;

export async function runPatchSelect(ctx: CommandContext, value: string | undefined): Promise<number> {
  if (!value || value === '--help' || value === '-h' || value === 'help') {
    console.log(USAGE);
    return value ? 0 : 2;
  }

  if (value === 'auto') {
    const cfg = setPatchVersionOverride(null);
    if (ctx.json) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'auto',
        override: getPatchVersionOverride(),
        config: cfg,
      }, null, 2));
    } else {
      ok('Patch range override cleared. Auto-detection is active.');
    }
    return 0;
  }

  try {
    if (!isKnownPatchRange(value)) {
      throw new Error(`Unknown patch range "${value}". Known: ${KNOWN_PATCH_RANGES.join(', ')}`);
    }
    const cfg = setPatchVersionOverride(value, 'set from patch selector');
    const override = getPatchVersionOverride();
    if (ctx.json) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'override',
        override,
        config: cfg,
      }, null, 2));
    } else {
      ok(`Patch range override set to ${override.range}`);
      if (override.reason) info(`Reason: ${override.reason}`);
    }
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    if (ctx.json) {
      console.log(JSON.stringify({ ok: false, error: msg, knownRanges: KNOWN_PATCH_RANGES }, null, 2));
    } else {
      error(msg);
      warn(`Known ranges: ${KNOWN_PATCH_RANGES.join(', ')}`);
    }
    return 2;
  }
}
