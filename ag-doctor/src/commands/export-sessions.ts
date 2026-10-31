/**
 * `ag-doctor sessions:export` — export conversation trajectories to Markdown or JSON.
 * Protects users from data loss caused by Cloud Code / AI Studio suspensions.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import { getAntigravityDataDir } from '../core/paths';
import { c, ok, error, info, header } from '../cli/output';

export interface ExportOptions {
  convId?: string;
  all?: boolean;
  limit?: number;
  destDir?: string;
  asJson?: boolean;
}

export function exportSessions(options: ExportOptions = {}): {
  exportedCount: number;
  outputDir: string;
  exportedFiles: string[];
} {
  const dataDir = getAntigravityDataDir();
  const dbPath = path.join(dataDir, 'conversation_summaries.db');
  const brainDir = path.join(dataDir, 'brain');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);

  const dest = options.destDir || path.join(dataDir, 'exports');
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  let query = 'SELECT conversation_id, title, preview, step_count, last_modified_time FROM conversation_summaries';
  const params: any[] = [];
  if (options.convId) {
    query += ' WHERE conversation_id = ?';
    params.push(options.convId);
  } else {
    query += ' ORDER BY last_modified_time DESC';
    if (options.limit && options.limit > 0) {
      query += ` LIMIT ${Number(options.limit)}`;
    } else if (!options.all) {
      query += ' LIMIT 20';
    }
  }

  const rows = db.prepare(query).all(...params) as Array<{
    conversation_id: string;
    title: string;
    preview: string;
    step_count: number;
    last_modified_time: string;
  }>;

  const exportedFiles: string[] = [];

  for (const row of rows) {
    const id = row.conversation_id;
    const safeTitle = (row.title || id).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
    const transcriptPath = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');

    if (!fs.existsSync(transcriptPath)) {
      continue;
    }

    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    const messages: Array<{ role: string; content: string; time?: string }> = [];

    for (const line of lines) {
      try {
        const step = JSON.parse(line);
        if (step.type === 'USER_INPUT' && step.content) {
          messages.push({ role: 'User', content: step.content, time: step.created_at });
        } else if (step.type === 'PLANNER_RESPONSE' && step.content) {
          messages.push({ role: 'Assistant', content: step.content, time: step.created_at });
        }
      } catch (_) {}
    }

    if (options.asJson) {
      const outJson = path.join(dest, `${safeTitle}_${id.slice(0, 8)}.json`);
      fs.writeFileSync(outJson, JSON.stringify({ meta: row, messages }, null, 2), 'utf8');
      exportedFiles.push(outJson);
    } else {
      const outMd = path.join(dest, `${safeTitle}_${id.slice(0, 8)}.md`);
      let md = `# ${row.title || 'Conversation'}\n\n`;
      md += `* **ID** : \`${id}\`\n`;
      md += `* **Dernière modification** : ${row.last_modified_time}\n`;
      md += `* **Nombre d'étapes** : ${row.step_count}\n\n---\n\n`;

      for (const msg of messages) {
        md += `### ${msg.role}${msg.time ? ` (${msg.time})` : ''}\n\n${msg.content}\n\n---\n\n`;
      }

      fs.writeFileSync(outMd, md, 'utf8');
      exportedFiles.push(outMd);
    }
  }

  return {
    exportedCount: exportedFiles.length,
    outputDir: dest,
    exportedFiles,
  };
}

export async function runExportSessions(
  ctx: CommandContext,
  sub?: string,
  rest: string[] = []
): Promise<number> {
  const asJson = rest.includes('--json') || ctx.options.json === true;
  const isAll = rest.includes('--all') || sub === '--all';
  const destIndex = rest.indexOf('--dest');
  const destDir = destIndex >= 0 ? rest[destIndex + 1] : undefined;
  const convId = sub && !sub.startsWith('--') ? sub : undefined;

  try {
    if (!ctx.json) header('Export de sessions Antigravity');
    const res = exportSessions({
      convId,
      all: isAll,
      destDir,
      asJson,
    });

    if (ctx.json) {
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }

    if (res.exportedCount === 0) {
      info('Aucune session avec transcript disponible pour l\'export.');
      return 0;
    }

    ok(`Export réussi de ${c.bold(String(res.exportedCount))} session(s) !`);
    console.log(`  Dossier de destination : ${c.cyan(res.outputDir)}`);
    for (const f of res.exportedFiles.slice(0, 5)) {
      console.log(`  - ${path.basename(f)}`);
    }
    if (res.exportedFiles.length > 5) {
      console.log(`  ... et ${res.exportedFiles.length - 5} autres fichiers.`);
    }
    return 0;
  } catch (e) {
    error(`Échec de l'export de sessions: ${(e as Error).message}`);
    if (ctx.verbose) console.error((e as Error).stack);
    return 2;
  }
}
