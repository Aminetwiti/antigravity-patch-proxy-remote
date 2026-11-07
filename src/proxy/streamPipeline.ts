import * as http from 'http';
import * as zlib from 'zlib';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import log from 'electron-log';
import { STREAM_IDLE_TIMEOUT_MS } from '../constants';
import { safeWriteHead, safeEnd } from './httpUtils';
import { IdleTimeoutGuard } from './idleTimeout';
import { extractAndCacheThoughtSignatures, ANTI_HALLUCINATION_TOOL_INSTRUCTION } from './shared';
import { classifyError, ErrorDiagnostic, ErrorType } from './errorClassifier';
import type { CustomModel } from './types';
import { logTokenUsageEvent } from './remoteState';

// ─── Proxy Error Diagnostics & Markdown ──────────────────────────────────────

export function generateGracefulMarkdown(diagnostic: ErrorDiagnostic, model?: CustomModel): string {
  const alertType = diagnostic.severity === 'warning' ? 'WARNING' : 'CAUTION';
  const rawTitle = diagnostic.title.replace(/^Model unavailable:\s*/i, '');
  const title = `Model unavailable: ${rawTitle}`;

  let md = `> [!${alertType}]\n`;
  md += `> **${title}**\n>\n`;
  if (model) {
    const modelName = model.displayName || model.name;
    const providerStr = model.provider ? ` · **Provider:** \`${model.provider}\`` : '';
    md += `> **Model:** \`${modelName}\`${providerStr}\n>\n`;
  }
  md += `> ${diagnostic.message}\n`;

  if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
    md += `>\n> **Suggested Actions:**\n`;
    diagnostic.suggestions.forEach((s) => {
      md += `> - ${s}\n`;
    });
  }

  if (diagnostic.actionUrl) {
    md += `>\n> 🔗 [Manage Billing & Credits](${diagnostic.actionUrl})\n`;
  }

  md += `\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
  return md;
}

// ─── Proxy Error Emitter ──────────────────────────────────────────────────

export type ProxyErrorPayload = {
  traceId: string;
  provider: string;
  status?: number;
  errorType: ErrorType;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
};

export type ProxyErrorEmitter = (p: ProxyErrorPayload) => void;

let proxyErrorEmitter: ProxyErrorEmitter | null = null;

export function setProxyErrorEmitter(fn: ProxyErrorEmitter | null): void {
  proxyErrorEmitter = fn;
}

export function emitProxyError(p: ProxyErrorPayload): void {
  if (proxyErrorEmitter) proxyErrorEmitter(p);
  try {
    process.stderr.write(JSON.stringify(p) + '\n');
  } catch {
    // stdio might be closed in unit tests — swallow.
  }
}

export function buildProxyErrorPayload(
  traceId: string,
  status: number | undefined,
  bodyOrErr: unknown,
  provider: string | undefined,
  fallbackMessage?: string,
): ProxyErrorPayload {
  const rawText =
    typeof bodyOrErr === 'string'
      ? bodyOrErr
      : bodyOrErr instanceof Error
        ? bodyOrErr.message
        : fallbackMessage ?? '';
  const diagnostic = classifyError(status, bodyOrErr, typeof bodyOrErr === 'string' ? bodyOrErr : undefined, provider);
  return {
    traceId,
    provider: provider ?? 'unknown',
    status,
    errorType: diagnostic.errorType,
    rawError: rawText,
    title: diagnostic.title,
    message: diagnostic.message,
    suggestions: diagnostic.suggestions ?? [],
    actionUrl: diagnostic.actionUrl,
  };
}

// ─── Graceful Error Responders ─────────────────────────────────────────────

export function sendGracefulStreamError(res: http.ServerResponse, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (res.writableEnded) return;
  const errResponse = {
    response: {
      candidates: [
        {
          content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
    },
    traceId: '',
    metadata: {},
    _agDiagnostic: diagnostic,
  };
  sanitizeCandidatesInResponse(errResponse);
  if (!res.headersSent) {
    safeWriteHead(res, 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-AG-Error-Type': diagnostic.errorType,
    });
  }
  writeSafeSseChunk(res, errResponse);
  safeEnd(res);
}

export function sendGracefulNonStreamError(res: http.ServerResponse, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (res.writableEnded) return;
  const errResponse = {
    response: {
      candidates: [
        {
          content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
    },
    traceId: '',
    metadata: {},
    _agDiagnostic: diagnostic,
  };
  sanitizeCandidatesInResponse(errResponse);
  if (!res.headersSent) {
    safeWriteHead(res, 200, {
      'Content-Type': 'application/json',
      'X-AG-Error-Type': diagnostic.errorType,
    });
  }
  safeEnd(res, JSON.stringify(errResponse));
}

export function sendGracefulError(res: http.ServerResponse, isStream: boolean, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (isStream) {
    sendGracefulStreamError(res, diagnostic, model);
  } else {
    sendGracefulNonStreamError(res, diagnostic, model);
  }
}

// ─── Balanced JSON & Pseudo-tool Extractors ─────────────────────────────────

export function parseBalancedJson(str: string, startIdx: number): { json: string; endIdx: number } | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonStart = -1;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (jsonStart === -1) {
      if (ch === '{' || ch === '[') {
        jsonStart = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return { json: str.slice(jsonStart, i + 1), endIdx: i + 1 };
      }
    }
  }
  return null;
}

export function extractAllPseudoToolCalls(text: string): Array<{ fnName: string; args: any; fullMatch: string; startIdx: number; endIdx: number }> {
  const results: Array<{ fnName: string; args: any; fullMatch: string; startIdx: number; endIdx: number }> = [];
  const marker = '[Executed tool:';
  let cursor = 0;

  while (cursor < text.length) {
    const startIdx = text.indexOf(marker, cursor);
    if (startIdx === -1) break;

    const afterMarker = text.slice(startIdx + marker.length);
    const closeBracketIdx = afterMarker.indexOf(']');
    const withArgsIdx = afterMarker.indexOf('with arguments:');

    // Case 1: Zero-argument tool call [Executed tool: tool_name]
    if (closeBracketIdx !== -1 && (withArgsIdx === -1 || closeBracketIdx < withArgsIdx)) {
      const potentialFn = afterMarker.slice(0, closeBracketIdx).trim();
      if (/^[a-zA-Z0-9_\-\.:]+$/.test(potentialFn)) {
        const fullEndIdx = startIdx + marker.length + closeBracketIdx + 1;
        results.push({
          fnName: potentialFn,
          args: {},
          fullMatch: text.slice(startIdx, fullEndIdx),
          startIdx,
          endIdx: fullEndIdx,
        });
        cursor = fullEndIdx;
        continue;
      }
    }

    // Case 2: Tool call with arguments
    if (withArgsIdx === -1) {
      cursor = startIdx + marker.length;
      continue;
    }

    const fnName = afterMarker.slice(0, withArgsIdx).trim();
    if (!/^[a-zA-Z0-9_\-\.:]+$/.test(fnName)) {
      cursor = startIdx + marker.length;
      continue;
    }
    const argsStartInText = startIdx + marker.length + withArgsIdx + 'with arguments:'.length;

    const parsedJson = parseBalancedJson(text, argsStartInText);
    if (!parsedJson) {
      cursor = startIdx + marker.length;
      continue;
    }

    const remainder = text.slice(parsedJson.endIdx);
    const closeBracketMatch = remainder.match(/^\s*\]/);
    if (!closeBracketMatch) {
      cursor = parsedJson.endIdx;
      continue;
    }

    const fullEndIdx = parsedJson.endIdx + closeBracketMatch[0].length;
    const fullMatch = text.slice(startIdx, fullEndIdx);

    let parsedArgs: any = null;
    try {
      parsedArgs = JSON.parse(parsedJson.json);
    } catch (_) {
      try {
        const normalized = parsedJson.json.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) => {
          const fixed = inner
            .replace(/\r?\n/g, '\\n')
            .replace(/\t/g, '\\t')
            .replace(/\\([^\\"])/g, (match: string, char: string) => {
              if (['"', '\\', '/'].includes(char)) return match;
              return '\\\\' + char;
            });
          return '"' + fixed + '"';
        });
        parsedArgs = JSON.parse(normalized);
      } catch (_) {
        try {
          parsedArgs = JSON.parse(parsedJson.json.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\'));
        } catch (_) {
          parsedArgs = null;
        }
      }
    }

    if (parsedArgs !== null && typeof parsedArgs === 'object') {
      results.push({
        fnName,
        args: parsedArgs,
        fullMatch,
        startIdx,
        endIdx: fullEndIdx,
      });
      cursor = fullEndIdx;
    } else {
      cursor = fullEndIdx;
    }
  }
  return results;
}

import { SYNTHETIC_TOOL_NAME } from '../services/googleAuth';

// ─── Candidate Sanitization & Crash Protection ──────────────────────────────

export function sanitizeCandidatesInResponse(data: any): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  let modified = false;

  // 1. Antigravity Language Server crash protection:
  // In codeassistclient.(*CodeAssistClient).getStreamingTextCompletion-range1 at generation.go:673,
  // the Go language server unmarshals v1internal_prediction_service_go_proto.GenerateContentResponse
  // and accesses resp.Response.UsageMetadata at offset 0x50 without checking if resp.Response is nil.
  // If data.response is absent or null, resp.Response is nil, triggering panic 0xc0000005 (addr 0x50),
  // which crashes the language server and causes Antigravity IDE to reload.
  // Ensure data.response is ALWAYS a non-null object.
  if (!data.response || typeof data.response !== 'object') {
    data.response = {};
    modified = true;
  }

  // 2. Mirror candidates between root and data.response
  if (Array.isArray(data.candidates) && (!Array.isArray(data.response.candidates) || data.response.candidates.length === 0)) {
    data.response.candidates = data.candidates;
    modified = true;
  } else if (Array.isArray(data.response.candidates) && (!Array.isArray(data.candidates) || data.candidates.length === 0)) {
    data.candidates = data.response.candidates;
    modified = true;
  }
  if (!Array.isArray(data.response.candidates)) {
    data.response.candidates = [];
    modified = true;
  }
  if (!Array.isArray(data.candidates)) {
    data.candidates = data.response.candidates;
    modified = true;
  }

  // 3. Guarantee usageMetadata is non-null on both root and data.response to prevent nil dereference at generation.go:673
  if (!data.response.usageMetadata || typeof data.response.usageMetadata !== 'object') {
    data.response.usageMetadata = data.usageMetadata && typeof data.usageMetadata === 'object'
      ? data.usageMetadata
      : { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
    modified = true;
  }
  if (!data.usageMetadata || typeof data.usageMetadata !== 'object') {
    data.usageMetadata = data.response.usageMetadata;
    modified = true;
  }

  // 4. Mirror promptFeedback between root and data.response
  if (data.promptFeedback && !data.response.promptFeedback) {
    data.response.promptFeedback = data.promptFeedback;
    modified = true;
  } else if (data.response.promptFeedback && !data.promptFeedback) {
    data.promptFeedback = data.response.promptFeedback;
    modified = true;
  }

  // 5. Mirror modelVersion
  if (data.modelVersion && !data.response.modelVersion) {
    data.response.modelVersion = data.modelVersion;
    modified = true;
  } else if (data.response.modelVersion && !data.modelVersion) {
    data.modelVersion = data.response.modelVersion;
    modified = true;
  }

  const sanitizeList = (candidatesList: any[], container: any, key: string): any[] => {
    if (!Array.isArray(candidatesList)) return [];
    let filtered = candidatesList.filter((c) => c && typeof c === 'object');
    if (filtered.length !== candidatesList.length) {
      container[key] = filtered;
      modified = true;
    }
    if (candidatesList.length === 0) {
      filtered = [{ content: { parts: [{ text: '' }], role: 'model' }, index: 0 }];
      container[key] = filtered;
      modified = true;
    }
    for (const cand of filtered) {
      if (!cand.content || typeof cand.content !== 'object') {
        cand.content = { parts: [{ text: '' }], role: 'model' };
        modified = true;
      } else {
        if (!Array.isArray(cand.content.parts) || cand.content.parts.length === 0) {
          cand.content.parts = [{ text: '' }];
          modified = true;
        } else {
          for (let pIdx = 0; pIdx < cand.content.parts.length; pIdx++) {
            const p = cand.content.parts[pIdx];
            if (!p || typeof p !== 'object') {
              cand.content.parts[pIdx] = { text: '' };
              modified = true;
            } else if (p.functionCall && p.functionCall.name === SYNTHETIC_TOOL_NAME) {
              const content = p.functionCall.args?.content;
              if (typeof content === 'string') {
                cand.content.parts[pIdx] = { text: content };
                modified = true;
              }
            } else if (typeof p.text === 'string' && p.text.includes('[Executed tool:')) {
              const toolCalls = extractAllPseudoToolCalls(p.text);
              if (toolCalls.length > 0) {
                const newParts: any[] = [];
                let lastIdx = 0;
                for (const call of toolCalls) {
                  const before = p.text.slice(lastIdx, call.startIdx).trim();
                  if (before) newParts.push({ text: before });
                  newParts.push({ functionCall: { name: call.fnName, args: call.args } });
                  lastIdx = call.endIdx;
                }
                const after = p.text.slice(lastIdx).trim();
                if (after) newParts.push({ text: after });
                if (newParts.length > 0) {
                  cand.content.parts.splice(pIdx, 1, ...newParts);
                  pIdx += newParts.length - 1;
                  modified = true;
                }
              }
            } else if (
              p.text === undefined &&
              !p.functionCall &&
              !p.functionResponse &&
              !p.fileData &&
              !p.inlineData &&
              !p.executableCode &&
              !p.codeExecutionResult
            ) {
              p.text = '';
              modified = true;
            }
          }
        }
        if (!cand.content.role) {
          cand.content.role = 'model';
          modified = true;
        }
      }
    }
    return filtered;
  };

  if (data.candidates) {
    data.candidates = sanitizeList(data.candidates, data, 'candidates');
  }
  if (data.response && typeof data.response === 'object' && data.response.candidates) {
    data.response.candidates = sanitizeList(data.response.candidates, data.response, 'candidates');
  }

  return modified;
}

export function writeSafeSseChunk(res: http.ServerResponse, chunk: any): boolean {
  if (res.writableEnded || res.destroyed) return false;
  if (Array.isArray(chunk)) {
    let ok = true;
    for (const item of chunk) {
      if (item && typeof item === 'object') {
        ok = writeSafeSseChunk(res, item) && ok;
      }
    }
    return ok;
  }
  sanitizeCandidatesInResponse(chunk);
  try {
    return res.write('data: ' + JSON.stringify(chunk) + '\n\n');
  } catch (err) {
    log.warn('[Proxy] writeSafeSseChunk failed:', (err as Error).message);
    return false;
  }
}

export function injectAntiHallucinationInstruction(targetReq: any): void {
  if (!targetReq || typeof targetReq !== 'object') return;
  if (!targetReq.systemInstruction || typeof targetReq.systemInstruction !== 'object') {
    targetReq.systemInstruction = { parts: [] };
  }
  if (!Array.isArray(targetReq.systemInstruction.parts)) {
    targetReq.systemInstruction.parts = [];
  }
  const hasInstruction = targetReq.systemInstruction.parts.some((p: any) =>
    typeof p?.text === 'string' && (p.text.includes('CRITICAL TOOL INVOCATION RULE') || p.text.includes('Always invoke tools using native'))
  );
  if (!hasInstruction) {
    targetReq.systemInstruction.parts.push({ text: ANTI_HALLUCINATION_TOOL_INSTRUCTION });
  }
}

export function autoUnstickConversation(convId?: string): void {
  if (!convId || typeof convId !== 'string') return;
  try {
    const dataDir = path.join(os.homedir(), '.gemini', 'antigravity');
    const dbPath = path.join(dataDir, 'conversation_summaries.db');
    if (!fs.existsSync(dbPath)) return;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      try { db.exec('PRAGMA busy_timeout = 2500;'); } catch (_) {}
      db.prepare("UPDATE conversation_summaries SET not_fully_idle = 0, status = 'CASCADE_RUN_STATUS_IDLE' WHERE conversation_id = ? AND (not_fully_idle = 1 OR status != 'CASCADE_RUN_STATUS_IDLE')").run(convId);
      const protoPath = path.join(dataDir, 'agyhub_summaries_proto.pb');
      if (fs.existsSync(protoPath)) {
        try { fs.unlinkSync(protoPath); } catch (_) {}
      }
      log.info(`[Proxy] 🔓 Auto-unstick applied to conversation ${convId} after upstream stream drop.`);
    } finally {
      db.close();
    }
  } catch (e: any) {
    log.debug(`[Proxy] Auto-unstick non-fatal notice for ${convId}:`, e?.message);
  }
}

// ─── Upstream Google SSE Stream Transformer ─────────────────────────────────

export function transformGoogleStreamForRemote(
  proxyRes: http.IncomingMessage,
  clientRes: http.ServerResponse,
  convId = '',
  isRemote = true,
  modelName = '',
  startTime = Date.now(),
): void {
  const headers = { ...proxyRes.headers };
  delete headers['content-length'];
  delete headers['content-encoding'];
  headers['x-accel-buffering'] = 'no';
  headers['cache-control'] = 'no-cache, no-transform';
  safeWriteHead(clientRes, proxyRes.statusCode || 200, headers as Record<string, string>);
  if (typeof (clientRes as any).flushHeaders === 'function') {
    (clientRes as any).flushHeaders();
  }
  if (clientRes?.socket && typeof clientRes.socket.setNoDelay === 'function') {
    try { clientRes.socket.setNoDelay(true); } catch (_) {}
  }

  const onClientClose = () => {
    if (proxyRes && !proxyRes.destroyed && typeof proxyRes.destroy === 'function') {
      try { proxyRes.destroy(); } catch (_) {}
    }
  };
  if (typeof clientRes?.once === 'function') {
    clientRes.once('close', onClientClose);
  }

  // 3s periodic SSE keepalive heartbeat
  const HEARTBEAT_INTERVAL_MS = 3000;
  let lastChunkTime = Date.now();
  const heartbeatTimer = setInterval(() => {
    if (clientRes.writableEnded || clientRes.destroyed) {
      clearInterval(heartbeatTimer);
      return;
    }
    if (Date.now() - lastChunkTime >= HEARTBEAT_INTERVAL_MS) {
      try {
        clientRes.write(': ping\n\n');
        if (typeof (clientRes as any).flush === 'function') {
          try { (clientRes as any).flush(); } catch (_) {}
        }
      } catch {
        clearInterval(heartbeatTimer);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof (heartbeatTimer as any)?.unref === 'function') {
    (heartbeatTimer as any).unref();
  }

  let idleGuard: IdleTimeoutGuard | undefined;
  const cleanupHeartbeat = () => {
    clearInterval(heartbeatTimer);
  };
  const onClientDisconnect = () => {
    cleanupHeartbeat();
    try { idleGuard?.dispose(); } catch (_) {}
    try { proxyRes.destroy(); } catch (_) {}
    if (stream !== proxyRes && typeof (stream as any)?.destroy === 'function') {
      try { (stream as any).destroy(); } catch (_) {}
    }
  };
  if (typeof clientRes?.on === 'function') {
    clientRes.on('close', onClientDisconnect);
    clientRes.on('finish', cleanupHeartbeat);
  }
  if (typeof proxyRes?.on === 'function') {
    proxyRes.on('close', cleanupHeartbeat);
    proxyRes.on('error', cleanupHeartbeat);
  }

  const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
  let stream: NodeJS.ReadableStream = proxyRes;
  if (encoding === 'gzip') {
    const gunzip = zlib.createGunzip();
    proxyRes.pipe(gunzip);
    proxyRes.on('error', (err) => gunzip.destroy(err));
    proxyRes.on('close', () => { if (!gunzip.destroyed) gunzip.destroy(); });
    stream = gunzip;
  } else if (encoding === 'deflate') {
    const inflate = zlib.createInflate();
    proxyRes.pipe(inflate);
    proxyRes.on('error', (err) => inflate.destroy(err));
    proxyRes.on('close', () => { if (!inflate.destroyed) inflate.destroy(); });
    stream = inflate;
  }

  const isExtendedThinking = /thinking|opus|thought/i.test(modelName || '');
  const effectiveIdleTimeoutMs = isExtendedThinking
    ? Math.max(STREAM_IDLE_TIMEOUT_MS, 180_000)
    : STREAM_IDLE_TIMEOUT_MS;

  idleGuard = new IdleTimeoutGuard(proxyRes, {
    idleTimeoutMs: effectiveIdleTimeoutMs,
    label: modelName || 'google-stream',
    onTimeout: (err) => {
      log.warn(`[Proxy] Google stream idle timeout (${STREAM_IDLE_TIMEOUT_MS}ms) for ${modelName || 'google-stream'} — aborting socket`);
      cleanupHeartbeat();
      autoUnstickConversation(convId);
      try { proxyRes.destroy(err); } catch (_) {}
      if (stream !== proxyRes && typeof (stream as any).destroy === 'function') {
        try { (stream as any).destroy(err); } catch (_) {}
      }
    },
  });

  const decoder = new StringDecoder('utf-8');
  let buffer = '';

  let detectedModel = modelName;
  const lastUsage = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
    cachedContentTokenCount: 0,
  };

  const inspectUsage = (item: any): void => {
    if (!item || typeof item !== 'object') return;
    const usage = item.usageMetadata || (item.response && item.response.usageMetadata);
    if (usage && typeof usage === 'object') {
      if (typeof usage.promptTokenCount === 'number') lastUsage.promptTokenCount = usage.promptTokenCount;
      if (typeof usage.candidatesTokenCount === 'number') lastUsage.candidatesTokenCount = usage.candidatesTokenCount;
      if (typeof usage.totalTokenCount === 'number') lastUsage.totalTokenCount = usage.totalTokenCount;
      if (typeof usage.cachedContentTokenCount === 'number') lastUsage.cachedContentTokenCount = usage.cachedContentTokenCount;
    }
    const m = item.modelVersion || (item.response && item.response.modelVersion);
    if (m && typeof m === 'string') {
      detectedModel = m;
    }
  };

  let sawFinishReason = false;
  const inspectFinishReason = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    const cands = obj.candidates || (obj.response && obj.response.candidates);
    if (Array.isArray(cands)) {
      for (const c of cands) {
        if (c && c.finishReason) {
          sawFinishReason = true;
          return;
        }
      }
    }
  };

  let pseudoToolBuffer = '';
  let pseudoToolBaseItem: any = null;
  let pseudoToolEol = '\n';

  const flushPseudoToolBuffer = (): void => {
    if (!pseudoToolBuffer) return;
    if (pseudoToolBaseItem) {
      const cands = pseudoToolBaseItem.candidates || (pseudoToolBaseItem.response && pseudoToolBaseItem.response.candidates);
      if (Array.isArray(cands) && cands[0]?.content?.parts) {
        cands[0].content.parts = [{ text: pseudoToolBuffer }];
        sanitizeCandidatesInResponse(pseudoToolBaseItem);
        clientRes.write('data: ' + JSON.stringify(pseudoToolBaseItem) + pseudoToolEol);
      }
    }
    pseudoToolBuffer = '';
    pseudoToolBaseItem = null;
  };

  const processLine = (line: string): void => {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('data:')) {
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') {
        return;
      }
      if (!jsonStr) {
        clientRes.write(': ping\n');
        return;
      }
      try {
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data)) {
          const eol = line.endsWith('\r') ? '\r\n' : '\n';
          for (const item of data) {
            if (item && typeof item === 'object') {
              inspectUsage(item);
              inspectFinishReason(item);
              extractAndCacheThoughtSignatures(item, convId);
              sanitizeCandidatesInResponse(item);
              clientRes.write('data: ' + JSON.stringify(item) + eol);
            }
          }
          return;
        }

        inspectUsage(data);
        inspectFinishReason(data);
        extractAndCacheThoughtSignatures(data, convId);

        const cands = data.candidates || (data.response && data.response.candidates);
        const firstPart = cands?.[0]?.content?.parts?.[0];
        const rawText = typeof firstPart?.text === 'string' ? firstPart.text : '';

        const PSEUDO_TOOL_MARKER = '[Executed tool:';
        const trimmedRaw = rawText.trimStart();
        const isPotentialToolStart = !pseudoToolBuffer && Boolean(rawText) && (
          PSEUDO_TOOL_MARKER.startsWith(trimmedRaw) ||
          rawText.includes(PSEUDO_TOOL_MARKER) ||
          (trimmedRaw.startsWith('[') && PSEUDO_TOOL_MARKER.startsWith(trimmedRaw.slice(0, Math.min(trimmedRaw.length, PSEUDO_TOOL_MARKER.length))))
        );

        if (pseudoToolBuffer || isPotentialToolStart) {
          pseudoToolBuffer += rawText;
          if (!pseudoToolBaseItem) {
            pseudoToolBaseItem = data;
            pseudoToolEol = line.endsWith('\r') ? '\r\n' : '\n';
          }

          const markerIdx = pseudoToolBuffer.indexOf(PSEUDO_TOOL_MARKER);
          if (markerIdx > 0) {
            const prefixText = pseudoToolBuffer.slice(0, markerIdx);
            pseudoToolBuffer = pseudoToolBuffer.slice(markerIdx);
            if (pseudoToolBaseItem) {
              const cands = pseudoToolBaseItem.candidates || (pseudoToolBaseItem.response && pseudoToolBaseItem.response.candidates);
              if (Array.isArray(cands) && cands[0]?.content?.parts) {
                cands[0].content.parts = [{ text: prefixText }];
                sanitizeCandidatesInResponse(pseudoToolBaseItem);
                clientRes.write('data: ' + JSON.stringify(pseudoToolBaseItem) + pseudoToolEol);
              }
            }
          }

          const trimmedBuf = pseudoToolBuffer.trimStart();
          if (trimmedBuf.length < PSEUDO_TOOL_MARKER.length) {
            if (PSEUDO_TOOL_MARKER.startsWith(trimmedBuf)) {
              return;
            } else {
              flushPseudoToolBuffer();
              return;
            }
          }
          if (!trimmedBuf.startsWith(PSEUDO_TOOL_MARKER)) {
            flushPseudoToolBuffer();
            return;
          }
          const toolCalls = extractAllPseudoToolCalls(pseudoToolBuffer);
          if (toolCalls.length > 0) {
            const lastCall = toolCalls[toolCalls.length - 1];
            const remainder = pseudoToolBuffer.slice(lastCall.endIdx).trim();
            if (!remainder) {
              flushPseudoToolBuffer();
              return;
            }
          }
          if (pseudoToolBuffer.length > 524288) {
            flushPseudoToolBuffer();
          }
          return;
        }

        sanitizeCandidatesInResponse(data);
        const eol = line.endsWith('\r') ? '\r\n' : '\n';
        clientRes.write('data: ' + JSON.stringify(data) + eol);
        return;
      } catch (e) {
        log.warn('[Proxy] Malformed SSE data chunk from upstream Google:', jsonStr.slice(0, 100));
        return;
      }
    }
    if (trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:') || !trimmed) {
      clientRes.write(line + '\n');
    } else {
      log.debug('[Proxy] Suppressed non-SSE upstream line from stream:', trimmed.slice(0, 60));
    }
  };

  stream.on('data', (chunk: Buffer) => {
    lastChunkTime = Date.now();
    buffer += decoder.write(chunk);
    let lineEndIdx: number;
    while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEndIdx);
      buffer = buffer.slice(lineEndIdx + 1);
      processLine(line);
    }
  });

  stream.on('end', () => {
    flushPseudoToolBuffer();
    cleanupHeartbeat();
    buffer += decoder.end();
    if (buffer.length > 0) {
      processLine(buffer);
      if (buffer.trim().startsWith('data:') && buffer.trim().slice(5).trim() !== '[DONE]') {
        clientRes.write('\n\n');
      }
      buffer = '';
    }
    if (!sawFinishReason) {
      autoUnstickConversation(convId);
    }
    if (!sawFinishReason && !clientRes.writableEnded) {
      const finalChunk = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
      };
      sanitizeCandidatesInResponse(finalChunk);
      writeSafeSseChunk(clientRes, finalChunk);
    }
    safeEnd(clientRes);

    const latencyMs = Math.max(1, Date.now() - startTime);
    const pTokens = lastUsage.promptTokenCount || 0;
    const cTokens = lastUsage.candidatesTokenCount || 0;
    const tTokens = lastUsage.totalTokenCount || (pTokens + cTokens);
    if (tTokens > 0 || pTokens > 0) {
      logTokenUsageEvent({
        id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: Date.now(),
        conversationId: convId || undefined,
        provider: 'google',
        model: detectedModel || modelName || 'gemini-3.8-flash',
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens: tTokens,
        cachedTokens: lastUsage.cachedContentTokenCount || 0,
        latencyMs,
        status: proxyRes.statusCode || 200,
        endpoint: '/v1internal:streamGenerateContent',
      });
    }
    idleGuard.dispose();
    if (typeof clientRes?.off === 'function') {
      clientRes.off('close', onClientClose);
    }
  });

  stream.on('error', (err) => {
    flushPseudoToolBuffer();
    cleanupHeartbeat();
    idleGuard.dispose();
    autoUnstickConversation(convId);
    if (typeof clientRes?.off === 'function') {
      clientRes.off('close', onClientClose);
    }
    log.error('[Proxy] Upstream Google stream error:', err);
    if (!sawFinishReason && !clientRes.writableEnded && !clientRes.destroyed) {
      const finalChunk = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: '\n\n> ⚠️ *[Proxy] La connexion au modèle a été interrompue prématurément par une erreur réseau upstream.*' }],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
      };
      sanitizeCandidatesInResponse(finalChunk);
      writeSafeSseChunk(clientRes, finalChunk);
      safeEnd(clientRes);
    } else {
      clientRes.destroy(err);
    }
    autoUnstickConversation(convId);
  });
}
