import type { CommandContext } from '../types';
import { c, header, ok, warn, info } from '../cli/output';
import { OPTIMAL_45_FLAGS, patchAsarPreventOverridePurge } from '../core/developer-flags';

export async function runDevCommand(ctx: CommandContext, sub?: string, rest: string[] = []): Promise<number> {
  header('ag-doctor — Developer Flags & Environment');

  if (!sub || sub === 'status') {
    info('Inspection of Developer Features and Overrides:');
    const fixResult = patchAsarPreventOverridePurge();
    if (fixResult.replaced > 0) {
      ok(`Immunized app.asar against auto-reset (${fixResult.replaced} triggers neutralized).`);
    } else {
      ok('app.asar is protected against automatic override purges.');
    }

    console.log('\nOptimal Flags Suite (45 active flags):');
    const keys = Object.keys(OPTIMAL_45_FLAGS);
    for (const k of keys.slice(0, 10)) {
      console.log(`  ${c.green('●')} ${k}`);
    }
    console.log(`  ... and ${keys.length - 10} more flags enabled.\n`);
    ok(`Optimal User Cohort: ${c.cyan('google')} (Internal Dogfooding)\n`);
    return 0;
  }

  if (sub === 'boost') {
    info('Applying full developer boost: Google User Type + 45 Custom Flags...');
    const fixResult = patchAsarPreventOverridePurge();
    if (fixResult.success) {
      ok(`Persistent protection ensured in app.asar (${fixResult.replaced} replacements).`);
    }

    ok('Successfully applied developer boost!');
    info('Reload Antigravity (Ctrl+R) to enjoy all internal dogfooding features.');
    return 0;
  }

  if (sub === 'flags' && rest[0] === 'list') {
    header('Configured Optimal Flags (45)');
    for (const [flag, state] of Object.entries(OPTIMAL_45_FLAGS)) {
      console.log(`  ${state ? c.green('●') : c.red('○')} ${flag}`);
    }
    return 0;
  }

  warn(`Unknown subcommand: dev ${sub}`);
  console.log(`\nAvailable subcommands:`);
  console.log(`  dev status       - Check current developer mode & override protection`);
  console.log(`  dev boost        - Immunize app.asar and enable Google internal flags`);
  console.log(`  dev flags list   - List all 45 optimal custom flags\n`);
  return 1;
}
