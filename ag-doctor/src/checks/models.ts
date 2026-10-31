/**
 * Custom models check — validates custom_models.json structure.
 */
import type { CheckResult } from '../types';
import {
  loadCustomModels,
  validateCustomModels,
  looksEncrypted,
  countLsEncryptedKeys,
} from '../core/custom-models';
import { getCustomModelsPath } from '../core/paths';
import fs from 'fs';

export function checkModels(): CheckResult {
  const path = getCustomModelsPath();
  if (!fs.existsSync(path)) {
    return {
      id: 'models',
      title: 'Custom models',
      status: 'info',
      message: 'No custom_models.json found (no models configured yet)',
      details: path,
      fixable: false,
    };
  }
  const file = loadCustomModels();
  const issues = validateCustomModels(file);
  const encrypted = looksEncrypted();
  if (issues.length > 0) {
    return {
      id: 'models',
      title: 'Custom models',
      status: 'error',
      message: `${issues.length} validation issue(s) in ${file.models.length} model(s)`,
      details: issues.map((i) => `  ${i.model}.${i.field}: ${i.message}`).join('\n'),
      fixable: false,
      data: { count: file.models.length, issues, encrypted },
    };
  }

  // Language-server-encrypted keys ("v10" format) cannot be decrypted by the
  // local proxy — the models would fail auth at runtime. Surface it as a warn
  // with actionable guidance (not an error: the config itself is valid).
  const lsKeys = countLsEncryptedKeys();
  if (lsKeys > 0) {
    return {
      id: 'models',
      title: 'Custom models',
      status: 'warn',
      message: `${file.models.length} model(s) configured — ${lsKeys} key(s) encrypted by the language server (v10 format)`,
      details: [
        'The language server stores API keys in its own encryption format that the',
        'local proxy cannot decrypt — requests for those models would fail auth.',
        'Re-enter the affected keys in a proxy-compatible format:',
        '  ag-doctor models rekey   (walks each affected model and asks for the key)',
      ].join('\n'),
      fixable: false,
      data: { count: file.models.length, encrypted, lsEncryptedKeys: lsKeys },
    };
  }

  return {
    id: 'models',
    title: 'Custom models',
    status: 'ok',
    message: `${file.models.length} model(s) configured${encrypted ? ' (encrypted)' : ''}`,
    data: { count: file.models.length, encrypted, models: file.models },
  };
}
