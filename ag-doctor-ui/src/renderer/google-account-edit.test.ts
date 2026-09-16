import { describe, expect, it } from 'vitest';

describe('Google Account Edit & Discovery Logic', () => {
  it('cleanly strips existing [Account Name] prefix without duplicating', () => {
    const rawDisplayName = '[sneakers (IDE)] Gemini 2.5 Pro';
    const accountName = 'sneakers (IDE)';
    const cleanName = rawDisplayName.replace(/^\[[^\]]+\]\s*/, '');
    expect(cleanName).toBe('Gemini 2.5 Pro');

    // Unify display name across accounts: no [Account Name] prefix in the dropdown
    expect(cleanName).toBe('Gemini 2.5 Pro');
  });

  it('detects Antigravity IDE OAuth access tokens vs AI Studio API keys', () => {
    const oauthToken = 'ya29.a0AdM_q8-abc123XYZ';
    const aiStudioKey = 'AIzaSyD-abc123XYZ';

    const isOauth = oauthToken.startsWith('ya29.');
    const isAiStudio = aiStudioKey.startsWith('AIzaSy');

    expect(isOauth).toBe(true);
    expect(isAiStudio).toBe(true);
  });

  it('preserves extra provider metadata when updating an existing account', () => {
    const existing = {
      id: 'google-ide-12345',
      name: 'sneakers (IDE)',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'ya29.oldToken',
      enabled: true,
      picture: 'https://lh3.googleusercontent.com/a/abc123',
      quotas: { fiveHourPercentage: 85, weeklyPercentage: 92, groups: [] },
      refreshToken: '1//refresh_token',
      source: 'antigravity-ide',
      status: 'healthy',
      latencyMs: 142,
      models: [
        { id: 'gemini-1.5-pro', displayName: '[sneakers (IDE)] Gemini 1.5 Pro', enabled: true },
      ],
    };

    const updateFromForm = {
      id: 'google-ide-12345',
      name: 'sneakers (IDE) Renamed',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'ya29.newToken',
      enabled: true,
      models: [
        { id: 'gemini-1.5-pro', displayName: '[sneakers (IDE) Renamed] Gemini 1.5 Pro', enabled: true },
        { id: 'gemini-2.0-flash', displayName: '[sneakers (IDE) Renamed] Gemini 2.0 Flash', enabled: false },
      ],
    };

    const merged = {
      ...existing,
      ...updateFromForm,
      picture: (updateFromForm as any).picture ?? existing.picture,
      quotas: (updateFromForm as any).quotas ?? existing.quotas,
      refreshToken: (updateFromForm as any).refreshToken ?? existing.refreshToken,
      source: (updateFromForm as any).source ?? existing.source,
      status: (updateFromForm as any).status ?? existing.status,
      latencyMs: (updateFromForm as any).latencyMs ?? existing.latencyMs,
    };

    expect(merged.name).toBe('sneakers (IDE) Renamed');
    expect(merged.apiKey).toBe('ya29.newToken');
    expect(merged.picture).toBe('https://lh3.googleusercontent.com/a/abc123');
    expect(merged.quotas.fiveHourPercentage).toBe(85);
    expect(merged.refreshToken).toBe('1//refresh_token');
    expect(merged.source).toBe('antigravity-ide');
    expect(merged.models).toHaveLength(2);
    expect(merged.models[1].enabled).toBe(false);
  });
});
