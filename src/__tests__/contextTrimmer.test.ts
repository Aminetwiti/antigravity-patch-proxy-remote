import { describe, it, expect, vi } from 'vitest';
import { trimContextPayload } from '../proxy/contextTrimmer';
import type { GeminiRequestBody } from '../proxy/types';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ContextTrimmer (AUDIT-002 Regression & Collision Prevention)', () => {
  it('deduplicates identical text blocks exceeding 100 characters in turns without function ops', () => {
    const textChunk = 'A'.repeat(150);
    const body: GeminiRequestBody = {
      request: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: textChunk },
              { text: textChunk },
            ],
          },
        ],
      },
    };

    const trimmed = trimContextPayload(body);
    expect(trimmed.request?.contents?.[0].parts).toHaveLength(1);
    expect(trimmed.request?.contents?.[0].parts[0].text).toBe(textChunk);
  });

  it('does NOT drop distinct text blocks that share identical 50-char prefix, 50-char suffix, and length', () => {
    const prefix = 'COMMON_BOILERPLATE_PREFIX_HEADER_1234567890_START_'; // 50 chars
    const suffix = '_END_COMMON_BOILERPLATE_SUFFIX_FOOTER_1234567890'; // 48 chars
    const distinctMiddle1 = '_DIFFERENT_LOGIC_BRANCH_A_';
    const distinctMiddle2 = '_DIFFERENT_LOGIC_BRANCH_B_';

    const text1 = `${prefix}${distinctMiddle1}${suffix}`;
    const text2 = `${prefix}${distinctMiddle2}${suffix}`;
    expect(text1.length).toBe(text2.length);
    expect(text1).not.toBe(text2);

    const body: GeminiRequestBody = {
      request: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: text1 },
              { text: text2 },
            ],
          },
        ],
      },
    };

    const trimmed = trimContextPayload(body);
    expect(trimmed.request?.contents?.[0].parts).toHaveLength(2);
    expect(trimmed.request?.contents?.[0].parts[0].text).toBe(text1);
    expect(trimmed.request?.contents?.[0].parts[1].text).toBe(text2);
  });

  it('never deduplicates turns with functionCall or functionResponse', () => {
    const textChunk = 'REPEAT_LOGS_OUTPUT_'.repeat(10);
    const body: GeminiRequestBody = {
      request: {
        contents: [
          {
            role: 'model',
            parts: [
              { text: textChunk },
              { functionCall: { name: 'run_command', args: { cmd: 'dir' } } },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'run_command', response: { output: textChunk } } },
              { text: textChunk },
            ],
          },
        ],
      },
    };

    const trimmed = trimContextPayload(body);
    expect(trimmed.request?.contents?.[0].parts).toHaveLength(2);
    expect(trimmed.request?.contents?.[1].parts).toHaveLength(2);
  });

  it('never deduplicates thought or thinking parts', () => {
    const thoughtText = 'Thinking step '.repeat(20);
    const body: GeminiRequestBody = {
      request: {
        contents: [
          {
            role: 'model',
            parts: [
              { text: thoughtText, thought: true } as any,
              { text: thoughtText, type: 'thinking' } as any,
            ],
          },
        ],
      },
    };

    const trimmed = trimContextPayload(body);
    expect(trimmed.request?.contents?.[0].parts).toHaveLength(2);
  });

  it('guarantees that a turn never has an empty parts array when all parts are duplicates (HTTP 400 prevention)', () => {
    const textChunk = 'REPEATED_PROMPT_CONTENT_'.repeat(10);
    const body: GeminiRequestBody = {
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: textChunk }],
          },
          {
            role: 'model',
            parts: [{ text: 'Response' }],
          },
          {
            role: 'user',
            parts: [{ text: textChunk }], // exact duplicate in turn 3
          },
        ],
      },
    };

    const trimmed = trimContextPayload(body);
    // Turn 1 retains the textChunk
    expect(trimmed.request?.contents?.[0].parts).toHaveLength(1);
    // Turn 3 was 100% duplicate, but parts must NOT be empty to avoid HTTP 400
    expect(trimmed.request?.contents?.[2].parts).toHaveLength(1);
    expect(trimmed.request?.contents?.[2].parts[0].text).toBe(textChunk);
  });

  it('compacts oversized tool outputs (>16,384 chars) in historical turns while preserving recent turns intact', () => {
    const hugeOutput = 'X'.repeat(25_000);

    // Create a 12-turn conversation: turn 0 is historical, turn 11 is recent
    const contents = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      parts: [
        {
          functionResponse: {
            name: 'read_file',
            response: { output: hugeOutput },
          },
        },
      ],
    }));

    const body: GeminiRequestBody = {
      request: { contents },
    };

    const trimmed = trimContextPayload(body);
    const historicalTurn = trimmed.request?.contents?.[0];
    const recentTurn = trimmed.request?.contents?.[11];

    // Turn 0 (historical): output must be compacted down to ~2800 chars + marker
    const historicalOutput = (historicalTurn?.parts?.[0]?.functionResponse?.response as any)?.output;
    expect(historicalOutput.length).toBeLessThan(3500);
    expect(historicalOutput).toContain('Output truncated for context optimization');
    expect(historicalOutput.startsWith('X'.repeat(2000))).toBe(true);
    expect(historicalOutput.endsWith('X'.repeat(800))).toBe(true);

    // Turn 11 (recent): output must remain 100% intact (25,000 chars)
    const recentOutput = (recentTurn?.parts?.[0]?.functionResponse?.response as any)?.output;
    expect(recentOutput.length).toBe(25_000);
    expect(recentOutput).toBe(hugeOutput);
  });
});
