/**
 * `ag-doctor models test [name]` — connectivity test for one or all models.
 */
import type { CommandContext } from '../../types';
import { loadCustomModels } from '../../core/custom-models';
import { probe } from '../../core/probe';
import { c, header, ok, warn, error, info } from '../../cli/output';
import { Spinner } from '../../cli/spinner';

export async function runModelsTest(ctx: CommandContext, name?: string): Promise<number> {
  if (!ctx.json) header('Test model connectivity');
  const file = loadCustomModels(undefined, { includeDisabled: true });
  let targets = file.models;
  if (name) {
    targets = targets.filter((m) => m.name === name);
    if (targets.length === 0) {
      error(`Model "${name}" not found`);
      return 2;
    }
  } else {
    targets = targets.filter((m) => m.enabled !== false);
  }
  if (targets.length === 0) {
    info('No models to test');
    return 0;
  }

  const results: Array<{ name: string; ok: boolean; latencyMs?: number; error?: string; statusCode?: number }> = [];

  for (const m of targets) {
    const sp = new Spinner(`Testing ${m.name}`);
    sp.start();
    const r = await probe(m.apiUrl, 10000, { provider: m.provider, apiKey: m.apiKey });
    if (r.ok) {
      sp.succeed(`${m.name} — ${r.statusCode} (${r.latencyMs}ms)`);
    } else {
      sp.fail(`${m.name} — ${r.error ?? 'unknown'}`);
    }
    results.push({ name: m.name, ...r });
  }

  if (ctx.json) {
    console.log(JSON.stringify(results, null, 2));
  }

  const failed = results.filter((r) => !r.ok).length;
  return failed > 0 ? 1 : 0;
}
