import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import type { GoogleRequestOutcome } from '../direct/types';
import { executeGoogleCloudCodeRequest } from '../direct/singleRequestExecutor';
import { createResponseClaimer } from '../../historyTrimmer';
import {
  getValidGoogleAccessToken,
  isGeminiCliModel,
} from '../../../../services/auth/googleAuth';
import {
  isAccountInCooldown,
  getModelQuotaScore,
  recordAccountRequest,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountLatency,
  unmarkAccountUnlicensed,
  setAccountCooldown,
  resolveGoogleProjectId,
} from '../../../resilience/googlePool';
import { recordSuccess } from '../../../resilience/circuitBreaker';
import { GOOGLE_HOSTS, HEDGED_REQUEST_DELAY_MS } from '../../../../constants';

export interface HedgedDispatchParams {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  reqJson: Record<string, unknown>;
  updatedBody: Buffer;
  candidate: CustomModel;
  candidateName: string;
  targetModel: string;
  modelFamily: string;
  currentFamily: string;
  authHeader: string;
  convId: string;
  hostOverride: string | undefined;
  poolHeaderTimeout: number;
  startReqTime: number;
  isSessionRemote: boolean;
  isStreamReq: boolean;
  isFlashThinkingHedgeable: boolean;
  isContextualPayload: boolean;
  sortedAccounts: CustomModel[];
  candidateIndex: number;
}

export async function dispatchWithHedge(
  params: HedgedDispatchParams,
): Promise<{ outcome: GoogleRequestOutcome; successfulCandidate: CustomModel }> {
  const {
    req,
    res,
    reqJson,
    updatedBody,
    candidate,
    candidateName,
    targetModel,
    modelFamily,
    currentFamily,
    authHeader,
    convId,
    hostOverride,
    poolHeaderTimeout,
    startReqTime,
    isSessionRemote,
    isStreamReq,
    isFlashThinkingHedgeable,
    isContextualPayload,
    sortedAccounts,
    candidateIndex,
  } = params;

  let successfulCandidate = candidate;
  const claimer = createResponseClaimer();
  let hedgeTimer: NodeJS.Timeout | undefined;

  const candidate1Promise = executeGoogleCloudCodeRequest(
    req,
    res,
    updatedBody,
    isSessionRemote,
    authHeader,
    convId,
    hostOverride,
    poolHeaderTimeout,
    targetModel,
    startReqTime,
    claimer,
    candidate,
  );

  const baseHedgeDelay = isFlashThinkingHedgeable
    ? Math.max(HEDGED_REQUEST_DELAY_MS, 15_000)
    : isContextualPayload
    ? Math.max(HEDGED_REQUEST_DELAY_MS, 8_000)
    : HEDGED_REQUEST_DELAY_MS;
  const hedgeDelay = Math.min(baseHedgeDelay, Math.floor(poolHeaderTimeout * 0.6));

  const hedgePromise = new Promise<GoogleRequestOutcome>((resolveHedge) => {
    hedgeTimer = setTimeout(async () => {
      if (claimer.isClaimed() || res.headersSent || res.writableEnded) {
        resolveHedge({ success: false, statusCode: 499, error: 'Hedge aborted: already claimed or response finished' });
        return;
      }

      const sibling = sortedAccounts.slice(candidateIndex + 1).find(
        (c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0,
      );
      if (!sibling) {
        resolveHedge({ success: false, statusCode: 504, error: 'Hedge skipped: no eligible sibling accounts' });
        return;
      }

      const siblingName = sibling.accountEmail || sibling.name || 'sibling';
      log.info(
        `[Proxy] ⚡ [Hedged Request] Account [${candidateName}] did not send headers within ${hedgeDelay}ms. Launching speculative candidate [${siblingName}]...`,
      );

      let siblingToken: string | null = null;
      try {
        siblingToken = await getValidGoogleAccessToken(sibling);
      } catch (_) {}

      if (!siblingToken || claimer.isClaimed() || res.headersSent || res.writableEnded) {
        resolveHedge({ success: false, statusCode: 504, error: 'Hedge skipped: token unavailable or already claimed' });
        return;
      }

      const siblingReqJson = JSON.parse(JSON.stringify(reqJson));
      siblingReqJson.project = resolveGoogleProjectId(sibling);
      if (!isGeminiCliModel(sibling) && !siblingReqJson.enabledCreditTypes) {
        siblingReqJson.enabledCreditTypes = ['GOOGLE_ONE_AI'];
      }
      const siblingBody = Buffer.from(JSON.stringify(siblingReqJson), 'utf-8');
      const siblingAuth = `Bearer ${siblingToken}`;
      const siblingHost = isGeminiCliModel(sibling) ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE;

      recordAccountRequest(sibling);
      incrementAccountInFlight(sibling);
      const siblingStart = Date.now();
      let siblingInFlightReleased = false;
      const releaseSiblingInFlight = () => {
        if (!siblingInFlightReleased) {
          siblingInFlightReleased = true;
          decrementAccountInFlight(sibling);
        }
      };

      try {
        const siblingOutcome = await executeGoogleCloudCodeRequest(
          req,
          res,
          siblingBody,
          isSessionRemote,
          siblingAuth,
          convId,
          siblingHost,
          poolHeaderTimeout,
          targetModel,
          siblingStart,
          claimer,
          sibling,
        );
        if (siblingOutcome.success) {
          successfulCandidate = sibling;
          recordAccountLatency(sibling, Date.now() - siblingStart);
          recordSuccess(sibling);
          unmarkAccountUnlicensed(sibling);
          log.warn(
            `[Proxy] 🏆 [Hedged Request Winner] Speculative candidate [${siblingName}] won race against [${candidateName}]!`,
          );
          setAccountCooldown(candidate, 60_000, currentFamily, true);
        }
        resolveHedge(siblingOutcome);
      } finally {
        const siblingStreamActive =
          isStreamReq &&
          successfulCandidate === sibling &&
          !res.writableEnded &&
          !res.destroyed &&
          typeof res.once === 'function';
        if (siblingStreamActive) {
          res.once('finish', () => {
            recordAccountLatency(sibling, Date.now() - siblingStart);
            releaseSiblingInFlight();
          });
          res.once('close', releaseSiblingInFlight);
        } else {
          releaseSiblingInFlight();
        }
      }
    }, hedgeDelay);
  });

  let candidate1Settled = false;
  let candidate1Result: GoogleRequestOutcome | undefined;
  const candidate1Watched = candidate1Promise.then((res1) => {
    candidate1Settled = true;
    candidate1Result = res1;
    if (res1.success && hedgeTimer) clearTimeout(hedgeTimer);
    return res1;
  });

  const firstOutcome = await Promise.race([candidate1Watched, hedgePromise]);
  let outcome: GoogleRequestOutcome;

  if (firstOutcome.success) {
    outcome = firstOutcome;
    if (hedgeTimer) clearTimeout(hedgeTimer);
  } else {
    if (candidate1Settled && candidate1Result && !candidate1Result.success) {
      log.info(`[Proxy] Candidate [${candidateName}] did not succeed. Awaiting speculative hedged candidate in flight...`);
      const hedgeOutcome = await hedgePromise;
      outcome = hedgeOutcome && hedgeOutcome.success ? hedgeOutcome : firstOutcome;
    } else {
      outcome = firstOutcome;
    }
  }

  if (hedgeTimer) clearTimeout(hedgeTimer);
  return { outcome, successfulCandidate };
}
