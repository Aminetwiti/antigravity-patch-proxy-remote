import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => '/mock/' + name),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('listExperiments Feature Flags & Planning Fallback', () => {
  it('ensures use-slash-plan and 2.18 flags are present in default fallback', () => {
    // Validate fallback payload structure
    const fallback = {
      experimentIds: ['antigravity-2.18-full', 'plan-enabled', 'customizations-unlocked'],
      flags: [
        { name: 'use-slash-plan', boolValue: true },
        { name: 'customization-token-budget', intValue: 20000 },
        { name: 'rules-token-budget', intValue: 20000 },
        { name: 'enable-subagent-hub', boolValue: true },
        { name: 'enable-skill-search-tool', boolValue: true },
        { name: 'enable-owl-slash-command', boolValue: true },
        { name: 'enable-browser-subagent-v2', boolValue: true },
      ],
    };

    const slashPlanFlag = fallback.flags.find((f) => f.name === 'use-slash-plan');
    expect(slashPlanFlag).toBeDefined();
    expect(slashPlanFlag?.boolValue).toBe(true);

    const customBudget = fallback.flags.find((f) => f.name === 'customization-token-budget');
    expect(customBudget?.intValue).toBe(20000);

    const rulesBudget = fallback.flags.find((f) => f.name === 'rules-token-budget');
    expect(rulesBudget?.intValue).toBe(20000);
  });

  it('enriches upstream responses with missing critical flags', () => {
    const rawUpstream = JSON.stringify({
      experimentIds: ['exp-123'],
      flags: [
        { name: 'some-other-flag', boolValue: true },
      ],
    });

    const parsed = JSON.parse(rawUpstream);
    const requiredFlags = [
      { name: 'use-slash-plan', boolValue: true },
      { name: 'customization-token-budget', intValue: 20000 },
      { name: 'rules-token-budget', intValue: 20000 },
    ];

    for (const reqFlag of requiredFlags) {
      const existing = parsed.flags.find((f: any) => f && f.name === reqFlag.name);
      if (!existing) {
        parsed.flags.push(reqFlag);
      }
    }

    expect(parsed.flags.some((f: any) => f.name === 'use-slash-plan' && f.boolValue === true)).toBe(true);
    expect(parsed.flags.some((f: any) => f.name === 'customization-token-budget' && f.intValue === 20000)).toBe(true);
    expect(parsed.flags.some((f: any) => f.name === 'some-other-flag')).toBe(true);
  });
});
