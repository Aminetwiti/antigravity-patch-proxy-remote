/**
 * Smart Context Trimmer for Antigravity Proxy
 * Optimizes request payload by removing duplicate content parts, trimming long history items,
 * and reducing overall token usage to prevent rate limits and improve latency.
 */

import log from 'electron-log';
import type { GeminiRequestBody } from './types';

export function trimContextPayload(body: GeminiRequestBody): GeminiRequestBody {
  if (!body || !body.request || !Array.isArray(body.request.contents)) {
    return body;
  }

  const originalContents = body.request.contents;
  let totalPartsBefore = 0;
  let totalPartsAfter = 0;

  const seenHashes = new Set<string>();

  const optimizedContents = originalContents.map((content) => {
    if (!content.parts || !Array.isArray(content.parts)) {
      return content;
    }

    totalPartsBefore += content.parts.length;

    const uniqueParts = content.parts.filter((part) => {
      // Never dedup function calls/responses — each one is a distinct agent action
      if (part.functionCall || part.functionResponse) return true;
      // Never dedup thought/thinking parts
      if ((part as any).thought || (part as any).type === 'thinking') return true;
      if (!part.text) return true;

      // ponytail: only dedup pure-text parts in turns that have NO function ops.
      // Turns with functionCall/functionResponse often repeat tool output text
      // (e.g. same list_dir result) — deduping those makes the model lose context
      // and loop infinitely calling the same tool.
      const hasFunctionOps = content.parts.some(
        (p) => p.functionCall || p.functionResponse
      );
      if (hasFunctionOps) return true;

      // Hash short string representations of text blocks (>100 chars)
      if (part.text.length > 100) {
        const sampleKey = `${part.text.substring(0, 50)}_${part.text.length}_${part.text.substring(part.text.length - 50)}`;
        if (seenHashes.has(sampleKey)) {
          return false; // Deduplicate redundant file context injections
        }
        seenHashes.add(sampleKey);
      }
      return true;
    });

    totalPartsAfter += uniqueParts.length;

    return {
      ...content,
      parts: uniqueParts,
    };
  });

  if (totalPartsBefore > totalPartsAfter) {
    log.info(`[ContextTrimmer] Trimmed ${totalPartsBefore - totalPartsAfter} redundant parts from payload (Saved ~${Math.round(((totalPartsBefore - totalPartsAfter) / totalPartsBefore) * 100)}% prompt context)`);
  }

  return {
    ...body,
    request: {
      ...body.request,
      contents: optimizedContents,
    },
  };
}
