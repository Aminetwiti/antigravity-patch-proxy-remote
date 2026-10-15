import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { matchesCustomModel } from '../proxy';
import { generateModelPlaceholderId } from '../proxy/idGenerator';
import type { CustomModel } from '../proxy/types';

describe('Diagnostic Audit - Placeholder M50 and M563 Matching', () => {
  it('inspects which models match MODEL_PLACEHOLDER_M50', () => {
    const customModelsPath = 'C:/Users/amine/.gemini/antigravity/custom_models.json';
    if (!fs.existsSync(customModelsPath)) return;

    const raw = JSON.parse(fs.readFileSync(customModelsPath, 'utf-8'));
    const matchedModels: string[] = [];

    for (const p of raw.providers || []) {
      for (const m of (p.models || [])) {
        const cm: CustomModel = {
          provider: p.provider,
          apiUrl: p.apiUrl,
          externalModelName: m.id,
          displayName: m.displayName,
          name: m.id,
        };
        if (matchesCustomModel(cm, 'models/MODEL_PLACEHOLDER_M50')) {
          matchedModels.push(`Provider model: ${m.id} (${m.displayName})`);
        }
      }
      for (const a of (p.accounts || [])) {
        for (const m of (a.models || [])) {
          const cm: CustomModel = {
            provider: p.provider,
            apiUrl: p.apiUrl,
            externalModelName: m.id,
            displayName: m.displayName,
            name: m.id,
            accountEmail: a.email,
            accountName: a.name,
          };
          if (matchesCustomModel(cm, 'models/MODEL_PLACEHOLDER_M50')) {
            matchedModels.push(`Account ${a.email}: ${m.id} (${m.displayName})`);
          }
        }
      }
    }

    console.log('--- Matched models for MODEL_PLACEHOLDER_M50 ---', matchedModels.length, matchedModels.slice(0, 5));
  });
});
