/**
 * Patch check — verifies the binary patch is applied.
 *
 * Also reports the state of the Antigravity IDE (v1.107.0+) cloud endpoint
 * override, so the doctor reflects the product the user actually runs.
 */
import type { CheckResult } from '../types';
import { getPatchStatus } from '../core/binary-patch';
import { getIdePatchStatus, IDE_PATCHED_ENDPOINT } from '../core/ide-patch';

export function checkPatch(): CheckResult {
  const status = getPatchStatus();
  const ide = getIdePatchStatus();

  if (!status.binaryPath) {
    return {
      id: 'patch',
      title: 'Binary patch',
      status: 'warn',
      message: 'Language server binary not found, skipping patch check',
      fixable: false,
    };
  }
  if (!status.exists) {
    return {
      id: 'patch',
      title: 'Binary patch',
      status: 'error',
      message: `Binary not found at ${status.binaryPath}`,
      fixable: false,
    };
  }
  if (status.applied) {
    // IDE not installed: classic check result unchanged.
    if (!ide.installDir) {
      return {
        id: 'patch',
        title: 'Binary patch',
        status: 'ok',
        message: 'Patched (Google URL → local proxy)',
        data: status,
      };
    }
    // IDE installed and patched: fully green.
    if (ide.applied) {
      return {
        id: 'patch',
        title: 'Binary patch',
        status: 'ok',
        message: `Patched (Google URL → local proxy) · IDE cloud endpoint → ${IDE_PATCHED_ENDPOINT}`,
        details: [
          'Classic 2.x binary patch: applied.',
          'Antigravity IDE (v1.107.0+) override: jetski.cloudCodeUrl is set, so the IDE language server routes through the local proxy.',
        ].join('\n'),
        data: status,
      };
    }
    // IDE installed but NOT patched: the app the user actually runs is
    // unpatched, so surface a warning (not an error).
    if (!ide.hasCustomValue) {
      return {
        id: 'patch',
        title: 'Binary patch',
        status: 'warn',
        message: 'Classic binary patched, but Antigravity IDE is NOT patched — custom models will not appear in the IDE',
        details:
          'Run `ag-doctor patch apply` (or `ag-doctor repair --yes`) to set the IDE cloud endpoint override.\n' +
          `Target: ${IDE_PATCHED_ENDPOINT} in ${ide.settingsPath ?? 'IDE User settings.json'}`,
        fixable: true,
        data: status,
      };
    }
    // IDE has a user-set override value: their choice, not our business.
    return {
      id: 'patch',
      title: 'Binary patch',
      status: 'ok',
      message: `Patched (Google URL → local proxy) · IDE uses custom cloud endpoint "${ide.currentValue}"`,
      data: status,
    };
  }
  return {
    id: 'patch',
    title: 'Binary patch',
    status: 'warn',
    message: 'Not applied — custom models will not appear in the chat dropdown',
    details: 'Run `ag-doctor patch apply` to apply the patch',
    fixable: true,
    data: status,
  };
}
