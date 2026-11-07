import {
  setupCustomModelsWatcher,
  stopCustomModelsWatcher,
  startQuotaPollingInterval,
  stopQuotaPollingInterval,
  loadPersistedState,
  flushPersistedState,
  startProxyServer,
  stopProxyServer,
  getProxyPort,
  isProxyRunning,
} from './proxy/serverLifecycle';

import { handleRequest } from './proxy/httpRouter';

export {
  setupCustomModelsWatcher,
  stopCustomModelsWatcher,
  startQuotaPollingInterval,
  stopQuotaPollingInterval,
  loadPersistedState,
  flushPersistedState,
  getProxyPort,
  isProxyRunning,
  handleRequest,
};

// ─── Lifecycle & Server Boot ───────────────────────────────────────────────

export function startProxy(): Promise<number> {
  return startProxyServer(handleRequest);
}

export function stopProxy(): Promise<void> {
  return stopProxyServer();
}

// ─── Google Cloud Code Engine Re-exports ───────────────────────────────────

export {
  proxyToGoogle,
  executeGoogleCloudCodeRequest,
  executeGoogleCloudCodeWithPool,
} from './proxy/googleCloudEngine';
export type { GoogleRequestOutcome } from './proxy/googleCloudEngine';

// ─── Custom Model Engine Re-exports ────────────────────────────────────────

export { handleCustomModelRequest } from './proxy/customModelEngine';
export type { RetryDispatch, StreamRequestCtx } from './proxy/customModelEngine';

// ─── Types & Models Re-exports ─────────────────────────────────────────────

import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './proxy/types';
export type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse };

export * from './proxy/googlePool';
export * from './proxy/sessionAffinities';

// ─── Utilities & State Re-exports (Backwards Compatibility) ────────────────

export {
  isNativeCloudCodeModel,
  extractModelNameFromPayload,
  clampSubagentReasoning,
  isSubagentRequest,
  matchesCustomModel,
} from './proxy/modelUtils';

export { parseRetryAfter, isAllowedOrigin } from './proxy/httpUtils';

export {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
} from './proxy/historyTrimmer';

export {
  isRemoteVpsActive,
  remoteVpsHost,
  remoteVpsToken,
  remoteSessionsMap,
  TokenUsageEvent,
  loadRemoteState,
  saveRemoteState,
  executeOnRemoteDaemon,
  getRemoteStatePath,
  getTokenEventsLogPath,
  logTokenUsageEvent,
  ensureRemoteExecScriptOnDisk,
  updateRemoteVpsConfig,
  remoteVpsState,
} from './proxy/remoteState';

export {
  enrichExperimentsPayload,
  unlockCodeAssistPayload,
  isTelemetryRpcUrl,
  loadCachedExperiments,
  saveCachedExperiments,
  loadCachedCodeAssist,
  saveCachedCodeAssist,
  loadCachedAvailableModels,
  saveCachedAvailableModels,
  handleGetAvailableModelsProxy,
  handleGetUserStatusProxy,
  memoryListExperimentsTime,
  memoryFetchAvailableModelsTime,
  memoryLoadCodeAssistTime,
} from './proxy/endpointHandlers';

export {
  generateGracefulMarkdown,
  ProxyErrorPayload,
  ProxyErrorEmitter,
  setProxyErrorEmitter,
  buildProxyErrorPayload,
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sendGracefulError,
  parseBalancedJson,
  extractAllPseudoToolCalls,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
  injectAntiHallucinationInstruction,
  autoUnstickConversation,
  transformGoogleStreamForRemote,
} from './proxy/streamPipeline';
