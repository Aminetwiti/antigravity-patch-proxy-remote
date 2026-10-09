import { describe, it, expect, beforeEach } from 'vitest';
import {
  thoughtSignatureCache,
  stateTimestamps,
  extractAndCacheThoughtSignatures,
  restoreThoughtSignatures,
  sanitizeUnsignedToolCalls,
  flattenAllToolCallsToText,
  markConvCorruptedSignatures,
  isConvCorruptedSignatures,
  clearThoughtSignaturesForConv,
} from '../proxy/shared';
import { sanitizeCandidatesInResponse } from '../proxy';

describe('thoughtSignature handling', () => {
  beforeEach(() => {
    thoughtSignatureCache.clear();
    stateTimestamps.thoughtSigs.clear();
  });

  describe('extractAndCacheThoughtSignatures', () => {
    it('extracts snake_case thought_signature from part', () => {
      const responseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'default_api:list_dir', args: { DirectoryPath: '/src' } },
                  thought_signature: 'sig_snake_123',
                },
              ],
            },
          },
        ],
      };

      extractAndCacheThoughtSignatures(responseData, 'conv-test-1');

      expect(thoughtSignatureCache.get('conv-test-1:default_api:list_dir')).toBe('sig_snake_123');
      expect(thoughtSignatureCache.get('default_api:list_dir')).toBe('sig_snake_123');
      expect(stateTimestamps.thoughtSigs.has('conv-test-1:default_api:list_dir')).toBe(true);
    });

    it('extracts camelCase thoughtSignature from part', () => {
      const responseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'run_command', args: { CommandLine: 'ls' } },
                  thoughtSignature: 'sig_camel_456',
                },
              ],
            },
          },
        ],
      };

      extractAndCacheThoughtSignatures(responseData, 'conv-test-2');

      expect(thoughtSignatureCache.get('conv-test-2:run_command')).toBe('sig_camel_456');
      expect(thoughtSignatureCache.get('run_command')).toBe('sig_camel_456');
    });

    it('extracts signature nested inside functionCall object', () => {
      const responseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'default_api:view_file',
                    args: {},
                    thought_signature: 'sig_nested_789',
                  },
                },
              ],
            },
          },
        ],
      };

      extractAndCacheThoughtSignatures(responseData, 'conv-test-3');

      expect(thoughtSignatureCache.get('conv-test-3:default_api:view_file')).toBe('sig_nested_789');
      expect(thoughtSignatureCache.get('default_api:view_file')).toBe('sig_nested_789');
    });

    it('handles empty or malformed data gracefully without throwing', () => {
      expect(() => extractAndCacheThoughtSignatures(null, 'conv-1')).not.toThrow();
      expect(() => extractAndCacheThoughtSignatures({}, 'conv-1')).not.toThrow();
      expect(() => extractAndCacheThoughtSignatures({ candidates: [] }, 'conv-1')).not.toThrow();
      expect(() => extractAndCacheThoughtSignatures({ candidates: [{}] }, 'conv-1')).not.toThrow();
      expect(thoughtSignatureCache.size).toBe(0);
    });
  });

  describe('restoreThoughtSignatures', () => {
    it('restores cached signature into functionCall part that is missing it', () => {
      thoughtSignatureCache.set('conv-test:default_api:list_dir', 'sig_cached_abc');

      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'default_api:list_dir',
                args: { DirectoryPath: '/app' },
              },
            },
          ],
        },
      ];

      const restored = restoreThoughtSignatures(contents, 'conv-test');

      expect(restored).toBe(true);
      const part = contents[0].parts[0] as any;
      expect(part.thought_signature).toBe('sig_cached_abc');
      expect(part.thoughtSignature).toBe('sig_cached_abc');
      expect(part.functionCall.thought_signature).toBeUndefined();
    });

    it('falls back to global function name when convId does not match', () => {
      thoughtSignatureCache.set('default_api:run_command', 'sig_global_xyz');

      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'default_api:run_command',
                args: { cmd: 'cat' },
              },
            },
          ],
        },
      ];

      const restored = restoreThoughtSignatures(contents, 'different-conv');

      expect(restored).toBe(true);
      const part = contents[0].parts[0] as any;
      expect(part.thought_signature).toBe('sig_global_xyz');
    });

    it('preserves existing thought_signature without overwriting', () => {
      thoughtSignatureCache.set('conv-test:custom_tool', 'sig_new');

      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: { name: 'custom_tool' },
              thought_signature: 'sig_existing_original',
            },
          ],
        },
      ];

      const restored = restoreThoughtSignatures(contents, 'conv-test');

      expect(restored).toBe(false);
      const part = contents[0].parts[0] as any;
      expect(part.thought_signature).toBe('sig_existing_original');
    });

    it('does not set thought_signature when cache has no entry (avoids INVALID_ARGUMENT)', () => {
      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'default_api:unknown_tool',
                args: {},
              },
            },
          ],
        },
      ];

      const restored = restoreThoughtSignatures(contents, 'conv-fresh');

      expect(restored).toBe(false);
      const part = contents[0].parts[0] as any;
      expect(part.thought_signature).toBeUndefined();
      expect(part.functionCall.thought_signature).toBeUndefined();
    });

    it('does nothing when parts have no functionCall', () => {
      const contents = [
        {
          role: 'user',
          parts: [{ text: 'Hello, what files are here?' }],
        },
      ];

      const restored = restoreThoughtSignatures(contents, 'conv-1');

      expect(restored).toBe(false);
      expect((contents[0].parts[0] as any).thought_signature).toBeUndefined();
    });
  });

  describe('sanitizeUnsignedToolCalls', () => {
    it('converts functionCall without thought_signature to text and pairs with functionResponse', () => {
      const contents = [
        {
          role: 'user',
          parts: [{ text: 'List files' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'run_command',
                args: { CommandLine: 'ls' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'run_command',
                response: { output: 'file1.txt\nfile2.txt' },
              },
            },
          ],
        },
      ];

      const modified = sanitizeUnsignedToolCalls(contents);
      expect(modified).toBe(true);

      // Model turn's functionCall is converted to text
      const modelPart = contents[1].parts[0] as any;
      expect(modelPart.functionCall).toBeUndefined();
      expect(modelPart.text).toContain('[Executed tool: run_command');
      expect(modelPart.text).toContain('ls');

      // User turn's functionResponse is converted to text
      const userPart = contents[2].parts[0] as any;
      expect(userPart.functionResponse).toBeUndefined();
      expect(userPart.text).toContain('[Tool run_command output:');
      expect(userPart.text).toContain('file1.txt');
    });

    it('preserves functionCall that has a valid thought_signature', () => {
      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'valid_tool',
                args: {},
              },
              thought_signature: 'valid_crypto_sig_123',
            },
          ],
        },
      ];

      const modified = sanitizeUnsignedToolCalls(contents);
      expect(modified).toBe(false);
      const modelPart = contents[0].parts[0] as any;
      expect(modelPart.functionCall).toBeDefined();
      expect(modelPart.thought_signature).toBe('valid_crypto_sig_123');
    });
  });

  describe('flattenAllToolCallsToText', () => {
    it('unconditionally flattens all functionCalls and functionResponses regardless of signatures', () => {
      const contents = [
        {
          role: 'model',
          parts: [
            {
              functionCall: { name: 'corrupted_tool', args: { x: 1 } },
              thought_signature: 'corrupted_bad_sig',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: { name: 'corrupted_tool', response: 'ok' },
            },
          ],
        },
      ];

      const modified = flattenAllToolCallsToText(contents);
      expect(modified).toBe(true);
      expect((contents[0].parts[0] as any).functionCall).toBeUndefined();
      expect((contents[0].parts[0] as any).thought_signature).toBeUndefined();
      expect((contents[0].parts[0] as any).text).toContain('[Executed tool: corrupted_tool');
      expect((contents[1].parts[0] as any).functionResponse).toBeUndefined();
      expect((contents[1].parts[0] as any).text).toContain('[Tool corrupted_tool output: ok]');
    });
  });

  describe('recovery of pseudo-tool text to real functionCall', () => {
    it('converts [Executed tool: run_command with arguments: {...}] to a real functionCall part', () => {
      const data = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: '[Executed tool: run_command with arguments: {"CommandLine":"node test.js"}]',
                },
              ],
            },
          },
        ],
      };

      const modified = sanitizeCandidatesInResponse(data);
      expect(modified).toBe(true);
      const part = (data.candidates[0].content.parts[0] as any);
      expect(part.functionCall).toBeDefined();
      expect(part.functionCall.name).toBe('run_command');
      expect(part.functionCall.args).toEqual({ CommandLine: 'node test.js' });
    });

    it('converts [Executed tool: view_file with arguments: ...] with unescaped Windows paths and colons', () => {
      // Simulate raw string with single Windows backslashes
      const rawText = '[Executed tool: default_api:view_file with arguments: {"AbsolutePath":"c:\\Users\\developer\\Downloads\\sample-project\\src\\Services\\Dispatch\\DriverGeoService.php","EndLine":175,"StartLine":140,"toolAction":"Checking GEORADIUS query results filtering","toolSummary":"Inspect DriverGeoService findNearbyDrivers"}]'
        .replace(/\\\\/g, '\\');

      const data = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: rawText }],
            },
          },
        ],
      };

      const modified = sanitizeCandidatesInResponse(data);
      expect(modified).toBe(true);
      const part = (data.candidates[0].content.parts[0] as any);
      expect(part.functionCall).toBeDefined();
      expect(part.functionCall.name).toBe('default_api:view_file');
      expect(part.functionCall.args.EndLine).toBe(175);
      expect(part.functionCall.args.AbsolutePath).toContain('DriverGeoService.php');
    });
  });

  describe('corrupted signature tracking and clearing', () => {
    it('marks conversation as corrupted and clears scoped signatures', () => {
      thoughtSignatureCache.set('conv-corrupted:tool1', 'sig1');
      thoughtSignatureCache.set('conv-corrupted:tool2', 'sig2');
      thoughtSignatureCache.set('conv-other:tool1', 'sig3');

      expect(isConvCorruptedSignatures('conv-corrupted')).toBe(false);

      markConvCorruptedSignatures('conv-corrupted');

      expect(isConvCorruptedSignatures('conv-corrupted')).toBe(true);
      expect(thoughtSignatureCache.has('conv-corrupted:tool1')).toBe(false);
      expect(thoughtSignatureCache.has('conv-corrupted:tool2')).toBe(false);
      expect(thoughtSignatureCache.get('conv-other:tool1')).toBe('sig3');
    });

    it('clearThoughtSignaturesForConv removes only matching convId entries', () => {
      thoughtSignatureCache.set('test-conv:funcA', 'sigA');
      thoughtSignatureCache.set('test-conv:__last__', 'sigLast');
      thoughtSignatureCache.set('unrelated:funcA', 'sigKeep');

      clearThoughtSignaturesForConv('test-conv');

      expect(thoughtSignatureCache.has('test-conv:funcA')).toBe(false);
      expect(thoughtSignatureCache.has('test-conv:__last__')).toBe(false);
      expect(thoughtSignatureCache.get('unrelated:funcA')).toBe('sigKeep');
    });
  });
});
