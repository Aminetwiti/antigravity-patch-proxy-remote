/**
 * `ag-doctor patch status` — show detailed version-aware patch status.
 */
import type { CommandContext } from '../../types';
import fs from 'fs';
import { info, ok, warn, error } from '../../cli/output';
import { getVersionAwarePatchStatus } from '../../core/version-specific-patch';
import { validateAsar } from './validate-asar';

export async function runPatchStatus(ctx: CommandContext): Promise<number> {
  const status = getVersionAwarePatchStatus();

  // If --json flag is present, output JSON and return
  if (ctx.json) {
    // Phase A.3 — run the asar preflight on the live archive so the UI can
    // surface the verdict (ok / warn / block) and the size delta.
    let validateReport: ReturnType<typeof validateAsar> | null = null;
    let verdict: string | null = null;
    try {
      // Lazy require to avoid a circular dep at module load time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAsarPath } = require('../../core/asar-integrity');
      const liveAsar = getAsarPath() as string | null;
      if (liveAsar && fs.existsSync(liveAsar)) {
        validateReport = validateAsar(liveAsar, liveAsar);
        verdict = validateReport.verdict;
      }
    } catch {
      // Validation is best-effort; missing dependency ⇒ verdict stays null.
    }
    const jsonOutput = {
      antigravityVersion: status.antigravityVersion,
      antigravityVersionSource: status.antigravityVersionSource ?? 'unknown',
      binaryPath: status.binaryPath,
      exists: status.exists,
      applied: status.applied,
      backupExists: status.backupExists,
      compatible: status.compatible,
      warningMessage: status.warningMessage,
      recommendedPatch: status.recommendedPatch ? {
        versionRange: status.recommendedPatch.versionRange,
        description: status.recommendedPatch.description,
        originalUrl: status.recommendedPatch.originalUrl,
        patchedUrl: status.recommendedPatch.patchedUrl,
      } : null,
      detectedPatches: status.detectedPatches.map(p => ({
        versionRange: p.versionRange,
        description: p.description,
        originalUrl: p.originalUrl,
        patchedUrl: p.patchedUrl,
      })),
      binarySignatureDetected: status.binarySignatureDetected ?? false,
      binarySignatureState: status.binarySignatureState ?? 'none',
      overlayFingerprintDetected: status.overlayFingerprintDetected ?? false,
      overlayFingerprintRange: status.overlayFingerprintRange ?? null,
      overlayFingerprintConfidence: status.overlayFingerprintConfidence ?? 'low',
      overlayFingerprintReason: status.overlayFingerprintReason ?? null,
      detectionConfidence: status.detectionConfidence ?? 'low',
      detectionReason: status.detectionReason ?? null,
      deltaSizeBytes: validateReport?.deltaSizeBytes ?? null,
      verdict,
      validateAsarReport: validateReport,
      overrideActive: status.overrideActive ?? false,
      recommendedSource: status.recommendedSource ?? 'auto',
      overrideInfo: status.overrideInfo ?? null,
      availableRanges: (status.availableRanges ?? []).map(p => ({
        versionRange: p.versionRange,
        description: p.description,
        originalUrl: p.originalUrl,
        patchedUrl: p.patchedUrl,
      })),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return status.compatible ? 0 : 1;
  }

  // Text output (existing code)
  // Display Antigravity version
  info(`Antigravity Version: ${status.antigravityVersion ?? 'unknown'}`);
  console.log('');

  // Display binary info
  if (!status.exists) {
    error('Language server binary not found');
    if (status.binaryPath) {
      info(`Expected at: ${status.binaryPath}`);
    }
    return 1;
  }

  ok(`Binary found: ${status.binaryPath}`);
  info(`Backup exists: ${status.backupExists ? 'yes' : 'no'}`);
  console.log('');

  // Display compatibility status
  if (status.compatible) {
    ok('Version is compatible with available patches');
  } else {
    error('Version compatibility issue detected');
    if (status.warningMessage) {
      warn(status.warningMessage);
    }
  }
  console.log('');

  // Display recommended patch
  if (status.recommendedPatch) {
    info('Recommended Patch:');
    console.log(`  Version Range: ${status.recommendedPatch.versionRange}`);
    console.log(`  Description: ${status.recommendedPatch.description}`);
    console.log(`  Original URL: ${status.recommendedPatch.originalUrl}`);
    console.log(`  Patched URL:  ${status.recommendedPatch.patchedUrl}`);
    console.log(`  Source:       ${status.overrideActive ? 'manual override' : 'auto-detect'}`);
    if (status.overrideInfo?.reason) {
      console.log(`  Reason:       ${status.overrideInfo.reason}`);
    }
  } else {
    warn('No recommended patch found for this version');
  }
  console.log('');

  // Display detected patches in binary
  if (status.detectedPatches.length > 0) {
    info('Detected URL patterns in binary:');
    for (const patch of status.detectedPatches) {
      console.log(`  • ${patch.versionRange}: ${patch.originalUrl}`);
    }
  } else {
    if (status.applied) {
      // A successfully patched binary no longer contains any known ORIGINAL URL
      // — the patch replaced it with the local proxy redirect. Report the
      // patched state instead of a false "no patterns" alarm.
      info('Detected patched URL pattern in binary (original URL replaced by the proxy redirect)');
    } else {
      warn('No known URL patterns detected in binary');
      warn('This may indicate a new Antigravity version that requires patch definition update');
    }
  }
  if (status.overlayFingerprintDetected) {
    info('Detected JS overlay fingerprint:');
    console.log(`  Family:      ${status.overlayFingerprintRange}`);
    console.log(`  Confidence:  ${status.overlayFingerprintConfidence}`);
    console.log(`  Why:         ${status.overlayFingerprintReason}`);
  }
  console.log('');

  // Display patch application status
  if (status.applied) {
    ok('Patch is currently applied');
  } else {
    warn('Patch is not applied');
    if (status.compatible && status.recommendedPatch) {
      info('Run `ag-doctor patch apply` to apply the patch');
    }
  }

  return status.compatible ? 0 : 1;
}
