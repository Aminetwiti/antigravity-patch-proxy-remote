import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { GoogleRequestOutcome } from '../../direct/types';
import { executeGoogleCloudCodeRequest } from '../../direct/singleRequestExecutor';
import {
  restoreThoughtSignatures,
  flattenAllToolCallsToText,
  markConvCorruptedSignatures,
} from '../../../../core/shared';
import { normalizeConversationTurns } from '../../../../../services/auth/googleAuth';
import { clearAccountCooldown } from '../../../../resilience/googlePool';
import { recordSuccess } from '../../../../resilience/circuitBreaker';
import { bindSessionToModel } from '../../../../resilience/sessionAffinities';
import { trimOldestHistory } from '../../../historyTrimmer';

export async function attemptThoughtSignatureRepair(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqJson: Record<string, unknown>,
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  targetModel: string,
  authHeader: string,
  convId: string,
  sessId: string | null,
  hostOverride: string | undefined,
  poolHeaderTimeout: number,
  startReqTime: number,
  isSessionRemote: boolean,
  outcome: GoogleRequestOutcome,
): Promise<{ success: boolean; newOutcome?: GoogleRequestOutcome }> {
  const isSignatureOrFormat400 =
    outcome.statusCode === 400 &&
    (/thought.*signature|signature.*thought|signature.*thinking|thinking.*signature|corrupted.*signature|invalid.*signature/i.test(
      outcome.error || '',
    ) ||
      /invalid.*argument|INVALID_ARGUMENT/i.test(outcome.error || ''));

  if (!isSignatureOrFormat400) {
    return { success: false };
  }

  log.warn(`[Proxy] Detected payload validation / thought signature issue on ${candidateName}. Auto-repairing...`);
  const isMissingSig = /missing.*thought_signature|thought_signature.*missing/i.test(outcome.error || '');
  const repairedReqJson = JSON.parse(JSON.stringify(reqJson));
  const targetContents = (repairedReqJson.request as any)?.contents || repairedReqJson.contents;
  let repaired = false;

  const activeConvKey = convId || sessId || '';

  if (isMissingSig && Array.isArray(targetContents)) {
    repaired = restoreThoughtSignatures(targetContents, activeConvKey, 'gemini');
    if (repaired) {
      log.info(`[Proxy] Successfully restored missing thought signature(s) for ${candidateName}`);
    }
  }

  if (!repaired) {
    log.warn(`[Proxy] Converting unverified tool calls in history to text to bypass Vertex AI payload validation for ${candidateName}`);
    const sanitizeObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.generationConfig) {
        delete obj.generationConfig.thinkingConfig;
        delete obj.generationConfig.thinking_config;
      }
      if (obj.generation_config) {
        delete obj.generation_config.thinkingConfig;
        delete obj.generation_config.thinking_config;
      }
      if (obj.systemInstruction && typeof obj.systemInstruction === 'object') {
        const si = obj.systemInstruction as { parts?: Array<Record<string, unknown>> };
        if (Array.isArray(si.parts)) {
          for (const p of si.parts) {
            if (p && typeof p === 'object') {
              delete p.thought_signature;
              delete p.thoughtSignature;
              delete p.signature;
              delete p.thought;
            }
          }
        }
      }
      if (Array.isArray(obj.contents)) {
        for (const c of obj.contents) {
          if (Array.isArray(c.parts)) {
            c.parts = c.parts.filter((p: any) => !p?.thought && p?.type !== 'thinking');
            if (c.parts.length === 0) c.parts = [{ text: '.' }];
            for (const p of c.parts) {
              if (p && typeof p === 'object') {
                delete p.thought_signature;
                delete p.thoughtSignature;
                delete p.signature;
                delete p.thought;
              }
            }
          }
        }
        flattenAllToolCallsToText(obj.contents);
        normalizeConversationTurns(obj.contents);
      }
      if (obj.request && typeof obj.request === 'object') {
        sanitizeObj(obj.request);
      }
    };
    sanitizeObj(repairedReqJson);
  }

  const retryBody = Buffer.from(JSON.stringify(repairedReqJson), 'utf-8');
  const retryOutcome = await executeGoogleCloudCodeRequest(
    req,
    res,
    retryBody,
    isSessionRemote,
    authHeader,
    activeConvKey,
    hostOverride,
    poolHeaderTimeout,
    targetModel,
    startReqTime,
  );

  if (retryOutcome.success) {
    recordSuccess(candidate);
    clearAccountCooldown(candidate, modelFamily);
    if (activeConvKey) markConvCorruptedSignatures(activeConvKey);
    if (sessId) bindSessionToModel(sessId, candidate);
    log.info(`[Proxy] Self-healing retry after payload repair SUCCEEDED on account ${candidateName}`);
    return { success: true, newOutcome: retryOutcome };
  }

  if (activeConvKey) markConvCorruptedSignatures(activeConvKey);
  return { success: false, newOutcome: retryOutcome };
}

export async function attemptTokenLimitHistoryTrim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqJson: Record<string, unknown>,
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  targetModel: string,
  authHeader: string,
  convId: string,
  sessId: string | null,
  hostOverride: string | undefined,
  poolHeaderTimeout: number,
  startReqTime: number,
  isSessionRemote: boolean,
  outcome: GoogleRequestOutcome,
): Promise<boolean> {
  if (
    outcome.statusCode === 400 &&
    /context.*length|token.*limit|payload.*exceed|too large|request.*large|exceeds.*limit/i.test(outcome.error || '')
  ) {
    log.warn(`[Proxy] Detected Context/Token limit error on ${candidateName}. Trimming 30% oldest history and retrying...`);
    trimOldestHistory(reqJson);
    const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
    const retryOutcome = await executeGoogleCloudCodeRequest(
      req,
      res,
      retryBody,
      isSessionRemote,
      authHeader,
      convId,
      hostOverride,
      poolHeaderTimeout,
      targetModel,
      startReqTime,
    );
    if (retryOutcome.success) {
      recordSuccess(candidate);
      clearAccountCooldown(candidate, modelFamily);
      if (sessId) bindSessionToModel(sessId, candidate);
      log.info(`[Proxy] History trimming retry SUCCEEDED on account ${candidateName}`);
      return true;
    }
  }
  return false;
}
