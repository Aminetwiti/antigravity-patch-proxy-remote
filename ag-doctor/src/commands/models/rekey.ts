/**
 * `ag-doctor models rekey` — re-enter API keys for models whose keys are
 * encrypted in the language server's own format ("v10"), which the local
 * proxy cannot decrypt.
 *
 * Two input modes:
 *   - interactive: for each affected model, the API key is asked with masked
 *     input (empty answer skips the model).
 *   - --keys-file <path>: JSON file mapping model names to plaintext keys,
 *     e.g. { "models/kimchi/minimax-m3": "sk-..." }.
 *
 * Keys are stored in the proxy-compatible "fallback:" format so the
 * standalone proxy can decrypt them without Electron safeStorage. A snapshot
 * is taken before writing.
 */
import fs from 'fs';
import readline from 'readline';
import type { CommandContext } from '../../types';
import {
  loadCustomModels,
  addCustomModel,
  isLsEncryptedKey,
  toFallbackKey,
} from '../../core/custom-models';
import { snapshotBefore } from '../../core/snapshot';
import { confirm } from '../../cli/prompts';
import { ok, error, info, warn, header } from '../../cli/output';

export async function runModelsRekey(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('Rekey models');

  const file = loadCustomModels();
  const targets = file.models.filter((m) => isLsEncryptedKey(m.apiKey));

  if (targets.length === 0) {
    if (!ctx.json) ok('No language-server-encrypted keys found — nothing to rekey');
    return 0;
  }

  // Batch mode: read keys from a JSON file { "<model name>": "<api key>" }.
  const keysFile = (ctx.options?.keysFile as string | undefined) ?? (ctx.options?.['keys-file'] as string | undefined);
  const batchKeys: Record<string, string> = {};
  if (keysFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keysFile, 'utf-8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.length > 0) batchKeys[k] = v;
      }
      if (!ctx.json) info(`Loaded ${Object.keys(batchKeys).length} key(s) from ${keysFile}`);
    } catch (e) {
      error(`Failed to read keys file: ${(e as Error).message}`);
      return 2;
    }
    // Entries that match no affected model are almost certainly typos — the
    // user would otherwise believe a key was applied when it was not.
    const targetNames = new Set(targets.map((m) => m.name));
    const unmatched = Object.keys(batchKeys).filter((k) => !targetNames.has(k));
    if (unmatched.length > 0) {
      warn(`Keys file contains ${unmatched.length} name(s) matching no affected model: ${unmatched.join(', ')}`);
    }
  }

  if (!ctx.json && Object.keys(batchKeys).length === 0) {
    info(`${targets.length} model(s) have keys encrypted by the language server (v10 format).`);
    info('The local proxy cannot decrypt these — please re-enter each API key.');
    info('Press Enter with an empty value to skip a model.');
    console.log('');
  }

  if (!ctx.yes) {
    const ok2 = await confirm(`Re-key ${targets.length} model(s)?`, false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }

  const snap = snapshotBefore('models rekey');
  if (snap) info(`Snapshot ${snap.id} created`);

  // One shared reader for the whole session so piped input works.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const askKey = (modelName: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(`API key for ${modelName}: `, (answer) => resolve(answer.trim()));
    });

  let updated = 0;
  let skipped = 0;
  for (const m of targets) {
    let key = batchKeys[m.name] ?? '';
    if (!key && Object.keys(batchKeys).length === 0) {
      key = await askKey(m.name);
    }
    if (!key) {
      if (!ctx.json) info(`  skipped ${m.name}`);
      skipped++;
      continue;
    }
    addCustomModel({
      ...m,
      apiKey: toFallbackKey(key),
      encrypted: true,
    });
    updated++;
    if (!ctx.json) ok(`  updated ${m.name}`);
  }
  rl.close();

  if (!ctx.json) {
    console.log('');
    ok(`Rekey complete: ${updated} updated, ${skipped} skipped`);
    if (updated > 0) {
      info('The keys are stored in proxy-compatible format (fallback:). Restart the proxy:');
      info('  ag-doctor proxy restart');
    }
    if (skipped > 0) {
      warn(`${skipped} model(s) still have language-server-encrypted keys`);
    }
  }
  return skipped > 0 ? 1 : 0;
}
