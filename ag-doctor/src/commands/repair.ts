/**
 * `ag-doctor repair [--auto]` — automatically fix detected issues.
 *
 * Currently supports:
 *  - Re-applying the binary patch (when not applied)
 *  - Killing Antigravity processes holding the proxy port
 *  - Starting the local proxy (real or stub fallback) — fixes #15
 *  - Auto-generating CA cert if missing — fixes #23
 *  - Rebuilding dist/ if missing (requires the patch repo on disk)
 */
import type { CommandContext } from '../types';
import { checkPatch } from '../checks/patch';
import { applyPatch } from '../core/binary-patch';
import { isPortInUse, killAntigravityProcesses, resolveProxyRuntime, proxySpawnEnv } from '../core/process';
import { ensureDataDir } from '../core/custom-models';
import { snapshotBefore } from '../core/snapshot';
import { getProxyStatus } from './proxy';
import { ensureCa } from '../core/cert';
import { applyIdePatch, getIdePatchStatus } from '../core/ide-patch';
import { c, header, ok, warn, error, info } from '../cli/output';
import { confirm } from '../cli/prompts';
import { Spinner } from '../cli/spinner';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { DEFAULT_MITM_PORT } from '../core/config';
import { getAntigravityDataDir } from '../core/paths';

export async function runRepair(ctx: CommandContext): Promise<number> {
  header('ag-doctor — repair');
  const patch = checkPatch();
  const actions: string[] = [];

  // 1. Patch
  if (patch.data && !(patch.data as { applied: boolean }).applied) {
    actions.push('apply binary patch');
  }
  // 2. Port
  const portBusy = await isPortInUse(DEFAULT_MITM_PORT);
  if (portBusy) {
    actions.push('free proxy port (kill Antigravity)');
  }
  // 3. Proxy not running — start it (real or stub)
  const proxyStatus = await getProxyStatus(DEFAULT_MITM_PORT);
  if (!proxyStatus.reachable) {
    actions.push('start local proxy');
  }
  // 4. CA cert missing — auto-generate (no install, that's a separate step)
  const caPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.gemini', 'antigravity', 'ca.crt');
  if (!fs.existsSync(caPath)) {
    actions.push('generate MITM CA certificate');
  }
  // 4b. IDE (v1.107.0+) cloud endpoint override
  const idePatch = getIdePatchStatus();
  if (idePatch.installDir && !idePatch.applied) {
    actions.push('apply IDE (Antigravity IDE) cloud endpoint patch');
  }
  // 4c. Reconcile stale cooldowns in quota_cache.json
  const qCachePath = path.join(getAntigravityDataDir(), 'quota_cache.json');
  if (fs.existsSync(qCachePath)) {
    try {
      const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const quotas = qData.quotas || {};
      const now = Date.now();
      let staleCount = 0;
      for (const [k, until] of Object.entries(cds)) {
        if (typeof until !== 'number' || until <= now) {
          staleCount++;
          continue;
        }
        let acc = k;
        let fam = '';
        if (k.endsWith(':gemini')) { acc = k.slice(0, -7); fam = 'gemini'; }
        else if (k.endsWith(':claude')) { acc = k.slice(0, -7); fam = 'claude'; }
        const q = quotas[acc] || quotas[acc.startsWith('google:') ? acc : `google:${acc}`];
        if (q) {
          const resetStr = fam === 'gemini'
            ? (q.geminiResetTime || q.geminiFiveHourReset || q.fiveHourResetTime)
            : (q.claudeResetTime || q.claudeFiveHourReset || q.fiveHourResetTime);
          const resetPassed = resetStr ? Date.parse(resetStr) <= Date.now() : false;
          const weeklyDepleted = fam === 'gemini'
            ? ((typeof q.geminiWeeklyPct === 'number' && q.geminiWeeklyPct < 5) || (typeof q.weeklyPercentage === 'number' && q.weeklyPercentage < 5)) && !resetPassed
            : ((typeof q.claudeWeeklyPct === 'number' && q.claudeWeeklyPct < 5) || (typeof q.weeklyPercentage === 'number' && q.weeklyPercentage < 5)) && !resetPassed;
          if (fam === 'gemini' && ((q.geminiFiveHourPct >= 5 && !weeklyDepleted) || resetPassed)) {
            staleCount++;
          } else if (fam === 'claude' && ((q.claudeFiveHourPct >= 5 && !weeklyDepleted) || resetPassed)) {
            staleCount++;
          }
        }
      }
      if (staleCount > 0) {
        actions.push(`wake up ${staleCount} account(s) with stale cooldowns`);
      }
    } catch (_) {}
  }
  // 5. Data dir
  ensureDataDir();

  if (actions.length === 0) {
    ok('Nothing to repair');
    return 0;
  }

  // Snapshot before mutating anything (covers patch apply + models file)
  const snap = snapshotBefore('repair');
  if (snap) info(`Snapshot ${snap.id} created`);

  info('Planned actions:');
  for (const a of actions) console.log(`  ${c.cyan('•')} ${a}`);
  console.log('');

  if (!ctx.yes) {
    const ok2 = await confirm('Proceed?', false);
    if (!ok2) {
      warn('Aborted');
      return 1;
    }
  }

  for (const a of actions) {
    const sp = new Spinner(a);
    sp.start();
    try {
      if (a.startsWith('apply binary patch')) {
        const r = applyPatch();
        if (!r.ok) {
          sp.fail(r.message);
          return 2;
        }
        sp.succeed(r.message);
      } else if (a.startsWith(`free port ${DEFAULT_MITM_PORT}`)) {
        const r = await killAntigravityProcesses();
        sp.succeed(`Killed ${r.killed} process(es)`);
      } else if (a.startsWith('start local proxy')) {
        const started = await startProxyWithFallback(DEFAULT_MITM_PORT);
        if (started) {
          sp.succeed('Local proxy started (real or stub)');
        } else {
          sp.fail('Failed to start proxy');
          return 2;
        }
      } else if (a.startsWith('generate MITM CA')) {
        try {
          ensureCa();
          sp.succeed('MITM CA generated');
        } catch (e) {
          sp.fail(`CA generation failed: ${(e as Error).message}`);
        }
      } else if (a.startsWith('apply IDE')) {
        const r = applyIdePatch();
        if (!r.ok) {
          sp.fail(r.message);
          return 2;
        }
        sp.succeed(r.message);
      } else if (a.startsWith('wake up')) {
        const qPath = path.join(getAntigravityDataDir(), 'quota_cache.json');
        if (fs.existsSync(qPath)) {
          const qData = JSON.parse(fs.readFileSync(qPath, 'utf8'));
          const cds = qData.accountCooldowns || {};
          const quotas = qData.quotas || {};
          const now = Date.now();
          let clearedCount = 0;
          for (const [k, until] of Object.entries(cds)) {
            if (typeof until !== 'number' || until <= now) {
              delete cds[k];
              clearedCount++;
              continue;
            }
            let acc = k;
            let fam = '';
            if (k.endsWith(':gemini')) { acc = k.slice(0, -7); fam = 'gemini'; }
            else if (k.endsWith(':claude')) { acc = k.slice(0, -7); fam = 'claude'; }
            const q = quotas[acc] || quotas[acc.startsWith('google:') ? acc : `google:${acc}`];
            if (q) {
              const resetStr = fam === 'gemini'
                ? (q.geminiResetTime || q.geminiFiveHourReset || q.fiveHourResetTime)
                : (q.claudeResetTime || q.claudeFiveHourReset || q.fiveHourResetTime);
              const resetPassed = resetStr ? Date.parse(resetStr) <= now : false;
              const weeklyDepleted = fam === 'gemini'
                ? ((typeof q.geminiWeeklyPct === 'number' && q.geminiWeeklyPct < 5) || (typeof q.weeklyPercentage === 'number' && q.weeklyPercentage < 5)) && !resetPassed
                : ((typeof q.claudeWeeklyPct === 'number' && q.claudeWeeklyPct < 5) || (typeof q.weeklyPercentage === 'number' && q.weeklyPercentage < 5)) && !resetPassed;
              if (fam === 'gemini' && ((q.geminiFiveHourPct >= 5 && !weeklyDepleted) || resetPassed)) {
                delete cds[k];
                clearedCount++;
              } else if (fam === 'claude' && ((q.claudeFiveHourPct >= 5 && !weeklyDepleted) || resetPassed)) {
                delete cds[k];
                clearedCount++;
              }
            }
          }
          fs.writeFileSync(qPath, JSON.stringify(qData, null, 2), 'utf8');
          sp.succeed(`Woke up and cleared ${clearedCount} account cooldown(s)`);
        } else {
          sp.succeed('No cooldown cache found');
        }
      }
    } catch (e) {
      sp.fail((e as Error).message);
      return 2;
    }
  }

  ok('Repair complete');
  return 0;
}

/**
 * Start the local proxy: try real proxy first, fall back to stub.
 * Returns true if a proxy is listening on the port after the call.
 */
async function startProxyWithFallback(port: number): Promise<boolean> {
  // Try real proxy script
  const realPath = path.join(__dirname, '..', '..', 'scripts', 'proxy', 'standalone-proxy-runner.js');
  if (fs.existsSync(realPath)) {
    const ok = await trySpawnProxy(realPath, port, 5000);
    if (ok) return true;
  }
  // Fallback to stub
  const stubCandidates = [
    path.join(__dirname, '..', '..', '..', 'scripts', 'proxy', 'proxy-stub.js'),
    path.join(process.cwd(), 'scripts', 'proxy', 'proxy-stub.js'),
    path.join(__dirname, '..', '..', 'scripts', 'proxy', 'proxy-stub.js'),
    path.join(__dirname, '..', '..', 'bin', 'stub-proxy.js'),
  ];
  for (const stub of stubCandidates) {
    if (fs.existsSync(stub)) {
      const ok = await trySpawnProxy(stub, port, 3000);
      if (ok) return true;
    }
  }
  return false;
}

async function trySpawnProxy(scriptPath: string, port: number, waitMs: number): Promise<boolean> {
  try {
    const runtime = resolveProxyRuntime();
    const proc = spawn(runtime.bin, [...runtime.args, scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...proxySpawnEnv(),
        AG_PROXY_PORT: String(port),
        AG_STUB_PORT: String(port),
      },
    });
    proc.unref();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const status = await getProxyStatus(port);
      if (status.reachable) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  } catch {
    return false;
  }
}
