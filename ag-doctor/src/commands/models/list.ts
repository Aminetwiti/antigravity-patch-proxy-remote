/**
 * `ag-doctor models list` — list configured custom models.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../../types';
import { loadCustomModels, looksEncrypted } from '../../core/custom-models';
import { getCustomModelsPath, getAntigravityDataDir } from '../../core/paths';
import { c, header, ok, info } from '../../cli/output';

function maskKey(k?: string): string {
  if (!k || k === 'none') return '(none)';
  if (k.startsWith('gcm:v1:') || k.startsWith('base64:')) return '[encrypted]';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}...${k.slice(-4)}`;
}

export function runModelsList(ctx: CommandContext): number {
  if (!ctx.json) header('Custom models');
  const file = loadCustomModels(undefined, { includeDisabled: !!ctx.json });
  const encrypted = looksEncrypted();

  if (ctx.json) {
    console.log(JSON.stringify({ path: getCustomModelsPath(), encrypted, models: file.models }, null, 2));
    return 0;
  }

  info(`File: ${getCustomModelsPath()}`);
  info(`Encryption: ${encrypted ? c.green('yes') : c.yellow('no')}`);
  console.log('');

  if (file.models.length === 0) {
    info('No models configured. Run `ag-doctor models add` to create one.');
    return 0;
  }

  const rows: Array<[string, string]> = [];
  for (const m of file.models) {
    rows.push([c.bold(m.name), `${m.provider} → ${m.apiUrl}`]);
    rows.push(['', `${c.gray('external:')} ${m.externalModelName}  ${c.gray('key:')} ${maskKey(m.apiKey)}`]);
  }
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(40)} ${v}`);
  }
  console.log('');

  const quotaCachePath = path.join(getAntigravityDataDir(), 'quota_cache.json');
  if (fs.existsSync(quotaCachePath)) {
    try {
      const qData = JSON.parse(fs.readFileSync(quotaCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const now = Date.now();
      const activeCds = Object.entries(cds).filter(([_, until]) => typeof until === 'number' && (until as number) > now);
      if (activeCds.length > 0) {
        info(`Cooldowns: ${c.yellow(String(activeCds.length))} account cooldown(s) active:`);
        for (const [k, until] of activeCds) {
          const remH = Math.round(((until as number) - now) / 3600000);
          console.log(`  ${c.gray('•')} ${k.padEnd(45)} ${c.yellow(`${remH}h remaining`)}`);
        }
        console.log('');
      } else {
        info(`Cooldowns: ${c.green('All accounts healthy (0 in cooldown)')}`);
        console.log('');
      }
    } catch (_) {}
  }

  ok(`${file.models.length} model(s)`);
  return 0;
}
