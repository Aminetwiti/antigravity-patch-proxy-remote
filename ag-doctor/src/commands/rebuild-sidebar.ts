/**
 * `ag-doctor db:rebuild-sidebar` / `ag-doctor rebuild-sidebar`
 * Rebuilds the VS Code conversation index (state.vscdb trajectorySummaries)
 * to restore missing conversations, fix titles, and sort history by date.
 */
import type { CommandContext } from '../types';
import { rebuildSidebar } from '../core/sidebar-rebuilder';
import { findAntigravityProcesses } from '../core/process';
import { c, ok, error, warn, info } from '../cli/output';

export async function runRebuildSidebar(ctx: CommandContext, sub?: string, rest: string[] = []): Promise<number> {
  const isDryRun = sub === '--dry-run' || rest.includes('--dry-run') || ctx.options['dry-run'] === true;

  try {
    // 1. Process safety check
    const procs = await findAntigravityProcesses();
    if (procs.length > 0 && !isDryRun) {
      warn('Antigravity is currently running.');
      console.log('  Please close Antigravity completely before rebuilding the sidebar index,');
      console.log('  otherwise Antigravity may overwrite the database when exiting.\n');
      if (!ctx.yes) {
        error('Aborted to prevent database corruption. Close Antigravity and try again.');
        return 1;
      }
    }

    const res = await rebuildSidebar({ dryRun: isDryRun });

    if (ctx.json) {
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }

    if (res.dryRun) {
      info('Dry-run sidebar conversation index analysis:');
      console.log(`  Total conversations found : ${c.bold(String(res.totalConversations))}`);
      console.log(`  Titles preserved from DB  : ${c.cyan(String(res.titlesPreserved))}`);
      console.log(`  Titles extracted from brain: ${c.green(String(res.titlesFromBrain))}`);
      console.log(`  Titles derived from prompt: ${c.green(String(res.titlesFromPrompt))}`);
      console.log(`  Fallback titles generated : ${c.yellow(String(res.titlesFallback))}`);
      console.log(`  Workspaces mapped         : ${c.bold(String(res.workspacesMapped))}`);
      console.log(`\nRun ${c.cyan('ag-doctor db:rebuild-sidebar')} without --dry-run to write the index.`);
      return 0;
    }

    ok(`Sidebar rebuilt successfully across ${c.bold(String(res.databasesUpdated))} database(s)!`);
    console.log(`  Total conversations indexed : ${c.bold(String(res.totalConversations))}`);
    console.log(`  Titles preserved            : ${c.cyan(String(res.titlesPreserved))}`);
    console.log(`  Titles from brain/prompts   : ${c.green(String(res.titlesFromBrain + res.titlesFromPrompt))}`);
    console.log(`  Fallback titles             : ${c.yellow(String(res.titlesFallback))}`);
    console.log(`  Workspaces retained/mapped  : ${c.bold(String(res.workspacesMapped))}`);

    if (res.backupsCreated.length > 0) {
      info('Safety backup(s) saved:');
      for (const b of res.backupsCreated) {
        console.log(`  ${c.dim(b)}`);
      }
    }

    info('Open Antigravity to see your restored and sorted conversation history.');
    return 0;
  } catch (e) {
    error(`Failed to rebuild sidebar: ${(e as Error).message}`);
    if (ctx.verbose) console.error((e as Error).stack);
    return 2;
  }
}
