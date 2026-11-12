import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import { safeWriteHead, safeEnd } from '../../../../http/httpUtils';
import {
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
} from '../../../streamPipeline';
import { classifyError } from '../../../../resilience/errorClassifier';

export function handleSyntheticSummaryIfRequested(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqJson: Record<string, unknown>,
): boolean {
  const reqType = String(reqJson.requestType || (reqJson.request as any)?.requestType || '').toUpperCase();
  const isExplicitSummary = reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY';

  if (isExplicitSummary && !res.writableEnded && !res.destroyed) {
    log.warn(
      '[Proxy] Context summarization hook failed upstream after pool exhaustion. Returning synthetic summary.',
    );
    const summaryCand = {
      content: {
        parts: [
          {
            text: 'Summary of previous steps: The agent investigated the task, inspected files, and continues execution.',
          },
        ],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    };
    const syntheticChunk = { response: { candidates: [summaryCand] }, candidates: [summaryCand] };
    sanitizeCandidatesInResponse(syntheticChunk);
    if (req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse')) {
      if (!res.headersSent) {
        safeWriteHead(res, 200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }
      writeSafeSseChunk(res, syntheticChunk);
      safeEnd(res);
    } else {
      if (!res.headersSent) safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
      safeEnd(res, JSON.stringify(syntheticChunk));
    }
    return true;
  }
  return false;
}

export function handleTerminalGracefulError(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqJson: Record<string, unknown>,
  sortedAccounts: CustomModel[],
  lastStatus: number,
  lastErrorText: string,
): void {
  if (res.writableEnded || res.destroyed) return;

  const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
  const requestedName =
    typeof reqJson.requestedModel === 'string' && reqJson.requestedModel
      ? reqJson.requestedModel
      : typeof reqJson.model === 'string'
      ? reqJson.model
      : '';
  const failedModel = {
    ...(sortedAccounts[0] || {}),
    name: requestedName || 'gemini-3.8-flash-tiered',
    displayName: requestedName || 'Gemini 3.8 Flash',
    provider: 'google',
  } as CustomModel;
  const diagnostic = classifyError(lastStatus, lastErrorText, undefined, 'google');

  if (!res.headersSent) {
    if (isStream) sendGracefulStreamError(res, diagnostic, failedModel);
    else sendGracefulNonStreamError(res, diagnostic, failedModel);
  } else if (isStream) {
    sendGracefulStreamError(res, diagnostic, failedModel);
  } else {
    safeEnd(res);
  }
}
