import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { fileURLToPath } from 'url';
import { FILE_DOWNLOAD_TIMEOUT_MS } from '../../../constants';
import type { GeminiRequestBody } from '../../core/types';
import { normalizeConversationTurns } from '../../../services/auth/googleAuth';

// --- Response Claimer for Hedged Requests -----------------------------------

export interface ResponseClaimer {
  claim(ownerId: string): boolean;
  isClaimed(): boolean;
  registerAbort(ownerId: string, abortFn: () => void): void;
  abortOthers(winnerId: string): void;
}

export function createResponseClaimer(): ResponseClaimer {
  let claimed = false;
  const abortMap = new Map<string, () => void>();
  return {
    claim(ownerId: string): boolean {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    isClaimed(): boolean {
      return claimed;
    },
    registerAbort(ownerId: string, fn: () => void): void {
      abortMap.set(ownerId, fn);
    },
    abortOthers(winnerId: string): void {
      for (const [id, fn] of abortMap.entries()) {
        if (id !== winnerId) {
          try { fn(); } catch (_) {}
        }
      }
    },
  };
}

// --- Conversation History Cascade Trimming ----------------------------------

export function trimOldestHistory(obj: any, maxKeep?: number): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const contents = obj.contents || obj.request?.contents;
  if (Array.isArray(contents) && contents.length > 4) {
    const first = contents[0];
    let keepCount = Math.max(3, Math.floor(contents.length * 0.7));
    if (typeof maxKeep === 'number' && maxKeep >= 3) {
      keepCount = Math.min(keepCount, maxKeep);
    }
    let sliceStart = contents.length - keepCount;
    // Ensure sliceStart does not split a functionCall / functionResponse pair
    if (sliceStart > 1 && sliceStart < contents.length) {
      const candidateTurn = contents[sliceStart];
      const hasFnResponse = Array.isArray(candidateTurn?.parts) && candidateTurn.parts.some((p: any) => p && p.functionResponse);
      if (hasFnResponse && sliceStart > 1) {
        sliceStart--;
      }
    }
    const trimmed = [first, ...contents.slice(sliceStart)];
    normalizeConversationTurns(trimmed);
    if (obj.contents) obj.contents = trimmed;
    if (obj.request?.contents) obj.request.contents = trimmed;
    return true;
  }
  return false;
}

// --- File Data Resolver ----------------------------------------------------

export async function resolveFileData(body: GeminiRequestBody, reqHeaders: Record<string, string | string[] | undefined>): Promise<void> {
  const contents = body.contents;
  if (!contents) return;
  const authHeader = (reqHeaders['authorization'] || reqHeaders['Authorization'] || '') as string;
  for (const item of contents) {
    if (!item.parts) continue;
    for (let i = 0; i < item.parts.length; i++) {
      const p = item.parts[i] as Record<string, unknown>;
      const fd = p.fileData as { mimeType?: string; fileUri?: string } | undefined;
      if (!fd?.fileUri) continue;
      if (fd.mimeType?.startsWith('image/')) continue;
      try {
        const uri = fd.fileUri;
        let fileContent = '';
        if (uri.startsWith('file://')) {
          try {
            const fp = fileURLToPath(uri);
            await fs.promises.access(fp);
            fileContent = await fs.promises.readFile(fp, 'utf-8');
          } catch {
            fileContent = '';
          }
        } else if (authHeader && uri.startsWith('https://')) {
          fileContent = await downloadFileContent(uri, authHeader);
        }
        if (fileContent) {
          (item.parts[i] as Record<string, unknown>) = { text: '[File content]:\n\n' + fileContent };
        }
      } catch (e) {
        throw new Error(`[Proxy] File resolve failed: ${(e as Error).message}`);
      }
    }
  }
}

export function downloadFileContent(url: string, authHeader: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: authHeader },
      timeout: FILE_DOWNLOAD_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let d = '';
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > 10 * 1024 * 1024) {
          reject(new Error('File too large'));
          res.destroy();
          return;
        }
        d += c.toString();
      });
      res.on('end', () => resolve(d));
    }).on('error', reject).end();
  });
}
