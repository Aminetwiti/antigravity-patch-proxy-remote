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
} from './proxy/http/serverLifecycle';

import { handleRequest } from './proxy/http/httpRouter';

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
} from './proxy/engine/googleCloudEngine';
export type { GoogleRequestOutcome } from './proxy/engine/googleCloudEngine';

// ─── Custom Model Engine Re-exports ────────────────────────────────────────

export { handleCustomModelRequest } from './proxy/engine/customModelEngine';
export type { RetryDispatch, StreamRequestCtx } from './proxy/engine/customModelEngine';

// ─── Types & Models Re-exports ─────────────────────────────────────────────

import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './proxy/core/types';
export type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse };

export * from './proxy/resilience/googlePool';
export * from './proxy/resilience/sessionAffinities';

// ─── Utilities & State Re-exports (Backwards Compatibility) ────────────────

export {
  isNativeCloudCodeModel,
  extractModelNameFromPayload,
  clampSubagentReasoning,
  isSubagentRequest,
  matchesCustomModel,
} from './proxy/models/modelUtils';

export { parseRetryAfter, isAllowedOrigin } from './proxy/http/httpUtils';

export {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
} from './proxy/engine/historyTrimmer';

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
} from './proxy/state/remoteState';

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
} from './proxy/http/endpointHandlers';

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
} from './proxy/engine/streamPipeline';
