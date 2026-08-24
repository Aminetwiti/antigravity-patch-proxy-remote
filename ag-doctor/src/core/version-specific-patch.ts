/**
 * Version-specific binary patches for Antigravity language_server.
 *
 * Different Antigravity versions have different URL patterns in the binary.
 * This module detects the version and applies the appropriate patch.
 *
 * Auto-detection can be overridden by setting `patch.versionOverride` in the
 * user config (see `core/config.ts`). The override is exposed to the UI so
 * users can manually pin a range when:
 *   - auto-detection fails (binary stripped of version metadata)
 *   - the binary was modified by Google and no longer matches the registry
 *   - the user wants to test a patch range before it's officially supported
 */
import fs from 'fs';
import { getAppAsarPath, getLanguageServerBinary, getLanguageServerBackup } from './paths';
import { detectAntigravityVersion } from './antigravity';
import { getPatchVersionOverride } from './config';
import { DEFAULT_MITM_PORT } from './config';
import type { PatchStatus } from '../types';

/**
 * Patch definitions for different Antigravity version ranges.
 * Each patch replaces an ORIGINAL_URL with a PATCHED_URL of the same length.
 */
export interface PatchDefinition {
  /** Version range this patch applies to (e.g., "2.0.x - 2.1.x") */
  versionRange: string;
  /** Minimum version (inclusive) */
  minVersion: string;
  /** Maximum version (inclusive, null = no upper limit) */
  maxVersion: string | null;
  /** Original URL to find in the binary */
  originalUrl: string;
  /** Replacement URL (must be same length as originalUrl) */
  patchedUrl: string;
  /** Human-readable description */
  description: string;
  /** Optional: extra JS-overlay instructions for this version range */
  extraInstructions?: {
    scriptName: string;
    missingJsModules?: string[];
    overwriteFiles?: string[];
    newRootFiles?: string[];
  };
}

/**
 * Registry of known patches for different Antigravity versions.
 * Ordered from newest to oldest.
 *
 * ⚠️ 2.3.x notes (added 2026-07-21):
 * - Binary URL pattern is UNCHANGED from 2.2.x (still `daily-cloudcode-pa.googleapis.com`)
 * - BUT: Google removed the entire `dist/proxy/*` tree + `cryptoStore` +
 *   `customModelStore` + `schemaValidator` + `proxy-runner.js` from the JS bundle.
 * - The repo's v2.2.x-patched `main.js`, `languageServer.js`, `ipcHandlers.js`,
 *   `preload.js`, `constants.js` still work as drop-in replacements (they contain
 *   the proxy integration hooks).
 * - The patch tool must therefore ALSO inject the 25 missing JS modules and
 *   overwrite the 5 stripped files. See `scripts/patch_2_3.js`.
 */
export const PATCH_REGISTRY: PatchDefinition[] = [
  {
    versionRange: '2.6.0+',
    minVersion: '2.6.0',
    maxVersion: null,
    originalUrl: 'https://cloudcode-pa.googleapis.com',
    patchedUrl: `http://localhost:${DEFAULT_MITM_PORT}/v1internal/x`,
    description: 'Patch for Antigravity 2.6.0+ (35 bytes; binary URL shortened)',
  },
  {
    versionRange: '2.3.0+',
    minVersion: '2.3.0',
    maxVersion: '2.5.99',
    originalUrl: 'https://daily-cloudcode-pa.googleapis.com',
    patchedUrl: `http://localhost:${DEFAULT_MITM_PORT}/v1internal/xxxxxxx`,
    description: 'Patch for Antigravity 2.3.0+ (41 bytes; binary URL unchanged — JS overlay required)',
    extraInstructions: {
      scriptName: 'patch_2_3.js',
      missingJsModules: [
        'cryptoStore', 'customModelStore', 'schemaValidator',
        'proxy',
        'proxy/dnsResolver', 'proxy/errorClassifier', 'proxy/idGenerator',
        'proxy/jsonRepair', 'proxy/modelLoader', 'proxy/modelUtils',
        'proxy/protoInjector', 'proxy/protobuf', 'proxy/registry',
        'proxy/retryStrategy', 'proxy/shared',
        'proxy/translators/anthropic', 'proxy/translators/google',
        'proxy/translators/ollama', 'proxy/translators/openai',
        'proxy/translators/utils', 'proxy/types', 'proxy/urlBuilder',
      ],
      overwriteFiles: [
        'dist/main.js', 'dist/languageServer.js', 'dist/ipcHandlers.js',
        'dist/preload.js', 'dist/constants.js',
      ],
      newRootFiles: ['proxy-runner.js'],
    },
  },
  {
    versionRange: '2.2.0 - 2.2.x',
    minVersion: '2.2.0',
    maxVersion: '2.2.99',
    originalUrl: 'https://daily-cloudcode-pa.googleapis.com',
    patchedUrl: `http://localhost:${DEFAULT_MITM_PORT}/v1internal/xxxxxxx`,
    description: 'Patch for Antigravity 2.2.0+ (41 bytes; 3 modules missing)',
    extraInstructions: {
      scriptName: 'patch_2_2_1.js',
      missingJsModules: [
        'cryptoStore', 'customModelStore', 'schemaValidator',
      ],
    },
  },
  {
    versionRange: '2.0.1 - 2.1.x',
    minVersion: '2.0.1',
    maxVersion: '2.1.99',
    originalUrl: 'https://daily-cloudcode-pa.googleapis.com',
    patchedUrl: `http://localhost:${DEFAULT_MITM_PORT}/v1internal/xxxxxxx`,
    description: 'Patch for Antigravity 2.0.1 to 2.1.x (41 bytes; full overlay OK)',
  },
];

/** Parse semantic version string to comparable number array [major, minor, patch] */
function parseVersion(version: string): number[] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    // Try X.Y format
    const match2 = version.match(/^(\d+)\.(\d+)/);
    if (!match2) return [0, 0, 0];
    return [parseInt(match2[1], 10), parseInt(match2[2], 10), 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/** Compare two version arrays. Returns -1 if a < b, 0 if equal, 1 if a > b */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** Check if a version string is within a patch's version range */
function versionInRange(version: string, patch: PatchDefinition): boolean {
  const v = parseVersion(version);
  const min = parseVersion(patch.minVersion);
  const max = patch.maxVersion ? parseVersion(patch.maxVersion) : null;

  if (compareVersions(v, min) < 0) return false;
  if (max && compareVersions(v, max) > 0) return false;
  return true;
}

/**
 * Find the appropriate patch definition for the given Antigravity version.
 * Returns null if no matching patch is found.
 */
export function findPatchForVersion(version: string): PatchDefinition | null {
  for (const patch of PATCH_REGISTRY) {
    if (versionInRange(version, patch)) {
      return patch;
    }
  }
  return null;
}

/**
 * Coarse binary signature inspection.
 *
 * Important: the live `language_server` binary currently uses the same URL
 * signature across all supported Antigravity families, so a positive match can
 * confirm that the binary is patchable, but it cannot reliably distinguish
 * between 2.1, 2.2, and 2.3 on its own.
 */
export interface BinarySignatureStatus {
  detected: boolean;
  state: 'original' | 'patched' | 'none';
}

export function inspectBinaryPatchSignature(binaryPath: string): BinarySignatureStatus {
  if (!fs.existsSync(binaryPath)) {
    return { detected: false, state: 'none' };
  }

  const buf = fs.readFileSync(binaryPath);
  const haystack = buf.toString('binary');
  const sample = PATCH_REGISTRY[0];
  const hasPatched = haystack.includes(sample.patchedUrl);
  const hasOriginal = haystack.includes(sample.originalUrl);

  if (hasPatched) return { detected: true, state: 'patched' };
  if (hasOriginal) return { detected: true, state: 'original' };
  return { detected: false, state: 'none' };
}

export interface OverlayFingerprintStatus {
  detected: boolean;
  range: PatchDefinition['versionRange'] | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  signals: string[];
}

function normalizeAsarEntry(entry: string): string {
  const normalized = entry.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function hasAsarEntry(entries: string[], entry: string): boolean {
  const wanted = normalizeAsarEntry(entry);
  return entries.includes(wanted);
}

function hasAsarPrefix(entries: string[], prefix: string): boolean {
  const wanted = normalizeAsarEntry(prefix).replace(/\/$/, '') + '/';
  return entries.some((entry) => entry.startsWith(wanted));
}

/**
 * Inspect the JS bundle footprint inside app.asar to distinguish 2.2 vs 2.3.
 *
 * Why this helps:
 * - 2.2.x still ships the `/dist/proxy/*` overlay tree in the JS bundle.
 * - 2.3.x removed that tree plus several helper modules from the stock asar.
 *
 * This is not used as the only signal, but it is a useful tiebreaker when the
 * binary URL signature is identical across families.
 */
export function inspectOverlayPatchFingerprint(installDir?: string): OverlayFingerprintStatus {
  const asarPath = getAppAsarPath(installDir);
  if (!asarPath || !fs.existsSync(asarPath)) {
    return {
      detected: false,
      range: null,
      confidence: 'low',
      reason: 'app.asar not found; JS overlay fingerprint unavailable.',
      signals: [],
    };
  }

  try {
    const asar = require('@electron/asar');
    const listFn = asar.listPackage ?? (asar.default as any)?.listPackage;
    if (typeof listFn !== 'function') {
      throw new Error('@electron/asar listPackage method is unavailable');
    }
    const entries: string[] = (listFn(asarPath) as string[]).map(normalizeAsarEntry);

    const hasProxyTree = hasAsarPrefix(entries, '/dist/proxy');
    const hasProxyModelLoader = hasAsarEntry(entries, '/dist/proxy/modelLoader.js');
    const hasProxyRegistry = hasAsarEntry(entries, '/dist/proxy/registry.js');
    const hasProxyRunner = hasAsarEntry(entries, '/proxy-runner.js');
    const hasCryptoStore = hasAsarEntry(entries, '/dist/cryptoStore.js');
    const hasCustomModelStore = hasAsarEntry(entries, '/dist/customModelStore.js');
    const hasSchemaValidator = hasAsarEntry(entries, '/dist/schemaValidator.js');

    const signals: string[] = [];
    if (hasProxyTree || hasProxyModelLoader || hasProxyRegistry) signals.push('proxy-tree-present');
    if (hasProxyRunner) signals.push('proxy-runner-present');
    if (!hasCryptoStore && !hasCustomModelStore && !hasSchemaValidator) {
      signals.push('overlay-helper-modules-missing');
    }

    if (hasProxyTree || hasProxyModelLoader || hasProxyRegistry) {
      return {
        detected: true,
        range: '2.2.0 - 2.2.x',
        confidence: hasProxyRunner ? 'high' : 'medium',
        reason: hasProxyRunner
          ? 'JS overlay fingerprint matches the 2.2 family: proxy tree and proxy-runner are present in app.asar.'
          : 'JS overlay fingerprint suggests the 2.2 family because the proxy tree is still present in app.asar.',
        signals,
      };
    }

    if (!hasProxyTree && !hasProxyRunner && !hasCryptoStore && !hasCustomModelStore && !hasSchemaValidator) {
      return {
        detected: true,
        range: '2.3.0+',
        confidence: 'high',
        reason: 'JS overlay fingerprint matches stock 2.3+: proxy tree, proxy-runner, and helper overlay modules are all absent from app.asar.',
        signals,
      };
    }

    if (!hasProxyTree && !hasProxyRunner) {
      return {
        detected: true,
        range: '2.3.0+',
        confidence: 'medium',
        reason: 'JS overlay fingerprint suggests the 2.3 family because the proxy tree is absent from app.asar.',
        signals,
      };
    }

    return {
      detected: false,
      range: null,
      confidence: 'low',
      reason: 'JS overlay fingerprint is inconclusive for this installation.',
      signals,
    };
  } catch (error) {
    return {
      detected: false,
      range: null,
      confidence: 'low',
      reason: `Failed to inspect app.asar for JS overlay fingerprint: ${(error as Error).message}`,
      signals: [],
    };
  }
}

export function detectAvailablePatches(binaryPath: string): PatchDefinition[] {
  if (!fs.existsSync(binaryPath)) {
    return [];
  }
  const buf = fs.readFileSync(binaryPath);
  const haystack = buf.toString('binary');
  return PATCH_REGISTRY.filter((patch) => haystack.includes(patch.originalUrl) || haystack.includes(patch.patchedUrl));
}

/**
 * Enhanced patch status with version-specific information.
 */
export interface VersionAwarePatchStatus extends PatchStatus {
  antigravityVersion: string | null;
  /** Source of the detected Antigravity version metadata. */
  antigravityVersionSource?: string;
  /** Patch range the UI should highlight / the user selected (after override resolution). */
  recommendedPatch: PatchDefinition | null;
  /** All patch definitions whose URL pattern is found in the live binary. */
  detectedPatches: PatchDefinition[];
  /** Generic binary evidence that the expected URL marker exists. */
  binarySignatureDetected?: boolean;
  /** Whether the binary still has the original URL or is already patched. */
  binarySignatureState?: 'original' | 'patched' | 'none';
  /** JS overlay footprint detected from app.asar to help distinguish 2.2 vs 2.3. */
  overlayFingerprintDetected?: boolean;
  overlayFingerprintRange?: string | null;
  overlayFingerprintConfidence?: 'high' | 'medium' | 'low';
  overlayFingerprintReason?: string;
  /** Confidence of the auto-detected recommendation. */
  detectionConfidence?: 'high' | 'medium' | 'low';
  /** Short explanation of how the recommendation was derived. */
  detectionReason?: string;
  compatible: boolean;
  warningMessage?: string;
  /** True when the recommended patch came from the user override, not auto-detection. */
  overrideActive?: boolean;
  /** Source of the recommended patch (for UI display). */
  recommendedSource?: 'auto' | 'override' | 'none';
  /** Override metadata (only present when overrideActive). */
  overrideInfo?: {
    range: string;
    reason: string | null;
    setAt: string | null;
  };
  /** All known ranges so the UI can render the version-selector cards. */
  availableRanges?: PatchDefinition[];
}

/**
 * Get version-aware patch status.
 * This checks the Antigravity version and determines the correct patch to use.
 *
 * Resolution order for `recommendedPatch`:
 *   1. If the user has set `patch.versionOverride` in config.json and that
 *      range is known, use it (marked `overrideActive=true`).
 *   2. Otherwise auto-detect from the binary and version.
 *   3. If neither works, return `null`.
 *
 * In all cases we ALSO return `availableRanges` so the UI can render the
 * version-selector cards, and `detectedPatches` so the UI can show which
 * ranges are actually present in the binary.
 */
function isReliableVersionSource(source: string): boolean {
  return source === 'asar' || source === 'product.json';
}

function isOverlayDistinguishablePatch(patch: PatchDefinition | null): boolean {
  return !!patch && (patch.versionRange === '2.2.0 - 2.2.x' || patch.versionRange === '2.3.0+');
}

function findPatchByRange(range: string | null | undefined): PatchDefinition | null {
  return range ? PATCH_REGISTRY.find((patch) => patch.versionRange === range) ?? null : null;
}

export function getVersionAwarePatchStatus(installDir?: string): VersionAwarePatchStatus {
  const binaryPath = getLanguageServerBinary(installDir);
  const backupPath = getLanguageServerBackup(installDir);
  const override = getPatchVersionOverride();

  const baseStatus: PatchStatus = {
    binaryPath: binaryPath ?? null,
    exists: binaryPath ? fs.existsSync(binaryPath) : false,
    applied: false,
    backupExists: backupPath ? fs.existsSync(backupPath) : false,
  };

  const availableRanges = PATCH_REGISTRY;

  if (!binaryPath || !baseStatus.exists) {
    return {
      ...baseStatus,
      antigravityVersion: null,
      antigravityVersionSource: 'unknown',
      recommendedPatch: null,
      detectedPatches: [],
      binarySignatureDetected: false,
      binarySignatureState: 'none',
      overlayFingerprintDetected: false,
      overlayFingerprintRange: null,
      overlayFingerprintConfidence: 'low',
      overlayFingerprintReason: 'app.asar not inspected because the language_server binary was not found',
      detectionConfidence: 'low',
      detectionReason: 'language_server binary not found',
      compatible: false,
      warningMessage: 'Language server binary not found',
      availableRanges,
      recommendedSource: 'none',
    };
  }

  const versionInfo = detectAntigravityVersion(installDir);
  const version = versionInfo?.version ?? 'unknown';
  const versionSource = versionInfo?.source ?? 'unknown';
  const reliableVersionSource = isReliableVersionSource(versionSource);
  const detectedPatches = detectAvailablePatches(binaryPath);
  const binarySignature = inspectBinaryPatchSignature(binaryPath);
  const overlayFingerprint = inspectOverlayPatchFingerprint(installDir);
  const autoRecommended = version !== 'unknown' ? findPatchForVersion(version) : null;
  const overlayRecommended = findPatchByRange(overlayFingerprint.range);

  let recommendedPatch: PatchDefinition | null = autoRecommended;
  let overrideActive = false;
  let recommendedSource: 'auto' | 'override' | 'none' = autoRecommended ? 'auto' : 'none';
  let overrideInfo: VersionAwarePatchStatus['overrideInfo'] | undefined;
  let detectionConfidence: 'high' | 'medium' | 'low' = 'low';
  let detectionReason = 'No reliable detection evidence found yet.';

  if (override.range) {
    const overridden = findPatchByRange(override.range);
    if (overridden) {
      recommendedPatch = overridden;
      overrideActive = true;
      recommendedSource = 'override';
      detectionConfidence = 'high';
      detectionReason = `Manual override selected ${override.range}.`;
      overrideInfo = {
        range: override.range,
        reason: override.reason,
        setAt: override.setAt,
      };
    }
  } else if (
    autoRecommended &&
    overlayRecommended &&
    isOverlayDistinguishablePatch(autoRecommended) &&
    isOverlayDistinguishablePatch(overlayRecommended)
  ) {
    if (autoRecommended.versionRange === overlayRecommended.versionRange) {
      recommendedPatch = autoRecommended;
      detectionConfidence = reliableVersionSource && overlayFingerprint.confidence === 'high' ? 'high' : 'medium';
      detectionReason = `Version ${version} detected from ${versionSource} and JS overlay fingerprint confirms ${overlayRecommended.versionRange}.`;
    } else if (reliableVersionSource) {
      recommendedPatch = autoRecommended;
      detectionConfidence = 'medium';
      detectionReason = `Version ${version} detected from ${versionSource}, but the JS overlay fingerprint suggests ${overlayRecommended.versionRange}. Metadata was kept because the version source is more reliable.`;
    } else {
      recommendedPatch = overlayRecommended;
      detectionConfidence = 'medium';
      detectionReason = `Version metadata from ${versionSource} suggested ${autoRecommended.versionRange}, but the JS overlay fingerprint more strongly matches ${overlayRecommended.versionRange}.`;
    }
  } else if (autoRecommended && binarySignature.detected) {
    detectionConfidence = reliableVersionSource ? 'high' : 'medium';
    detectionReason = `Version ${version} detected from ${versionSource} and confirmed by the binary URL signature.`;
  } else if (autoRecommended && overlayRecommended && overlayRecommended.versionRange === autoRecommended.versionRange) {
    detectionConfidence = reliableVersionSource && overlayFingerprint.confidence === 'high' ? 'medium' : 'low';
    detectionReason = `Version ${version} detected from ${versionSource}; the binary URL signature is absent, but the JS overlay fingerprint still matches ${overlayRecommended.versionRange}.`;
  } else if (autoRecommended) {
    detectionConfidence = reliableVersionSource ? 'medium' : 'low';
    detectionReason = `Version ${version} detected from ${versionSource}; binary signature was not found, so compatibility should be verified before patching.`;
  } else if (overlayRecommended) {
    recommendedPatch = overlayRecommended;
    recommendedSource = 'auto';
    detectionConfidence = binarySignature.detected && overlayFingerprint.confidence === 'high' ? 'medium' : 'low';
    detectionReason = overlayFingerprint.reason;
  } else if (binarySignature.detected) {
    detectionConfidence = 'low';
    detectionReason = 'Binary signature detected, but version metadata could not identify a specific patch family.';
  }

  const applied = binarySignature.state === 'patched';

  let compatible = true;
  let warningMessage: string | undefined;

  if (!recommendedPatch) {
    compatible = false;
    warningMessage =
      version === 'unknown'
        ? 'Cannot determine the Antigravity version automatically. Select a patch family manually.'
        : `No patch is registered for Antigravity ${version}. This version may not be supported yet.`;
  } else if (!binarySignature.detected && version !== 'unknown') {
    compatible = false;
    warningMessage = `Antigravity ${version} was detected from ${versionSource}, but the expected binary URL signature is missing. The language_server binary may belong to another build, may have already been modified, or may no longer match this installation.`;
  } else if (!binarySignature.detected) {
    compatible = false;
    warningMessage = 'The language_server binary does not expose the expected URL signature. Verify the installation before patching.';
  } else if (!overrideActive && version === 'unknown') {
    compatible = false;
    warningMessage = 'The binary looks patchable, but the installed Antigravity version is unknown. Select a family manually to continue safely.';
  }

  return {
    ...baseStatus,
    exists: true,
    applied,
    antigravityVersion: version,
    antigravityVersionSource: versionSource,
    recommendedPatch,
    detectedPatches,
    binarySignatureDetected: binarySignature.detected,
    binarySignatureState: binarySignature.state,
    overlayFingerprintDetected: overlayFingerprint.detected,
    overlayFingerprintRange: overlayFingerprint.range,
    overlayFingerprintConfidence: overlayFingerprint.confidence,
    overlayFingerprintReason: overlayFingerprint.reason,
    detectionConfidence,
    detectionReason,
    compatible,
    warningMessage,
    overrideActive,
    recommendedSource,
    overrideInfo,
    availableRanges,
    originalUrl: recommendedPatch?.originalUrl,
    patchedUrl: recommendedPatch?.patchedUrl,
  };
}

/**
 * Apply version-specific patch based on detected Antigravity version.
 * If a user override is set in config.json, that range is used instead of
 * the auto-detected one.
 */
export function applyVersionSpecificPatch(installDir?: string): { ok: boolean; message: string } {
  const status = getVersionAwarePatchStatus(installDir);

  if (!status.exists) {
    return { ok: false, message: 'Language server binary not found' };
  }

  if (!status.compatible) {
    return { ok: false, message: status.warningMessage ?? 'Incompatible version' };
  }

  if (!status.recommendedPatch) {
    return { ok: false, message: 'No patch available for this Antigravity version' };
  }

  const binaryPath = status.binaryPath!;
  const patch = status.recommendedPatch;
  const source = status.overrideActive ? 'user override' : 'auto-detect';

  // Check if already patched
  const buf = fs.readFileSync(binaryPath);
  const haystack = buf.toString('binary');

  if (haystack.includes(patch.patchedUrl)) {
    return {
      ok: true,
      message: `Already patched (${patch.versionRange}, source: ${source})`,
    };
  }

  // Find original URL
  const idx = haystack.indexOf(patch.originalUrl);
  if (idx === -1) {
    return {
      ok: false,
      message: `Original URL not found in binary. Expected: ${patch.originalUrl} (source: ${source})`,
    };
  }

  // Create backup
  const backupPath = binaryPath + '.bak';
  if (!fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(binaryPath, backupPath);
    } catch (e) {
      return { ok: false, message: `Failed to create backup: ${(e as Error).message}` };
    }
  }

  // Apply patch
  const target = Buffer.from(patch.patchedUrl, 'binary');
  const out = Buffer.from(buf);
  target.copy(out, idx);

  try {
    fs.writeFileSync(binaryPath, out);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EBUSY') {
      return {
        ok: false,
        message: 'language_server is running. Close Antigravity and retry.',
      };
    }
    return { ok: false, message: `Failed to write binary: ${err.message}` };
  }

  return {
    ok: true,
    message: `Patched with ${patch.description} (source: ${source}; backup at ${backupPath})`,
  };
}
