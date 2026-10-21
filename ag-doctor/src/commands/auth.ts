/**
 * `ag-doctor auth <subcommand>` — manage Antigravity authentication & resolve eligibility/403 errors.
 *
 * Subcommands:
 *   status           Inspect OS credentials and check logs for 403 / eligibility issues
 *   fix [--yes]      Auto-repair: kill stuck processes, purge stale OS credentials, open Google age verification
 *   purge [--yes]    Purge Antigravity credentials from OS Credential Manager only
 */
import type { CommandContext } from '../types';
import { ok, info, warn, error, header, c } from '../cli/output';
import { confirm } from '../cli/prompts';
import {
  diagnoseAuthState,
  killAllAuthProcesses,
  launchAgyTerminal,
  GOOGLE_AGE_VERIFICATION_URL,
  GOOGLE_CONNECTIONS_URL,
} from '../core/auth';
import { purgeAntigravityCredentials } from '../core/credentials';
import { openInBrowser } from '../core/browser';

export async function runAuth(ctx: CommandContext, sub?: string, rest: string[] = []): Promise<number> {
  const targetSub = sub || 'status';

  switch (targetSub) {
    case 'status':
      return await runAuthStatus(ctx);
    case 'fix':
    case 'repair':
      return await runAuthFix(ctx);
    case 'purge':
    case 'clean':
      return await runAuthPurge(ctx);
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      return 0;
    default:
      error(`Unknown auth subcommand: ${targetSub}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`
${c.bold('ag-doctor auth')} — Antigravity authentication & eligibility management

${c.cyan('Subcommands:')}
  ${c.green('status')}         Inspect credential store and recent 403 eligibility errors
  ${c.green('fix')}            Full fix: kill processes, purge stale tokens, open Google age check
  ${c.green('purge')}          Purge Antigravity entries from OS Credential Manager only

${c.cyan('Options:')}
  --json             Machine-readable JSON output
  --yes, -y          Skip interactive confirmation prompts
`);
}

async function runAuthStatus(ctx: CommandContext): Promise<number> {
  const diag = await diagnoseAuthState();

  if (ctx.json) {
    console.log(JSON.stringify(diag, null, 2));
    return diag.hasEligibilityError ? 1 : 0;
  }

  header('Antigravity Authentication & Eligibility Status');

  console.log(`\n${c.bold('Credential Store:')}`);
  if (diag.credentialsFound.length === 0) {
    info('  No Antigravity credentials found in OS Credential Manager.');
  } else {
    for (const cred of diag.credentialsFound) {
      ok(`  Stored credential target: ${c.cyan(cred)}`);
    }
  }

  console.log(`\n${c.bold('Eligibility Check (Language Server Log):')}`);
  if (diag.hasEligibilityError) {
    warn('  403 / Account eligibility error detected in recent logs:');
    if (diag.lastErrorLine) {
      console.log(`  ${c.yellow(diag.lastErrorLine)}`);
    }
    console.log(`\n  ${c.bold('Resolution:')} Run ${c.cyan('ag-doctor auth fix')} to resolve this issue.`);
    return 1;
  } else {
    ok('  No 403 or VALIDATION_REQUIRED errors found in recent logs.');
    return 0;
  }
}

async function runAuthPurge(ctx: CommandContext): Promise<number> {
  if (!ctx.yes) {
    const proceed = await confirm('Purge Antigravity credentials from OS Credential Manager?');
    if (!proceed) {
      info('Operation cancelled.');
      return 0;
    }
  }

  info('Purging Antigravity credentials from OS Credential Store...');
  const res = await purgeAntigravityCredentials();

  if (ctx.json) {
    console.log(JSON.stringify(res, null, 2));
    return res.errors.length > 0 ? 1 : 0;
  }

  if (res.purged.length > 0) {
    ok(`Purged entries: ${res.purged.join(', ')}`);
  } else {
    info('No existing credentials needed removal.');
  }

  if (res.errors.length > 0) {
    warn(`Warnings: ${res.errors.join('; ')}`);
  }

  return 0;
}

async function runAuthFix(ctx: CommandContext): Promise<number> {
  if (!ctx.json) {
    header('Antigravity Auth & Eligibility Fix');
    console.log(`This tool resolves ${c.bold('403 Forbidden / VALIDATION_REQUIRED')} errors:`);
    console.log(`  1. Revoke existing Antigravity links at ${c.cyan(GOOGLE_CONNECTIONS_URL)}`);
    console.log(`  2. Complete Google Age & Identity Verification at ${c.cyan(GOOGLE_AGE_VERIFICATION_URL)}`);
    console.log(`  3. Terminate stuck processes and purge stale OS credentials`);
    console.log(`  4. Re-authenticate natively via PC Antigravity 2.0 / agy (bypasses mobile QR limits)\n`);
  }

  if (!ctx.yes) {
    const proceed = await confirm('Proceed with account fix?');
    if (!proceed) {
      info('Operation cancelled.');
      return 0;
    }
  }

  // 1. Terminate processes
  info('Terminating running Antigravity / agy / language_server processes...');
  const killed = await killAllAuthProcesses();
  if (killed.length > 0 && !ctx.json) {
    ok(`Terminated: ${killed.join(', ')}`);
  }

  // 2. Purge stale credentials
  info('Purging stale tokens from OS Credential Store...');
  const purgeRes = await purgeAntigravityCredentials();
  if (purgeRes.purged.length > 0 && !ctx.json) {
    ok(`Purged credentials: ${purgeRes.purged.join(', ')}`);
  }

  // 3. Open Age verification and Connections in browser
  info('Opening Google Verification pages in default browser...');
  await openInBrowser(GOOGLE_CONNECTIONS_URL);
  const opened = await openInBrowser(GOOGLE_AGE_VERIFICATION_URL);
  if (!opened && !ctx.json) {
    warn(`Could not launch browser automatically. Please open:`);
    warn(`  1. ${c.cyan(GOOGLE_CONNECTIONS_URL)} (remove Antigravity app access)`);
    warn(`  2. ${c.cyan(GOOGLE_AGE_VERIFICATION_URL)} (verify age/identity)`);
  }

  if (ctx.json) {
    console.log(JSON.stringify({
      status: 'ok',
      killedProcesses: killed,
      purgedCredentials: purgeRes.purged,
      ageVerificationUrl: GOOGLE_AGE_VERIFICATION_URL,
      connectionsUrl: GOOGLE_CONNECTIONS_URL,
    }, null, 2));
    return 0;
  }

  console.log(`\n${c.bold(c.yellow('--- 4-STEP PROTOCOL INSTRUCTIONS ---'))}`);
  console.log(`1. On ${c.cyan(GOOGLE_CONNECTIONS_URL)}: delete any old Antigravity links to clear session conflicts.`);
  console.log(`2. On ${c.cyan(GOOGLE_AGE_VERIFICATION_URL)}: complete the age check (e.g. selfie or card).`);
  console.log(`3. Re-authenticate natively on PC via Antigravity 2.0 or ${c.cyan('agy')} (select Option 1).`);
  console.log(`   ${c.bold('Important:')} Do NOT scan QR codes with a phone showing "too many requests" — use native PC auth!`);
  console.log(`4. Once authenticated, refresh the patch proxy. Quotas will restore to 100% 🟢.\n`);

  if (!ctx.yes) {
    const launchNow = await confirm('Launch Antigravity CLI (agy) now in a new terminal window?');
    if (launchNow) {
      const launched = launchAgyTerminal();
      if (launched) {
        ok('Launched agy in a new terminal.');
      } else {
        info(`Could not open a new terminal automatically. Run ${c.cyan('agy')} manually.`);
      }
    }
  } else {
    launchAgyTerminal();
  }

  ok('Auth fix procedure completed.');
  return 0;
}
