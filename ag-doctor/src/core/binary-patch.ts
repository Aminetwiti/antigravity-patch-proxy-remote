/**
 * Binary patch for the Antigravity language_server.
 *
 * Replaces the hardcoded URL `https://daily-cloudcode-pa.googleapis.com`
 * (41 bytes) with `http://${DEFAULT_BIND_HOST}:${DEFAULT_MITM_PORT}/v1internal/xxxxxxx` (41 bytes)
 * so that all Cloud Code calls are routed through the local proxy.
 *
 * A backup of the original binary is automatically created at <binary>.bak
 * before any modification.
 */
import fs from 'fs';
import { getLanguageServerBinary, getLanguageServerBackup } from './paths';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST } from './config';
import type { PatchStatus } from '../types';

export const ORIGINAL_URL = 'https://daily-cloudcode-pa.googleapis.com';
export const PATCHED_URL = `http://${DEFAULT_BIND_HOST}:${DEFAULT_MITM_PORT}/v1internal/xxxxxxx`;

if (ORIGINAL_URL.length !== PATCHED_URL.length) {
  throw new Error(
    `Internal error: ORIGINAL_URL (${ORIGINAL_URL.length}) and PATCHED_URL (${PATCHED_URL.length}) must be the same length`,
  );
}

/** Returns the current patch status of the language server binary. */
export function getPatchStatus(installDir?: string): PatchStatus {
  // Use version-aware patch detection
  const { getVersionAwarePatchStatus } = require('./version-specific-patch');
  const versionAwareStatus = getVersionAwarePatchStatus(installDir);
  
  // Return legacy PatchStatus format for backward compatibility
  return {
    binaryPath: versionAwareStatus.binaryPath,
    exists: versionAwareStatus.exists,
    applied: versionAwareStatus.applied,
    backupExists: versionAwareStatus.backupExists,
    originalUrl: versionAwareStatus.originalUrl ?? ORIGINAL_URL,
    patchedUrl: versionAwareStatus.patchedUrl ?? PATCHED_URL,
  };
}

/**
 * Apply the binary patch. Creates a backup first if it doesn't exist.
 * Returns true if the binary was modified, false if already patched.
 * Now uses version-aware patching to select the correct patch for the installed version.
 */
export function applyPatch(installDir?: string): { ok: boolean; message: string } {
  // Use version-aware patching
  const { applyVersionSpecificPatch } = require('./version-specific-patch');
  return applyVersionSpecificPatch(installDir);
}

/** Restore the language server binary from its .bak backup. */
export function restorePatch(installDir?: string): { ok: boolean; message: string } {
  const binaryPath = getLanguageServerBinary(installDir);
  const backupPath = getLanguageServerBackup(installDir);
  if (!binaryPath || !backupPath) {
    return { ok: false, message: 'Binary or backup path not found' };
  }
  if (!fs.existsSync(backupPath)) {
    return { ok: false, message: 'No backup file found' };
  }
  fs.copyFileSync(backupPath, binaryPath);
  return { ok: true, message: 'Restored from backup' };
}
