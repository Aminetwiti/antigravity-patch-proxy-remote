/**
 * Smart Context Trimmer for Antigravity Proxy
 * Optimizes request payload by removing duplicate content parts, trimming long history items,
 * and reducing overall token usage to prevent rate limits and improve latency.
 */

import { createHash } from 'crypto';
import log from 'electron-log';
import type { GeminiRequestBody } from '../../core/types';

const RECENT_TURNS_PRESERVE_COUNT = 8;
const MAX_HISTORICAL_TOOL_OUTPUT_CHARS = 4_096;

const SYNTHETIC_PROXY_ERROR_PATTERN =
  /> \*\*WARNING\*\*[\s\S]*Model unavailable|Le service Google Cloud Code a expiré sur \d+ comptes consécutifs|Google pool request timed out waiting for response headers|Google Cloud Code API gateway timeout \(504\) across/i;

function compactHistoricalString(val: string, headChars = 2000, tailChars = 800, threshold = MAX_HISTORICAL_TOOL_OUTPUT_CHARS): string {
  if (val.length <= threshold) return val;
  const head = val.slice(0, headChars);
  const tail = val.slice(-tailChars);
  const pruned = val.length - (headChars + tailChars);
  return `${head}\n\n... [Output truncated for context optimization (${pruned} chars pruned)] ...\n\n${tail}`;
}

export function trimContextPayload(body: GeminiRequestBody): GeminiRequestBody {
  if (!body || !body.request || !Array.isArray(body.request.contents)) {
    return body;
  }

  const originalContents = body.request.contents;
  const totalTurns = originalContents.length;
  let totalPartsBefore = 0;
  let totalPartsAfter = 0;
  let compactedBytesTotal = 0;

  const seenHashes = new Set<string>();

  const optimizedContents = originalContents.map((content, turnIndex) => {
    if (!content.parts || !Array.isArray(content.parts)) {
      return content;
    }

    totalPartsBefore += content.parts.length;

    const isHistoricalTurn =
      totalTurns > RECENT_TURNS_PRESERVE_COUNT &&
      turnIndex < totalTurns - RECENT_TURNS_PRESERVE_COUNT;

    const isUltraDeepHistory = totalTurns > 40 && turnIndex < totalTurns - 20;
    const isVeryDeepHistory = isUltraDeepHistory || (totalTurns > 20 && turnIndex < totalTurns - 10);
    const toolThreshold = isUltraDeepHistory ? 1_500 : (isVeryDeepHistory ? 2_048 : MAX_HISTORICAL_TOOL_OUTPUT_CHARS);
    const toolHead = isUltraDeepHistory ? 800 : (isVeryDeepHistory ? 1000 : 2000);
    const toolTail = isUltraDeepHistory ? 300 : (isVeryDeepHistory ? 400 : 800);
    const rawTextThreshold = isUltraDeepHistory ? 3_000 : (isVeryDeepHistory ? 4_000 : 8_000);
    const textHead = isUltraDeepHistory ? 800 : (isVeryDeepHistory ? 1000 : 1800);
    const textTail = isUltraDeepHistory ? 300 : (isVeryDeepHistory ? 400 : 700);

    // 1. Sanitize synthetic proxy error/warning cards and compact oversized historical outputs
    const compactedParts = content.parts.map((part) => {
      // Strip synthetic proxy error/warning cards that were saved into session history by previous failures
      if (
        part.text &&
        SYNTHETIC_PROXY_ERROR_PATTERN.test(part.text) &&
        !part.functionCall &&
        !part.functionResponse
      ) {
        log.info('[ContextTrimmer] Sanitized synthetic error warning card from turn');
        return {
          ...part,
          text: '[Previous step encountered a network timeout. Resuming task...]',
        };
      }

      if (!isHistoricalTurn) return part;

      // Compact oversized functionResponse outputs in historical turns
      if (part.functionResponse && part.functionResponse.response) {
        const resp = part.functionResponse.response;
        if (typeof resp === 'string' && resp.length > toolThreshold) {
          compactedBytesTotal += Math.max(0, resp.length - (toolHead + toolTail));
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              response: compactHistoricalString(resp, toolHead, toolTail, toolThreshold),
            },
          };
        }
        if (typeof resp === 'object' && resp !== null) {
          let modified = false;
          const clonedResp: Record<string, unknown> = { ...(resp as Record<string, unknown>) };
          for (const key of Object.keys(clonedResp)) {
            const fieldVal = clonedResp[key];
            if (typeof fieldVal === 'string' && fieldVal.length > toolThreshold) {
              compactedBytesTotal += Math.max(0, fieldVal.length - (toolHead + toolTail));
              clonedResp[key] = compactHistoricalString(fieldVal, toolHead, toolTail, toolThreshold);
              modified = true;
            }
          }
          if (modified) {
            return {
              ...part,
              functionResponse: {
                ...part.functionResponse,
                response: clonedResp,
              },
            };
          }
        }
      }

      // Compact oversized raw text blocks in historical turns (>8,000 chars, or >4,000 in very deep history)
      if (
        part.text &&
        part.text.length > rawTextThreshold &&
        !part.functionCall &&
        !(part as any).thought &&
        (part as any).type !== 'thinking'
      ) {
        compactedBytesTotal += Math.max(0, part.text.length - (textHead + textTail));
        return {
          ...part,
          text: compactHistoricalString(part.text, textHead, textTail, rawTextThreshold),
        };
      }

      return part;
    });

    // 2. Deduplicate redundant text parts
    const uniqueParts = compactedParts.filter((part) => {
      // Never dedup function calls/responses — each one is a distinct agent action
      if (part.functionCall || part.functionResponse) return true;
      // Never dedup thought/thinking parts
      if ((part as any).thought || (part as any).type === 'thinking') return true;
      if (!part.text) return true;

      // ponytail: only dedup pure-text parts in turns that have NO function ops.
      // Turns with functionCall/functionResponse often repeat tool output text
      // (e.g. same list_dir result) — deduping those makes the model lose context
      // and loop infinitely calling the same tool.
      const hasFunctionOps = compactedParts.some(
        (p) => p.functionCall || p.functionResponse
      );
      if (hasFunctionOps) return true;

      // Hash full text representation of text blocks (>100 chars) using SHA-256 to avoid collisions
      if (part.text.length > 100) {
        const hash = createHash('sha256').update(part.text).digest('hex');
        if (seenHashes.has(hash)) {
          return false; // Deduplicate redundant file context injections
        }
        seenHashes.add(hash);
      }
      return true;
    });

    // Safety guard: Google Cloud Code / Gemini API strictly requires parts.length >= 1.
    // If all parts in this turn were deduplicated, preserve at least the first original part.
    const safeParts = uniqueParts.length > 0 ? uniqueParts : (content.parts.length > 0 ? [content.parts[0]] : content.parts);

    totalPartsAfter += safeParts.length;

    return {
      ...content,
      parts: safeParts,
    };
  });

  if (totalPartsBefore > totalPartsAfter || compactedBytesTotal > 0) {
    const partsDiff = totalPartsBefore - totalPartsAfter;
    log.info(`[ContextTrimmer] Optimized payload: ${partsDiff} duplicate parts removed, ${Math.round(compactedBytesTotal / 1024)} KB oversized historical outputs compacted`);
  }

  return {
    ...body,
    request: {
      ...body.request,
      contents: optimizedContents,
    },
  };
}
