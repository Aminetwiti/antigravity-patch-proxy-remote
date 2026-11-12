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
} from './proxy/http/server/serverLifecycle';

import { handleRequest } from './proxy/http/server/httpRouter';

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

export { handleCustomModelRequest } from './proxy/engine/executors/customModelEngine';
export type { RetryDispatch, StreamRequestCtx } from './proxy/engine/executors/customModelEngine';

// ─── Types & Models Re-exports ─────────────────────────────────────────────

import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './proxy/core/types';
export type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse };

export * from './proxy/resilience/pools/googlePool';
export * from './proxy/resilience/pools/sessionAffinities';

// ─── Utilities & State Re-exports (Backwards Compatibility) ────────────────

export {
  isNativeCloudCodeModel,
  extractModelNameFromPayload,
  clampSubagentReasoning,
  isSubagentRequest,
  matchesCustomModel,
} from './proxy/models/catalog/modelUtils';

export { parseRetryAfter, isAllowedOrigin } from './proxy/http/server/httpUtils';

export {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
} from './proxy/engine/transforms/historyTrimmer';

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
} from './proxy/state/remote/remoteState';

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
} from './proxy/http/routes/endpointHandlers';

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
} from './proxy/engine/stream/streamPipeline';
