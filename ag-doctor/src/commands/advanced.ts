/**
 * `ag-doctor advanced` — rare edge-case diagnostics & remediation.
 *
 * Subcommands:
 *   report      Generate comprehensive advanced diagnostic report
 *   watchdog    Start memory/FD watchdog for the proxy
 *   lock-test   Test CA regeneration lock acquisition
 *   ns          Detect network namespace (WSL/Docker/Container)
 *   protocols   Detect protocol risks (ECH/QUIC/DoH)
 *   firewall    Add/remove Windows firewall rule
 *   verify      Verify backup integrity
 *   compat      Check Antigravity version compatibility
 *   watch       Watch binary for auto-update
 */
import type { CommandContext } from '../types';
import { header, ok, warn, error, info } from '../cli/output';
import {
  generateAdvancedReport,
  ProxyWatchdog,
  acquireCaLock,
  detectNetworkNamespace,
  detectProtocolRisks,
  addFirewallRule,
  removeFirewallRule,
  verifyBackupIntegrity,
  checkVersionCompatibility,
  watchBinaryForUpdates,
} from '../core/advanced';
import { getLanguageServerBinary, getLanguageServerBackup } from '../core/paths';
import { loadConfig } from '../core/config';
import { runStop, getProxyStatus } from './proxy';

const USAGE = `ag-doctor advanced — rare edge-case diagnostics

Subcommands:
  report      Generate comprehensive diagnostic report (JSON)
  watchdog    Start memory/FD watchdog (auto-restart on leak)
  ns          Detect WSL/Docker/Container network namespace
  protocols   Detect ECH/QUIC/DoH protocol risks
  firewall    Manage Windows firewall rule (add/remove)
  verify      Verify backup integrity (SHA-256)
  compat      Check Antigravity version compatibility
  watch       Watch binary for auto-update
  --help      Show this help
`;

export async function runAdvanced(ctx: CommandContext, sub: string | undefined): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help') {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case 'report': {
      if (!ctx.json) header('Advanced diagnostic report');
      const report = await generateAdvancedReport();
      if (ctx.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Timestamp: ${report.timestamp}`);
        console.log(`\n[Network Namespace]`);
        console.log(`  WSL:           ${report.networkNamespace.isWSL}`);
        console.log(`  Docker:        ${report.networkNamespace.isDocker}`);
        console.log(`  Container:     ${report.networkNamespace.isContainer}`);
        console.log(`  RemoteSession: ${report.networkNamespace.isRemoteSession}`);
        console.log(`  Hostname:      ${report.networkNamespace.hostname}`);
        console.log(`  LoopbackIPs:   ${report.networkNamespace.loopbackIPs.join(', ') || '—'}`);
        if (report.networkNamespace.recommendation) {
          console.log(`  ⚠ ${report.networkNamespace.recommendation}`);
        }
        console.log(`\n[Protocol Risks]`);
        if (report.protocolRisks.length === 0) {
          console.log('  No protocol risks detected.');
        } else {
          for (const r of report.protocolRisks) {
            const icon = r.severity === 'error' ? '✗' : r.severity === 'warn' ? '⚠' : 'ℹ';
            console.log(`  ${icon} [${r.protocol}] ${r.description}`);
            console.log(`    Mitigation: ${r.mitigation}`);
          }
        }
        console.log(`\n[Version Compatibility]`);
        console.log(`  Installed:     ${report.versionCompatibility.installed ?? '—'}`);
        console.log(`  Patch version: ${report.versionCompatibility.patchVersion}`);
        console.log(`  Compatible:    ${report.versionCompatibility.compatible ? '✓' : '✗'}`);
        if (report.versionCompatibility.knownIssues.length) {
          console.log(`  Known issues:`);
          for (const issue of report.versionCompatibility.knownIssues) {
            console.log(`    - ${issue}`);
          }
        }
        console.log(`\n[Backup Integrity]`);
        if (report.backupIntegrity) {
          console.log(`  OK:     ${report.backupIntegrity.ok}`);
          console.log(`  Size:   ${report.backupIntegrity.size} bytes`);
          console.log(`  SHA256: ${report.backupIntegrity.sha256 ?? '—'}`);
          if (report.backupIntegrity.error) console.log(`  Error:  ${report.backupIntegrity.error}`);
        } else {
          console.log('  No backup found.');
        }
        console.log(`\n[Firewall]`);
        console.log(`  Rule active: ${report.firewallRuleActive}`);
        console.log(`\n[Recommendations]`);
        if (report.recommendations.length === 0) {
          ok('All advanced checks passed.');
        } else {
          for (const rec of report.recommendations) {
            warn(rec);
          }
        }
      }
      return 0;
    }

    case 'ns': {
      const ns = await detectNetworkNamespace();
      console.log(JSON.stringify(ns, null, 2));
      return 0;
    }

    case 'protocols': {
      const risks = await detectProtocolRisks();
      if (ctx.json) {
        console.log(JSON.stringify(risks, null, 2));
      } else {
        if (risks.length === 0) {
          ok('No protocol risks detected.');
        } else {
          for (const r of risks) {
            warn(`[${r.protocol}] ${r.description}`);
            info(`  → ${r.mitigation}`);
          }
        }
      }
      return 0;
    }

    case 'firewall': {
      const action = ctx.options.add ? 'add' : ctx.options.remove ? 'remove' : 'add';
      if (action === 'add') {
        const r = await addFirewallRule();
        if (r.ok) ok('Firewall rule added.'); else error(`Failed: ${r.error}`);
        return r.ok ? 0 : 1;
      } else {
        const r = await removeFirewallRule();
        if (r.ok) ok('Firewall rule removed.'); else error(`Failed: ${r.error}`);
        return r.ok ? 0 : 1;
      }
    }

    case 'verify': {
      const backup = getLanguageServerBackup();
      if (!backup) {
        error('No backup found.');
        return 1;
      }
      const r = await verifyBackupIntegrity(backup);
      if (ctx.json) {
        console.log(JSON.stringify(r, null, 2));
      } else {
        if (r.ok) {
          ok(`Backup verified: ${r.sha256?.slice(0, 16)}... (${r.size} bytes)`);
        } else {
          error(`Backup verification failed: ${r.error}`);
        }
      }
      return r.ok ? 0 : 1;
    }

    case 'compat': {
      const c = await checkVersionCompatibility();
      console.log(JSON.stringify(c, null, 2));
      return c.compatible ? 0 : 1;
    }

    case 'watch': {
      const binary = getLanguageServerBinary();
      if (!binary || !require('fs').existsSync(binary)) {
        error('Antigravity binary not found.');
        return 1;
      }
      info(`Watching ${binary} for changes (Ctrl+C to stop)...`);
      const watcher = watchBinaryForUpdates(binary, (newHash, oldHash) => {
        warn(`Binary updated! old=${oldHash.slice(0, 8)} new=${newHash.slice(0, 8)}`);
        warn('Run `ag-doctor repair` to re-apply the patch if needed.');
      });
      // Keep alive
      process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
      await new Promise(() => { /* never resolves */ });
      return 0;
    }

    case 'watchdog': {
      if (!ctx.json) header('Proxy Watchdog');
      const port = loadConfig().mitmPort;
      const status = await getProxyStatus(port);
      if (!status.pid) {
        error('No proxy running. Start it first with `ag-doctor proxy start`.');
        return 1;
      }
      const watchdog = new ProxyWatchdog(
        () => status.pid,
        (stats, reason) => {
          warn(`[Watchdog] ${reason}`);
          info(`  RSS: ${stats.rssMB.toFixed(0)}MB, FDs: ${stats.fdCount}`);
        },
      );
      watchdog.setRestartCallback(async () => {
        info('[Watchdog] Restarting proxy...');
        await runStop({ ...ctx, json: true }, port);
        await new Promise((r) => setTimeout(r, 1000));
        // Caller must restart manually or we can spawn here
        info('[Watchdog] Restart required. Run `ag-doctor proxy start`.');
      });
      watchdog.start(10_000);
      ok(`Watchdog started (PID ${status.pid}, checking every 10s)`);
      info('Press Ctrl+C to stop.');
      process.on('SIGINT', () => { watchdog.stop(); process.exit(0); });
      await new Promise(() => { /* never resolves */ });
      return 0;
    }

    case 'lock-test': {
      info('Acquiring CA lock...');
      const release = await acquireCaLock();
      ok('Lock acquired. Holding for 5s...');
      await new Promise((r) => setTimeout(r, 5000));
      release();
      ok('Lock released.');
      return 0;
    }

    default:
      error(`Unknown advanced subcommand: ${sub}`);
      console.log(USAGE);
      return 1;
  }
}
