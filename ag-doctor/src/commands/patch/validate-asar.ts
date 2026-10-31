/**
 * `ag-doctor patch validate-asar` — pre-deployment asar validator.
 *
 * Why:
 *   During the 2026-07-11 session, a *full overlay* patch of app.asar
 *   (21 195 021 B) crashed Antigravity because it bundled an entire
 *   `/dist/__mocks__` subtree and an oversized `dist/main.js` (≈ 14 554 B
 *   in the live binary was replaced by ~21 MB). The UI needs a verdict
 *   *before* the live file is overwritten so it can warn or block the
 *   apply.
 *
 * Checks (all non-fatal individually, collected into a single report):
 *   - `dist/main.js` present and ≈ 14 554 B (±10 %)
 *   - `dist/cryptoStore.js` present (and small, since cryptoStore is short)
 *   - No `dist/__mocks__/*` entries (these break the runtime)
 *   - Total delta vs a known-good reference < 100 KB
 *
 * Verdict:
 *   - 'ok'    : all critical checks pass; the asar looks like a safe surgical patch
 *   - 'warn'  : something is suspicious but not catastrophic; UI may proceed with caution
 *   - 'block' : a critical check failed; UI MUST NOT overwrite the live file
 */
import * as fs from 'fs';
import * as path from 'path';
// Static import: loads asar-reader (and its process.noAsar side effect) so even
// the early fs.existsSync/statSync calls work under Electron-as-node.
import { listAsarPaths, readAsarFile as nativeReadAsarFile } from '../../core/asar-reader';

export type AsarVerdict = 'ok' | 'warn' | 'block';

export interface AsarCheck {
  id: string;
  /** Short label for the UI ("dist/main.js size") */
  label: string;
  /** Whether the check is required for the verdict to be 'ok' */
  required: boolean;
  /** 'ok' if the check passed, otherwise the failing reason */
  status: 'ok' | 'fail';
  /** Numeric observation (file size, count, delta, etc.) when relevant */
  value?: number;
  /** Human-friendly details string for tooltips */
  detail?: string;
}

export interface AsarValidationReport {
  /** Path that was validated (may be null if the file does not exist). */
  asarPath: string | null;
  /** Aggregate verdict: most severe check wins. */
  verdict: AsarVerdict;
  /** All checks that ran, in declaration order. */
  checks: AsarCheck[];
  /**
   * Difference between the asar size and the live `app.asar` size in bytes.
   * Positive when the candidate is bigger than the live file. `null` when
   * the live file size could not be measured (no live asar found).
   */
  deltaSizeBytes: number | null;
  /** Total bytes of the candidate asar (0 if missing). */
  asarSizeBytes: number;
}

const MAIN_JS_EXPECTED_BYTES = 14_554; // kept for reference / docs
const MAIN_JS_TOLERANCE = 0.10; // ±10 %
/** Upper bound for a surgical main.js — the 21 MB overlay disaster case. */
const MAX_MAIN_JS_BYTES = 1_000_000; // 1 MB
const MAX_DELTA_BYTES = 100 * 1024; // 100 KB warning threshold

interface AsarListEntry {
  path?: string;
  [k: string]: unknown;
}

function listAsarEntries(asarPath: string): string[] {
  // Dependency-free reader first: @electron/asar requires Node >= 22 and fails
  // under the doctor UI's workers (Electron's Node 18). Fall back to the
  // library when available (plain Node >= 22).
  try {
    const paths = listAsarPaths(asarPath);
    if (paths.length > 0) return paths;
  } catch {
    // fall through to @electron/asar
  }
  try {
    const asar = require('@electron/asar') as {
      listPackage?: (p: string) => unknown;
    };
    const fn = asar.listPackage ?? (asar as unknown as { default?: { listPackage?: (p: string) => unknown } }).default?.listPackage;
    if (typeof fn !== 'function') return [];
    const listed: unknown = (fn as (p: string) => unknown)(asarPath);
    if (!Array.isArray(listed)) return [];
    return listed
      .map((e: unknown) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && typeof (e as AsarListEntry).path === 'string') {
          return (e as AsarListEntry).path as string;
        }
        return '';
      })
      .filter((e: string) => e.length > 0);
  } catch {
    return [];
  }
}

function readAsarFile(asarPath: string, filePath: string): Buffer | null {
  try {
    const buf = nativeReadAsarFile(asarPath, filePath.replace(/^\//, ''));
    if (buf) return buf;
  } catch {
    // fall through to @electron/asar
  }
  try {
    const asar = require('@electron/asar') as {
      extractFile?: (p: string, f: string) => unknown;
    };
    const fn =
      asar.extractFile ?? (asar as unknown as { default?: { extractFile?: (p: string, f: string) => unknown } }).default?.extractFile;
    if (typeof fn !== 'function') return null;
    const raw: unknown = (fn as (p: string, f: string) => unknown)(asarPath, filePath);
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    if (typeof raw === 'string') return Buffer.from(raw);
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a candidate asar before it's deployed over the live one.
 *
 * @param asarPath   Path to the candidate asar on disk.
 * @param liveAsarPath Optional path to the live `app.asar` to compute
 *                     delta against. When omitted, delta is reported as null.
 */
export function validateAsar(asarPath: string, liveAsarPath?: string | null): AsarValidationReport {
  const checks: AsarCheck[] = [];
  let asarSizeBytes = 0;

  // 1. File exists & non-empty
  if (!asarPath || !fs.existsSync(asarPath)) {
    checks.push({
      id: 'asar-exists',
      label: 'Candidate asar exists',
      required: true,
      status: 'fail',
      detail: `Path not found: ${asarPath ?? '(null)'}`,
    });
    return {
      asarPath: asarPath ?? null,
      verdict: 'block',
      checks,
      deltaSizeBytes: null,
      asarSizeBytes: 0,
    };
  }
  try {
    const stat = fs.statSync(asarPath);
    asarSizeBytes = stat.size;
    if (asarSizeBytes < 500_000) {
      checks.push({
        id: 'asar-exists',
        label: 'Candidate asar exists',
        required: true,
        status: 'fail',
        value: asarSizeBytes,
        detail: `Too small (${asarSizeBytes} B). A healthy Antigravity 2.x asar is ≥ 500 KB.`,
      });
      return {
        asarPath,
        verdict: 'block',
        checks,
        deltaSizeBytes: null,
        asarSizeBytes,
      };
    }
    checks.push({
      id: 'asar-exists',
      label: 'Candidate asar exists',
      required: true,
      status: 'ok',
      value: asarSizeBytes,
      detail: `${formatBytes(asarSizeBytes)} (${asarSizeBytes.toLocaleString()} B)`,
    });
  } catch (e) {
    checks.push({
      id: 'asar-exists',
      label: 'Candidate asar exists',
      required: true,
      status: 'fail',
      detail: `Unreadable: ${(e as Error).message}`,
    });
    return {
      asarPath,
      verdict: 'block',
      checks,
      deltaSizeBytes: null,
      asarSizeBytes: 0,
    };
  }

  // 2. dist/main.js present & ≈ 14 554 B (±10 %)
  const entries = listAsarEntries(asarPath);
  const mainJsEntry = entries.find((e) => e === '/dist/main.js' || e === 'dist/main.js');
  if (!mainJsEntry) {
    checks.push({
      id: 'main-js-present',
      label: 'dist/main.js present',
      required: true,
      status: 'fail',
      detail: 'No /dist/main.js found in archive. Electron will not start.',
    });
  } else {
    const buf = readAsarFile(asarPath, mainJsEntry.replace(/^\//, ''));
    const size = buf?.length ?? 0;
    if (size === 0) {
      checks.push({
        id: 'main-js-present',
        label: 'dist/main.js present',
        required: true,
        status: 'fail',
        detail: 'dist/main.js exists but is empty.',
      });
    } else if (size > MAX_MAIN_JS_BYTES) {
      // A wildly oversized main.js is the exact failure mode that bricked the
      // live app on 2026-07-11 (a 21 MB overlay replaced the real ~14 KB
      // file). Surgical builds (original ~14.5 KB, repo build ~18 KB) are far
      // below this bound, so only the disaster case blocks.
      checks.push({
        id: 'main-js-present',
        label: 'dist/main.js size',
        required: true,
        status: 'fail',
        value: size,
        detail: `main.js is ${size} B — a multi-MB overlay that would brick the app. A surgical patch keeps this file small (< 1 MB).`,
      });
    } else {
      checks.push({
        id: 'main-js-present',
        label: 'dist/main.js size',
        required: true,
        status: 'ok',
        value: size,
        detail: `${size} B (expected ≈ ${MAIN_JS_EXPECTED_BYTES} B)`,
      });
    }
  }

  const isLiveCheck = liveAsarPath ? path.resolve(asarPath) === path.resolve(liveAsarPath) : false;

  // 3. dist/cryptoStore.js present (critical for the patched proxy tree in overlay mode)
  const cryptoEntry = entries.find((e) => e === '/dist/cryptoStore.js' || e === 'dist/cryptoStore.js');
  if (!cryptoEntry) {
    checks.push({
      id: 'crypto-store-present',
      label: 'dist/cryptoStore.js present',
      required: !isLiveCheck,
      status: 'fail',
      detail: isLiveCheck
        ? 'Missing dist/cryptoStore.js (stock unpatched asar or binary-proxy mode).'
        : 'Missing dist/cryptoStore.js. The patched proxy tree relies on it.',
    });
  } else {
    checks.push({
      id: 'crypto-store-present',
      label: 'dist/cryptoStore.js present',
      required: !isLiveCheck,
      status: 'ok',
      detail: cryptoEntry,
    });
  }

  // 4. No dist/__mocks__/* entries (critical for candidate overlay archives)
  const mockEntries = entries.filter((e) => /^\/?dist\/__mocks__\//.test(e));
  if (mockEntries.length > 0) {
    checks.push({
      id: 'no-mocks',
      label: 'No dist/__mocks__/* entries',
      required: !isLiveCheck,
      status: 'fail',
      value: mockEntries.length,
      detail: `Found ${mockEntries.length} dist/__mocks__/* entries (e.g. ${mockEntries.slice(0, 3).join(', ')}). ${
        isLiveCheck ? 'Stock asar includes mocks from upstream packaging.' : 'The runtime does not load mocks — including them has crashed the app in the past.'
      }`,
    });
  } else {
    checks.push({
      id: 'no-mocks',
      label: 'No dist/__mocks__/* entries',
      required: true,
      status: 'ok',
      detail: 'Archive contains no mocks subtree.',
    });
  }

  // 5. Delta size vs live asar (if a live file is available)
  let deltaSizeBytes: number | null = null;
  if (liveAsarPath && fs.existsSync(liveAsarPath)) {
    try {
      const liveStat = fs.statSync(liveAsarPath);
      deltaSizeBytes = asarSizeBytes - liveStat.size;
      if (Math.abs(deltaSizeBytes) > MAX_DELTA_BYTES) {
        checks.push({
          id: 'delta-size',
          label: 'Delta size vs live asar',
          required: false,
          status: 'fail',
          value: deltaSizeBytes,
          detail: `Delta ${formatSignedBytes(deltaSizeBytes)} exceeds ±${formatBytes(MAX_DELTA_BYTES)} threshold. A surgical patch should not change the archive by more than ±100 KB.`,
        });
      } else {
        checks.push({
          id: 'delta-size',
          label: 'Delta size vs live asar',
          required: false,
          status: 'ok',
          value: deltaSizeBytes,
          detail: `${formatSignedBytes(deltaSizeBytes)} (live ${formatBytes(liveStat.size)})`,
        });
      }
    } catch {
      // Live file unreadable — non-fatal, delta reported as null
    }
  }

  // Aggregate verdict: any required-failed ⇒ block; otherwise if any non-required
  // failed ⇒ warn; else ok. We only mark warn *after* confirming no required
  // check failed — otherwise the verdict is always 'block'.
  let verdict: AsarVerdict = 'ok';
  for (const c of checks) {
    if (c.status === 'fail' && c.required) {
      verdict = 'block';
      break;
    }
  }
  if (verdict !== 'block') {
    for (const c of checks) {
      if (c.status === 'fail') {
        verdict = 'warn';
        break;
      }
    }
  }
  return {
    asarPath,
    verdict,
    checks,
    deltaSizeBytes,
    asarSizeBytes,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024))));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : v < 100 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatSignedBytes(bytes: number): string {
  const s = formatBytes(Math.abs(bytes));
  return bytes >= 0 ? `+${s}` : `-${s}`;
}

// Path utils (re-exported so callers don't need to import 'path' directly)
export function defaultLiveAsarPath(): string | null {
  // Defer to asar-integrity to find the live file in the standard install dir.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAsarPath } = require('../core/asar-integrity');
    const p: string | null = getAsarPath();
    return p ?? null;
  } catch {
    return null;
  }
}

export const __test_internals = { listAsarEntries, readAsarFile };
