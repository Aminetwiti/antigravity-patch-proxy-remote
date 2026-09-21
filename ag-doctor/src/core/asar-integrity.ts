/**
 * app.asar integrity checker & self-healer.
 *
 * Why this exists:
 *   Patching operations can accidentally truncate or corrupt app.asar
 *   (e.g. only the /dist subtree remains, package.json goes missing).
 *   When that happens, Electron refuses to launch Antigravity because
 *   the entry point (dist/main.js) and its dependencies are gone.
 *
 *   The user often has at least one .bak file left over from the
 *   patcher (the "original-…" snapshot) that contains a valid archive.
 *   This module finds the best candidate and restores it.
 *
 * Detection:
 *   - File present?
 *   - File non-empty (>= 1 MB)? Healthy Antigravity 2.x asar is ~2 MB.
 *   - Contains package.json at the root?
 *   - package.json has the expected `name` and `main` fields?
 *
 * Backup selection (best-first):
 *   1. app.asar.<version>.original-*.bak   ← cleanest, matches the installed version
 *   2. app.asar.original.bak                ← generic clean snapshot
 *   3. app.asar.<version>.bak               ← versioned but not "original"
 *   4. app.asar.backup
 *   5. app.asar.*.bak (newest first)
 *   6. app.asar.tmp2 / app.asar.tmp         ← only if nothing else exists
 *
 * Safety:
 *   - Quarantines the broken asar before overwriting (app.asar.broken-<timestamp>.bak)
 *   - Records the action via `recordHistory` so it's audit-trail-visible
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findAntigravityInstallDir } from './paths';
import { saveHistory } from './history';

const MIN_HEALTHY_BYTES = 500_000; // 500 KB — real Antigravity 2.x is ~2 MB

export interface AsarIntegrityReport {
  installDir: string | null;
  resourcesDir: string | null;
  asarPath: string | null;
  exists: boolean;
  sizeBytes: number;
  /** True when the file is parseable and contains a root-level package.json. */
  healthy: boolean;
  /** Why it failed (null when healthy). */
  reason: string | null;
  /** Distinct candidate backups found next to app.asar, newest first. */
  candidates: AsarBackupCandidate[];
  /** The candidate the repair action would use (null when none). */
  recommended: AsarBackupCandidate | null;
}

export interface AsarBackupCandidate {
  path: string;
  sizeBytes: number;
  modified: string;
  /** Human-friendly tag derived from the filename. */
  label: string;
  /** Whether this candidate passes the same health checks as a live asar. */
  healthy: boolean;
  /** Reason it's not healthy (null when healthy). */
  reason: string | null;
  /** True when the candidate contains the add-model patch proxy tree. */
  patched: boolean;
}

interface ParsedAsarHeader {
  hasPackageJson: boolean;
  packageJson: { name?: string; main?: string; version?: string } | null;
}

/**
 * Parse the asar archive and verify it has a usable package.json.
 * Uses @electron/asar (already a dependency of ag-doctor).
 */
function parseAsarHeader(asarPath: string): ParsedAsarHeader {
  try {
    // Lazy require: the dep is loaded by binary-patch too, but we want this
    // module to stay usable in environments where it's not installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asar = require('@electron/asar');
    const entries: string[] = asar.listPackage(asarPath);
    const hasRoot = entries.some((e) => e.replace(/\\/g, '/') === '/package.json' || e === 'package.json');
    if (!hasRoot) {
      return { hasPackageJson: false, packageJson: null };
    }
    const buf = asar.extractFile(asarPath, 'package.json');
    if (!buf) return { hasPackageJson: false, packageJson: null };
    const json = JSON.parse(buf.toString('utf-8'));
    return { hasPackageJson: true, packageJson: json };
  } catch {
    return { hasPackageJson: false, packageJson: null };
  }
}

function checkCandidateHealth(asarPath: string): { healthy: boolean; reason: string | null } {
  try {
    if (!fs.existsSync(asarPath)) return { healthy: false, reason: 'file does not exist' };
    const stat = fs.statSync(asarPath);
    if (stat.size < MIN_HEALTHY_BYTES) {
      return { healthy: false, reason: `too small (${stat.size} bytes)` };
    }
    const header = parseAsarHeader(asarPath);
    if (!header.hasPackageJson) {
      return { healthy: false, reason: 'no root-level package.json' };
    }
    if (!header.packageJson?.name || !header.packageJson?.main) {
      return {
        healthy: false,
        reason: `package.json missing name or main (name=${header.packageJson?.name ?? '∅'}, main=${header.packageJson?.main ?? '∅'})`,
      };
    }
    return { healthy: true, reason: null };
  } catch (e) {
    return { healthy: false, reason: `unreadable: ${(e as Error).message}` };
  }
}

function labelFor(filename: string): string {
  if (/original/i.test(filename)) return 'original snapshot';
  if (/pre-(sslcert|proxyfix|dnsfix)/i.test(filename)) return 'pre-fix snapshot';
  if (/v\d+\.\d+\.\d+/i.test(filename)) return 'versioned backup';
  if (/^app\.asar\.backup$/i.test(filename)) return 'pre-edit backup';
  if (/\.tmp2?$/i.test(filename)) return 'temp file (risky)';
  if (/\.bak$/i.test(filename)) return 'generic backup';
  return 'asar file';
}

/**
 * A backup that contains the proxy/modelLoader patch additions is much more
 * valuable than a clean original because it preserves the user's custom
 * models / proxy wiring. We mark these candidates so they outrank clean
 * originals in the selection logic.
 */
function detectPatchSignature(asarPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asar = require('@electron/asar');
    const entries: string[] = asar.listPackage(asarPath);
    // The "add-model" patcher injects an entire /dist/proxy tree plus a
    // /dist/proxy/modelLoader.js entry. Either of these is a strong signal
    // that the candidate is a patched (and therefore more desirable) backup.
    return entries.some(
      (e) =>
        e === '/dist/proxy' ||
        e === '/dist/proxy/modelLoader.js' ||
        e.startsWith('/dist/proxy/'),
    );
  } catch {
    return false;
  }
}

/**
 * Score a candidate: higher = better. Used to choose the recommended backup.
 *
 * Ranking (highest first):
 *   1. Patched backup matching the installed Antigravity version  (best: keeps custom models)
 *   2. Patched backup of any compatible version
 *   3. Clean "original" snapshot of the installed version
 *   4. Generic .original / clean snapshot of any version
 *   5. Pre-fix snapshot (sslcert > proxyfix > dnsfix)
 *   6. .tmp files (risky — only used as last resort)
 */
function scoreCandidate(
  c: AsarBackupCandidate,
  installedVersion: string | null,
): number {
  let s = c.sizeBytes;
  const fname = path.basename(c.path);
  const isPatched = detectPatchSignature(c.path);
  const versionMatch = installedVersion && new RegExp(`v?${installedVersion.replace(/\./g, '\\.')}`, 'i').test(fname);

  if (isPatched && versionMatch) {
    s += 5_000_000_000; // top tier
  } else if (isPatched) {
    s += 3_000_000_000; // patched but wrong version
  } else if (/original/i.test(fname) && versionMatch) {
    s += 1_500_000_000; // clean original matching version
  } else if (/original/i.test(fname)) {
    s += 1_000_000_000; // generic clean original
  } else if (/pre-sslcert/i.test(fname)) {
    s += 500_000_000;
  } else if (/pre-proxyfix/i.test(fname)) {
    s += 250_000_000;
  } else if (/pre-dnsfix/i.test(fname)) {
    s += 100_000_000;
  } else if (/\.bak$/i.test(fname)) {
    s += 50_000_000;
  }
  if (/\.tmp2?$/i.test(fname)) {
    s -= 2_000_000_000; // risky — penalise heavily
  }
  return s;
}

export function getResourcesDir(): string | null {
  const dir = findAntigravityInstallDir();
  if (!dir) return null;
  return path.join(dir, 'resources');
}

export function getAsarPath(): string | null {
  const r = getResourcesDir();
  return r ? path.join(r, 'app.asar') : null;
}

/**
 * Enumerate backup candidates in the resources directory.
 * Always returns the file list ranked by `scoreCandidate` (best first).
 */
export function listAsarBackups(
  resourcesDir: string,
  installedVersion: string | null = null,
): AsarBackupCandidate[] {
  if (!fs.existsSync(resourcesDir)) return [];
  const out: AsarBackupCandidate[] = [];
  for (const entry of fs.readdirSync(resourcesDir)) {
    if (!/^app\.asar(\..+)?$/.test(entry)) continue;
    if (entry === 'app.asar') continue; // skip the live file
    const full = path.join(resourcesDir, entry);
    if (!fs.existsSync(full)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const health = checkCandidateHealth(full);
    out.push({
      path: full,
      sizeBytes: stat.size,
      modified: stat.mtime.toISOString(),
      label: labelFor(entry),
      healthy: health.healthy,
      reason: health.reason,
      patched: detectPatchSignature(full),
    });
  }
  out.sort((a, b) => scoreCandidate(b, installedVersion) - scoreCandidate(a, installedVersion));
  return out;
}

/**
 * Inspect the live app.asar and report its health + recommended backup.
 * Safe to call at any time — does not modify anything.
 */
export async function checkAsarIntegrity(): Promise<AsarIntegrityReport> {
  const installDir = findAntigravityInstallDir();
  const resourcesDir = installDir ? path.join(installDir, 'resources') : null;
  const asarPath = installDir ? path.join(installDir, 'resources', 'app.asar') : null;

  // Detect installed version lazily so patched backups that match it rank first
  let installedVersion: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { detectAntigravityVersion } = require('./antigravity');
    installedVersion = detectAntigravityVersion(installDir ?? undefined)?.version ?? null;
  } catch {
    /* version detection is optional */
  }

  if (!installDir || !resourcesDir || !asarPath) {
    return {
      installDir,
      resourcesDir,
      asarPath,
      exists: false,
      sizeBytes: 0,
      healthy: false,
      reason: 'Antigravity installation not found',
      candidates: [],
      recommended: null,
    };
  }

  if (!fs.existsSync(asarPath)) {
    return {
      installDir,
      resourcesDir,
      asarPath,
      exists: false,
      sizeBytes: 0,
      healthy: false,
      reason: 'app.asar not found',
      candidates: listAsarBackups(resourcesDir, installedVersion),
      recommended: null,
    };
  }

  const stat = fs.statSync(asarPath);
  const health = checkCandidateHealth(asarPath);

  const candidates = listAsarBackups(resourcesDir, installedVersion);
  const healthyCandidates = candidates.filter((c) => c.healthy);
  const recommended = healthyCandidates[0] ?? null;

  return {
    installDir,
    resourcesDir,
    asarPath,
    exists: true,
    sizeBytes: stat.size,
    healthy: health.healthy,
    reason: health.reason,
    candidates,
    recommended,
  };
}

export interface RepairAsarResult {
  ok: boolean;
  message: string;
  /** What we did, in order. */
  actions: string[];
  /** New state after the repair (always populated when ok=true). */
  report: AsarIntegrityReport | null;
}

/**
 * Restore app.asar from the best healthy backup.
 * - Quarantines the broken file as app.asar.broken-<timestamp>.bak first
 * - Records the action in the history log
 *
 * @param backupPath Optional explicit backup to restore from. If omitted,
 *                   the highest-scored healthy candidate is used.
 */
export async function repairAsar(backupPath?: string): Promise<RepairAsarResult> {
  const report = await checkAsarIntegrity();
  const actions: string[] = [];

  if (report.healthy) {
    return {
      ok: true,
      message: 'app.asar is already healthy — nothing to do',
      actions: ['verified'],
      report,
    };
  }

  if (!report.asarPath) {
    return {
      ok: false,
      message: 'Cannot repair: app.asar path is unknown (Antigravity not installed?)',
      actions,
      report,
    };
  }

  // Choose source
  let source: string | null = backupPath ?? null;
  if (!source) {
    if (report.recommended) {
      source = report.recommended.path;
      actions.push(`selected backup: ${path.basename(source)} (${report.recommended.label}, ${report.recommended.sizeBytes} bytes)`);
    }
  } else {
    if (!fs.existsSync(source)) {
      return {
        ok: false,
        message: `Specified backup not found: ${source}`,
        actions,
        report,
      };
    }
    const candHealth = checkCandidateHealth(source);
    if (!candHealth.healthy) {
      return {
        ok: false,
        message: `Specified backup is not healthy: ${candHealth.reason}`,
        actions,
        report,
      };
    }
    actions.push(`using user-specified backup: ${path.basename(source)}`);
  }

  if (!source) {
    return {
      ok: false,
      message:
        'No healthy backup found next to app.asar. Cannot auto-repair. ' +
        'Reinstall Antigravity or manually copy a known-good app.asar into the resources folder.',
      actions,
      report,
    };
  }

  // Verify the live asar exists (or create an empty placeholder if missing)
  const liveExists = fs.existsSync(report.asarPath);

  // Quarantine the broken file
  if (liveExists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = path.join(
      report.resourcesDir ?? path.dirname(report.asarPath),
      `app.asar.broken-${stamp}.bak`,
    );
    try {
      fs.renameSync(report.asarPath, quarantine);
      actions.push(`quarantined broken asar → ${path.basename(quarantine)}`);
    } catch (e) {
      return {
        ok: false,
        message: `Failed to quarantine broken app.asar: ${(e as Error).message}`,
        actions,
        report,
      };
    }
  } else {
    actions.push('no live asar to quarantine (was missing)');
  }

  // Copy the healthy backup into place
  try {
    fs.copyFileSync(source, report.asarPath);
    actions.push(`copied ${path.basename(source)} → app.asar`);
  } catch (e) {
    return {
      ok: false,
      message: `Failed to copy backup into place: ${(e as Error).message}`,
      actions,
      report,
    };
  }

  // Verify the result
  const postHealth = checkCandidateHealth(report.asarPath);
  const finalReport = await checkAsarIntegrity();

  // Audit trail
  try {
    saveHistory({
      kind: 'asar-repair',
      message: `Repaired app.asar using ${path.basename(source)}`,
      details: {
        actions,
        previousSize: report.sizeBytes,
        previousReason: report.reason,
        postHealthy: postHealth.healthy,
        postReason: postHealth.reason,
        source,
        timestamp: new Date().toISOString(),
        hostname: os.hostname(),
      },
    });
  } catch {
    /* history write is best-effort */
  }

  if (!postHealth.healthy) {
    return {
      ok: false,
      message: `Restoration completed but app.asar still unhealthy: ${postHealth.reason}`,
      actions,
      report: finalReport,
    };
  }

  return {
    ok: true,
    message: `Repaired app.asar from ${path.basename(source)}`,
    actions,
    report: finalReport,
  };
}
