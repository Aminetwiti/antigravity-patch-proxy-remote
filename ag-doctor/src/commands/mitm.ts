/**
 * `ag-doctor mitm` — manage the MITM CA cert and system proxy.
 *
 * Subcommands:
 *   status      Show CA + proxy + interception status
 *   install     Generate CA + install into OS trust store + set system proxy
 *   uninstall   Remove CA from trust store + clear system proxy
 *   proxy-on    Set the system HTTP/HTTPS proxy to the MITM port
 *   proxy-off   Clear the system HTTP/HTTPS proxy
 *   export-ca   Print the path to the CA certificate
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import {
  getMitmStatus,
  installCaCert,
  uninstallCaCert,
  setSystemProxy,
  clearSystemProxy,
} from '../core/mitm';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST, loadConfig } from '../core/config';
import { ensureCa, getCaCertPath } from '../core/cert';
import { c, header, ok, warn, error, info, table } from '../cli/output';
import { confirm } from '../cli/prompts';

const USAGE = `ag-doctor mitm — manage MITM CA cert and system proxy

Usage:
  ag-doctor mitm status           Show CA + proxy + interception status
  ag-doctor mitm install          Generate CA, install in trust store, set proxy
  ag-doctor mitm uninstall        Remove CA from trust store, clear proxy
  ag-doctor mitm proxy-on         Set system HTTP/HTTPS proxy to MITM port
  ag-doctor mitm proxy-off        Clear system HTTP/HTTPS proxy
  ag-doctor mitm export-ca        Print path to CA certificate (PEM)
  ag-doctor mitm --help           Show this help
`;

export async function runMitm(ctx: CommandContext, sub: string | undefined): Promise<number> {
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case 'status':
      return await runStatus(ctx);
    case 'install':
      return await runInstall(ctx);
    case 'uninstall':
      return await runUninstall(ctx);
    case 'proxy-on':
      return await runProxyOn(ctx);
    case 'proxy-off':
      return await runProxyOff(ctx);
    case 'export-ca':
      return runExportCa(ctx);
    default:
      error(`Unknown mitm subcommand: ${sub}`);
      console.log(USAGE);
      return 2;
  }
}

async function runStatus(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('MITM status');
  const s = await getMitmStatus(loadConfig().mitmPort);
  if (ctx.json) {
    console.log(JSON.stringify(s, null, 2));
  } else {
    table([
      ['Platform', s.platform],
      ['CA exists', s.caExists ? c.green('yes') : c.yellow('no')],
      ['CA installed', s.caInstalled ? c.green('yes') : c.yellow('no')],
      ['CA fingerprint', s.caFingerprint ?? c.gray('—')],
      ['CA cert path', s.caCertPath ?? c.gray('—')],
      ['System proxy', s.proxyEnabled ? c.green(`${s.proxyHost}:${s.proxyPort}`) : c.yellow('off')],
      ['Interception', s.interceptionOk === null ? c.gray('not tested') : s.interceptionOk ? c.green('OK') : c.red(`FAILED — ${s.interceptionError}`)],
    ]);
    if (s.details.length > 0) {
      console.log('');
      console.log(c.gray('Details:'));
      for (const d of s.details) console.log(`  ${c.gray('•')} ${d}`);
    }
  }
  return 0;
}

async function runInstall(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('MITM — install');
  info('Generating CA cert (if missing)...');
  const ca = ensureCa();
  info(`CA: ${ca.certPath}`);
  info(`Fingerprint: ${ca.fingerprint}`);

  if (!ctx.yes) {
    const ok2 = await confirm(
      'Install the Antigravity MITM CA into the OS trust store and set the system proxy?',
      false,
    );
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }

  info('Installing CA into OS trust store (may require sudo/admin)...');
  const r1 = await installCaCert();
  if (!r1.ok) {
    error(r1.message);
    return 2;
  }
  ok(r1.message);

  info(`Setting system proxy to ${DEFAULT_BIND_HOST}:${loadConfig().mitmPort}...`);
  const r2 = await setSystemProxy(DEFAULT_BIND_HOST, loadConfig().mitmPort);
  if (!r2.ok) {
    warn(r2.message);
  } else {
    ok(r2.message);
  }

  ok('MITM installed. Run `ag-doctor mitm status` to verify.');
  return 0;
}

async function runUninstall(ctx: CommandContext): Promise<number> {
  if (!ctx.json) header('MITM — uninstall');
  if (!ctx.yes) {
    const ok2 = await confirm('Remove the Antigravity MITM CA and clear the system proxy?', false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }
  const r1 = await clearSystemProxy();
  if (!r1.ok) warn(r1.message);
  else ok(r1.message);

  const r2 = await uninstallCaCert();
  if (!r2.ok) {
    error(r2.message);
    return 2;
  }
  ok(r2.message);
  ok('MITM uninstalled.');
  return 0;
}

async function runProxyOn(ctx: CommandContext): Promise<number> {
  const port = loadConfig().mitmPort;
  if (!ctx.json) info(`Setting system proxy to ${DEFAULT_BIND_HOST}:${port}...`);
  const r = await setSystemProxy(DEFAULT_BIND_HOST, port);
  if (!r.ok) {
    error(r.message);
    return 2;
  }
  ok(r.message);
  return 0;
}

async function runProxyOff(ctx: CommandContext): Promise<number> {
  if (!ctx.json) info('Clearing system proxy...');
  const r = await clearSystemProxy();
  if (!r.ok) {
    error(r.message);
    return 2;
  }
  ok(r.message);
  return 0;
}

function runExportCa(ctx: CommandContext): number {
  const p = getCaCertPath();
  if (!fs.existsSync(p)) {
    error(`CA not generated yet. Run \`ag-doctor mitm install\` first.`);
    return 2;
  }
  if (ctx.json) {
    console.log(JSON.stringify({ path: p, exists: true, size: fs.statSync(p).size }, null, 2));
  } else {
    console.log(p);
  }
  return 0;
}
