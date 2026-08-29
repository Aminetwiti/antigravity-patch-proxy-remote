/**
 * Auto-recovery rules engine.
 *
 * Each rule defines:
 *   - id:           unique identifier
 *   - checkId:      which check.id it watches
 *   - status:       which status triggers it ('error' | 'warn')
 *   - action:       async function that attempts to fix the issue
 *   - cooldownMs:   minimum time between two consecutive executions
 *   - requiresConfirm: if true, the rule only runs in --auto mode
 *   - timeoutMs:    max time the action can take
 *
 * Rules are stored in:
 *   ~/.gemini/antigravity/recovery.json
 *
 * Built-in rules:
 *   - proxy-down         → restart local proxy
 *   - patch-missing      → re-apply binary patch
 *   - ca-not-installed   → install CA cert (admin required)
 *   - models-corrupted   → restore from latest snapshot
 *   - disk-full          → cleanup old snapshots/history
 *   - connectivity-fail  → retry true outages (timeout/DNS/refused) with exp. backoff
 *   - connectivity-warn  → nudge user to check config (4xx/5xx with reachable host)
 *
 * Note on connectivity:
 *   The `connectivity` check classifies each probe into 3 buckets (ok /
 *   reachable-but-bad / down). The check status maps to severity:
 *     - all ok                       → `ok`
 *     - any reachable-but-bad w/key  → `warn`  (config issue, NOT a network issue)
 *     - any down                      → `error` (true outage, recovery makes sense)
 *   We therefore have TWO rules: `connectivity-fail` watches `error` (real
 *   outage, retryable) and `connectivity-warn` watches `warn` (config issue,
 *   the only sane action is to inform the user — auto-retry is pointless).
 */
import fs from 'fs';
import path from 'path';
import { getAntigravityDataDir } from './paths';
import { getProfilePath } from './profile';
import { DEFAULT_MITM_PORT } from './config';
import type { CheckResult } from '../types';

const hasNativeFetch = typeof globalThis.fetch === 'function';

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response | null> {
  if (!hasNativeFetch) {
    return null;
  }
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  } catch {
    return null;
  }
}

export interface RecoveryRule {
  id: string;
  checkId: string;
  status: 'error' | 'warn';
  title: string;
  description: string;
  cooldownMs: number;
  requiresConfirm: boolean;
  timeoutMs: number;
  enabled: boolean;
}

export interface RecoveryActionResult {
  ok: boolean;
  message: string;
  durationMs: number;
  details?: string;
  ruleId: string;
}

export interface RecoveryConfig {
  enabled: boolean;
  autoMode: boolean; // if false, only non-confirming rules run
  notifyOnRecovery: boolean;
  notifyWebhook?: string;
  logFile: string;
  rules: RecoveryRule[];
}

const DEFAULT_CONFIG: RecoveryConfig = {
  enabled: true,
  autoMode: false,
  notifyOnRecovery: false,
  logFile: 'recovery.log',
  rules: [
    {
      id: 'proxy-down',
      checkId: 'proxy',
      status: 'error',
      title: 'Restart local proxy',
      description: 'Restart the local proxy when it is unreachable',
      cooldownMs: 60_000,
      requiresConfirm: false,
      timeoutMs: 10_000,
      enabled: true,
    },
    {
      id: 'patch-missing',
      checkId: 'patch',
      status: 'error',
      title: 'Re-apply binary patch',
      description: 'Re-apply the binary patch when the language_server binary is unpatched',
      cooldownMs: 5 * 60_000,
      requiresConfirm: true,
      timeoutMs: 30_000,
      enabled: true,
    },
    {
      id: 'ca-not-installed',
      checkId: 'mitm',
      status: 'warn',
      title: 'Install MITM CA cert',
      description: 'Install the MITM CA certificate into the OS trust store (requires admin)',
      cooldownMs: 5 * 60_000,
      requiresConfirm: true,
      timeoutMs: 15_000,
      enabled: true,
    },
    {
      id: 'disk-full',
      checkId: 'disk_space',
      status: 'error',
      title: 'Cleanup old snapshots/history',
      description: 'Remove old snapshots and history entries to free disk space',
      cooldownMs: 60 * 60_000,
      requiresConfirm: false,
      timeoutMs: 30_000,
      enabled: true,
    },
    {
      id: 'connectivity-fail',
      checkId: 'connectivity',
      status: 'error',
      title: 'Retry provider connectivity (true outages only)',
      description:
        'Retry provider endpoints that are truly unreachable (timeout, DNS, refused) ' +
        'with exponential backoff. Does NOT retry hosts that respond with 4xx/5xx — ' +
        'those are configuration issues, not network problems.',
      cooldownMs: 30_000,
      requiresConfirm: false,
      timeoutMs: 60_000,
      enabled: true,
    },
    {
      id: 'connectivity-warn',
      checkId: 'connectivity',
      status: 'warn',
      title: 'Surface provider configuration issues',
      description:
        'When at least one host is reachable but returns a non-2xx status, surface ' +
        'the offending URL(s) and HTTP code(s). Auto-retry is intentionally NOT ' +
        'performed — the cause is a wrong URL/key/model name, which retrying cannot fix.',
      cooldownMs: 5 * 60_000,
      requiresConfirm: false,
      timeoutMs: 5_000,
      enabled: true,
    },
  ],
};

export function getRecoveryConfigPath(): string {
  return getProfilePath('config').replace(/config\.json$/, 'recovery.json');
}

export function loadRecoveryConfig(): RecoveryConfig {
  const p = getRecoveryConfigPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG, rules: [...DEFAULT_CONFIG.rules] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const merged: RecoveryConfig = {
      ...DEFAULT_CONFIG,
      ...raw,
      rules: Array.isArray(raw.rules) ? raw.rules : DEFAULT_CONFIG.rules,
    };
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG, rules: [...DEFAULT_CONFIG.rules] };
  }
}

export function saveRecoveryConfig(cfg: RecoveryConfig): void {
  const p = getRecoveryConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

export function resetRecoveryConfig(): RecoveryConfig {
  saveRecoveryConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, rules: [...DEFAULT_CONFIG.rules] };
}

/** Get a rule by id. */
export function getRecoveryRule(id: string): RecoveryRule | null {
  return loadRecoveryConfig().rules.find((r) => r.id === id) ?? null;
}

/** Enable or disable a rule. */
export function setRuleEnabled(id: string, enabled: boolean): boolean {
  const cfg = loadRecoveryConfig();
  const rule = cfg.rules.find((r) => r.id === id);
  if (!rule) return false;
  rule.enabled = enabled;
  saveRecoveryConfig(cfg);
  return true;
}

// â”€â”€â”€ Recovery actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Run a recovery action with timeout. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

/** Recovery action: restart local proxy. */
async function restartProxy(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    // The proxy is started by the parent process (Antigravity). We can ping it
    // and try to trigger a restart by sending a signal to the parent PID.
    const port = DEFAULT_MITM_PORT;
    const pingRes = await fetchWithTimeout(`http://127.0.0.1:${port}/health`, 2000);

    if (pingRes && pingRes.ok) {
      return {
        ok: true,
        message: `Proxy already reachable on port ${port}`,
        durationMs: Date.now() - start,
        ruleId: rule.id,
      };
    }

    // Try to find the parent process and restart it via the parent's IPC.
    // For now, we log a clear instruction.
    return {
      ok: false,
      message: `Proxy unreachable on port ${port}. Restart Antigravity to recover.`,
      details: 'Auto-restart requires IPC with the parent process.',
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Failed to check proxy: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

/** Recovery action: re-apply binary patch.
 *  Note: This is intentionally conservative â€” we don't kill the running app
 *  from a background daemon. We only verify the patch state and report.
 *  The user must run `ag-doctor patch apply` manually.
 */
async function reapplyPatch(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    const { getPatchStatus } = await import('./binary-patch');
    const status = getPatchStatus();
    if (status.applied) {
      return {
        ok: true,
        message: 'Patch already applied â€” nothing to do',
        durationMs: Date.now() - start,
        ruleId: rule.id,
      };
    }
    return {
      ok: false,
      message: 'Patch not applied â€” manual intervention required',
      details: 'Run `ag-doctor patch apply` (this requires closing Antigravity first).',
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Failed to check patch status: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

/** Recovery action: install MITM CA. */
async function installCa(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    const { installCaCert } = await import('./mitm');
    const result = await withTimeout(installCaCert(), rule.timeoutMs);
    return {
      ok: result.ok,
      message: result.message,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Failed to install CA: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

/** Recovery action: cleanup old snapshots/history. */
async function cleanupDisk(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    const { listSnapshots, deleteSnapshot } = await import('./snapshot');
    const { listHistory, deleteHistory } = await import('./history');

    let freedBytes = 0;
    let removedSnapshots = 0;
    let removedHistory = 0;

    // Keep only the 5 most recent snapshots
    const snaps = listSnapshots();
    const oldSnaps = snaps.slice(5);
    for (const s of oldSnaps) {
      try {
        deleteSnapshot(s.id);
        removedSnapshots++;
        freedBytes += s.sizeBytes;
      } catch {
        // continue
      }
    }

    // Keep only the 20 most recent history entries
    const hist = listHistory();
    const oldHist = hist.slice(20);
    for (const h of oldHist) {
      try {
        deleteHistory(h.id);
        removedHistory++;
      } catch {
        // continue
      }
    }

    return {
      ok: true,
      message: `Cleanup complete: removed ${removedSnapshots} snapshots, ${removedHistory} history entries`,
      details: `Freed approximately ${(freedBytes / 1024 / 1024).toFixed(1)} MB`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Cleanup failed: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

/** Operator-facing advice for each probe error category. */
const ERROR_ADVICE: Record<string, string> = {
  dns: 'DNS failure — check network connectivity, /etc/resolv.conf, or DNS-over-HTTPS settings',
  refused: 'Connection refused — likely the local proxy is down. Restart Antigravity.',
  timeout: 'Timeout — host is slow or blocked by a firewall. Check upstream status page.',
  tls: 'TLS error — MITM CA cert missing/untrusted, or upstream uses an invalid certificate.',
  reset: 'Connection reset — usually transient. If persistent, check upstream rate limits.',
  other: 'Unclassified error — see details below.',
};

/** Render category → advice lines for the recovery action's `details`. */
function buildCategoryAdvice(byCategory: Map<string, string[]>): string {
  if (byCategory.size === 0) return '';
  const lines: string[] = ['Failure breakdown by category:'];
  for (const [cat, sources] of byCategory) {
    const sample = sources.slice(0, 3).join(', ') + (sources.length > 3 ? ` (+${sources.length - 3} more)` : '');
    lines.push(`  [${cat}] ${sources.length} host(s): ${sample}`);
    lines.push(`         → ${ERROR_ADVICE[cat] ?? ERROR_ADVICE.other}`);
  }
  return lines.join('\n');
}

/**
 * Recovery action: retry connectivity.
 *
 * Improved: instead of counting any non-ok probe as "failed", we classify each
 * probe outcome. Only true unreachable errors (timeout, DNS, TCP refused) are
 * retried with exponential backoff. Path/auth errors (4xx/5xx with reachable=true)
 * are surfaced but skipped — retrying them achieves nothing, since the cause is
 * configuration, not network. This avoids log spam and false-positive recoveries.
 *
 * Also reads each failure's `errorCategory` so the user can distinguish:
 *   - dns      → check DNS / network connectivity
 *   - refused  → check whether the local proxy is running
 *   - timeout  → check firewall / upstream latency
 *   - tls      → check MITM CA trust / certificate chain
 *   - reset    → transient; usually self-resolves on next retry
 */
async function retryConnectivity(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    const { checkConnectivity } = await import('../checks/connectivity');
    const { probe } = await import('./probe');
    const { buildModelsUrl } = await import('../commands/models/fetch');
    const { loadCustomModels } = await import('./custom-models');

    const initial = await checkConnectivity();
    const data = initial.data as
      | {
          results?: Array<{
            source: string;
            target: string;
            result: {
              ok: boolean;
              statusCode?: number;
              error?: string;
              errorCategory?: 'dns' | 'refused' | 'timeout' | 'tls' | 'reset' | 'other';
            };
          }>;
        }
      | undefined;
    const results = data?.results ?? [];

    // Classify and count true unreachable vs reachable-but-4xx/5xx.
    // For unreachable endpoints, group by errorCategory so we can produce
    // actionable advice (DNS vs proxy-down vs TLS vs timeout).
    let trulyDown = 0;
    let reachableButBad = 0;
    const downByCategory = new Map<string, string[]>();
    for (const { result, source } of results) {
      if (!result.ok) {
        trulyDown++;
        const cat = result.errorCategory ?? 'other';
        const list = downByCategory.get(cat) ?? [];
        list.push(source);
        downByCategory.set(cat, list);
        continue;
      }
      if (typeof result.statusCode === 'number' && result.statusCode >= 400) {
        reachableButBad++;
      }
    }

    if (trulyDown === 0) {
      return {
        ok: true,
        message:
          reachableButBad > 0
            ? `All hosts reachable (${reachableButBad} still returning 4xx/5xx â€” config issue, not a network problem)`
            : 'All providers reachable',
        details: JSON.stringify(initial, null, 2),
        durationMs: Date.now() - start,
        ruleId: rule.id,
      };
    }

    // Exponential backoff retry: 1s, 2s, 4s, 8s â€” capped at 4 attempts total
    const backoffMs = [1000, 2000, 4000, 8000];
    const file = loadCustomModels();
    const urlToModel = new Map<string, (typeof file.models)[number]>();
    for (const m of file.models) {
      if (!m.apiUrl) continue;
      if (!urlToModel.has(m.apiUrl)) {
        urlToModel.set(m.apiUrl, m);
      } else if (m.apiKey && !m.apiKey.startsWith('enc:') && urlToModel.get(m.apiUrl)?.apiKey?.startsWith('enc:')) {
        urlToModel.set(m.apiUrl, m);
      }
    }
    const urls = Array.from(urlToModel.keys());

    let lastResult = initial;
    for (let attempt = 0; attempt < backoffMs.length; attempt++) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt]));
      const probes = await Promise.all(urls.map(async (u) => {
        const target = buildModelsUrl(u);
        const model = urlToModel.get(u);
        return {
          source: u,
          target,
          result: await probe(target, 5000, { provider: model?.provider, apiKey: model?.apiKey }),
        };
      }));
      const stillDown = probes.filter(({ result }) => !result.ok).length;
      if (stillDown === 0) {
        return {
          ok: true,
          message: `Recovered after ${attempt + 1} retry(ies) â€” ${urls.length}/${urls.length} endpoints reachable`,
          details: JSON.stringify({ results: probes }, null, 2),
          durationMs: Date.now() - start,
          ruleId: rule.id,
        };
      }
      lastResult = { ...initial, data: { results: probes } };
    }

    return {
      ok: false,
      message: `${trulyDown} endpoint(s) still unreachable after retries (${reachableButBad} returning 4xx/5xx — config issue)`,
      details:
        buildCategoryAdvice(downByCategory) +
        '\n\nProbe details:\n' +
        JSON.stringify(lastResult, null, 2),
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Connectivity retry failed: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

/**
 * Recovery action: surface provider configuration issues (4xx/5xx with reachable host).
 *
 * This does NOT retry — retrying a misconfigured URL/key achieves nothing. It only
 * collects the offending endpoints + status codes so the daemon log clearly states
 * "host X returned 401 — check your API key" instead of silently burning cycles.
 */
async function surfaceConfigIssues(rule: RecoveryRule): Promise<RecoveryActionResult> {
  const start = Date.now();
  try {
    const { checkConnectivity } = await import('../checks/connectivity');
    const result = await checkConnectivity();
    const data = result.data as
      | { results?: Array<{ source: string; result: { ok: boolean; statusCode?: number; error?: string } }> }
      | undefined;
    const offenders = (data?.results ?? [])
      .filter((r) => r.result.ok && typeof r.result.statusCode === 'number' && r.result.statusCode >= 400)
      .map((r) => `${r.source} → HTTP ${r.result.statusCode}`);

    if (offenders.length === 0) {
      return {
        ok: true,
        message: 'No configuration issues detected (host is reachable and 2xx)',
        durationMs: Date.now() - start,
        ruleId: rule.id,
      };
    }
    return {
      ok: true, // informational, not a failure
      message: `${offenders.length} endpoint(s) need configuration review`,
      details:
        'Affected hosts (reachable but returning 4xx/5xx):\n  - ' +
        offenders.join('\n  - ') +
        '\n\nLikely causes:\n' +
        '  - 401/403: API key missing, invalid, or not authorised for this model\n' +
        '  - 404:     Wrong path (should end with /v1/chat/completions or /v1/models)\n' +
        '  - 429:     Rate limit hit; back off and retry later\n' +
        '  - 5xx:     Upstream provider issue — check provider status page',
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Config-issue surface failed: ${(e as Error).message}`,
      durationMs: Date.now() - start,
      ruleId: rule.id,
    };
  }
}

const ACTIONS: Record<string, (rule: RecoveryRule) => Promise<RecoveryActionResult>> = {
  'proxy-down': restartProxy,
  'patch-missing': reapplyPatch,
  'ca-not-installed': installCa,
  'disk-full': cleanupDisk,
  'connectivity-fail': retryConnectivity,
  'connectivity-warn': surfaceConfigIssues,
};

/** Execute a recovery action by rule id. */
export async function runRecoveryAction(ruleId: string): Promise<RecoveryActionResult | null> {
  const rule = getRecoveryRule(ruleId);
  if (!rule) return null;
  const action = ACTIONS[ruleId];
  if (!action) {
    return {
      ok: false,
      message: `No action handler for rule "${ruleId}"`,
      durationMs: 0,
      ruleId,
    };
  }
  return await withTimeout(action(rule), rule.timeoutMs);
}

// â”€â”€â”€ Rule evaluation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CooldownTracker {
  [ruleId: string]: number;
}

const lastRun: CooldownTracker = {};

/** Find rules that should fire given a set of check results. */
export function findApplicableRules(
  results: CheckResult[],
  cfg: RecoveryConfig,
): RecoveryRule[] {
  const applicable: RecoveryRule[] = [];
  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;
    if (!cfg.enabled) continue;
    if (rule.requiresConfirm && !cfg.autoMode) continue;

    // Check cooldown
    const last = lastRun[rule.id] ?? 0;
    if (Date.now() - last < rule.cooldownMs) continue;

    // Find a matching check
    const check = results.find((r) => r.id === rule.checkId);
    if (!check) continue;
    if (check.status !== rule.status) continue;

    applicable.push(rule);
  }
  return applicable;
}

/** Run all applicable rules for the given check results. */
export async function runRecovery(
  results: CheckResult[],
  cfg: RecoveryConfig,
): Promise<RecoveryActionResult[]> {
  const rules = findApplicableRules(results, cfg);
  const outcomes: RecoveryActionResult[] = [];

  for (const rule of rules) {
    lastRun[rule.id] = Date.now();
    const outcome = await runRecoveryAction(rule.id);
    if (outcome) outcomes.push(outcome);

    if (cfg.notifyOnRecovery && cfg.notifyWebhook) {
      await notifyWebhook(cfg.notifyWebhook, { rule, outcome }).catch(() => undefined);
    }
  }

  return outcomes;
}

async function notifyWebhook(url: string, payload: unknown): Promise<void> {
  if (!hasNativeFetch) return;
  await fetchWithTimeout(url, 5000).then(async (res) => {
    if (!res || !res.ok) return;
    await res.text().catch(() => undefined);
  }).catch(() => undefined);
}

/** Reset cooldown tracker (useful for tests). */
export function resetCooldowns(): void {
  for (const k of Object.keys(lastRun)) delete lastRun[k];
}

