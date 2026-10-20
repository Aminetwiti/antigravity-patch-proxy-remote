import { describe, it, expect } from 'vitest';
import { parseWindowsCmdkeyTargets } from './credentials';

describe('ag-doctor credentials parser', () => {
  it('extracts targets matching gemini, antigravity, or agy', () => {
    const sampleOutput = `
Currently stored credentials:

    Target: LegacyGeneric:target=git:https://github.com
    Type: Generic
    User: personal-token

    Target: gemini:antigravity
    Type: Generic
    User: user@gmail.com

    Target: MicrosoftAccount:user=someone@live.com
    Type: Generic
    User: someone@live.com

    Target: Antigravity IDE OAuth
    Type: Generic
    User: oauth_user
`;

    const targets = parseWindowsCmdkeyTargets(sampleOutput);
    expect(targets).toEqual(['gemini:antigravity', 'Antigravity IDE OAuth']);
  });

  it('returns empty array when no matching targets are found', () => {
    const sampleOutput = `
Currently stored credentials:

    Target: LegacyGeneric:target=git:https://github.com
    Type: Generic
    User: git
`;

    const targets = parseWindowsCmdkeyTargets(sampleOutput);
    expect(targets).toEqual([]);
  });

  it('handles empty string gracefully', () => {
    expect(parseWindowsCmdkeyTargets('')).toEqual([]);
  });
});
