import * as http from 'http';
import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import {
  GOOGLE_HOSTS,
  LOOPBACK_HOSTS,
  DEFAULT_MAX_BODY_SIZE,
} from '../../../constants';
import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from '../../core/types';
import {
  modelToolCallIds,
  modelReasoningContent,
  activeStreamContexts,
  translatedToolCalls,
  restoreThoughtSignatures,
  sanitizeUnsignedToolCalls,
  flattenAllToolCallsToText,
  isConvCorruptedSignatures,
} from '../../core/shared';
import { loadCustomModels } from '../../models/modelLoader';
import { getOpenBreaker } from '../../resilience/circuit/circuitBreaker';
import { handleInternalApiRoute } from '../routes/internalApiRoutes';
import { getBaseModelId } from '../../core/urlBuilder';
import { generateModelPlaceholderId, toSlug } from '../../models/idGenerator';
import { expandModelsWithEffort } from '../../engine/effortExpander';
import {
  isNativeCloudCodeModel,
  extractModelNameFromPayload,
  clampSubagentReasoning,
  matchesCustomModel,
} from '../../models/modelUtils';
import { resolveGoogleIp } from './dnsResolver';
import { checkAllModelsHealth } from '../../resilience/pools/modelHealthChecker';
import { mcpListServers, mcpCallTool } from '../routes/mcpRelay';
import {
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  isGoogleCloudCodeModel,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
} from '../../../services/auth/googleAuth';
import { selectBestModelByQuota, getGoogleAccountPool } from '../../resilience/pools/googlePool';
import { safeWriteHead, safeEnd, isAllowedOrigin, proxyLog } from './httpUtils';
import { resolveFileData } from '../../engine/historyTrimmer';
import {
  mergeModels,
  injectCustomSlugsIntoAgentModelSorts,
  buildSyntheticModelsResponse,
} from '../../models/modelInjector';
import {
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
} from '../routes/endpointHandlers';
import { injectAntiHallucinationInstruction } from '../../engine/streamPipeline';
import { getProxyPort } from './serverLifecycle';
import {
  extractSessionId,
  getNativeSession,
  getLatestNativeErrorAsSession,
  nativeSessions,
  clearLatestNativeGlobalError,
  NATIVE_CASCADE_BLOCK_WINDOW_MS,
  markNativeSession,
  clearSessionModelFallback,
  getSessionModelFallback,
  setSessionEffortAffinity,
  getSessionEffortAffinity,
  getSessionBoundModel,
  bindSessionToModel,
} from '../../resilience/pools/sessionAffinities';
import { proxyToGoogle, executeGoogleCloudCodeWithPool } from '../../engine/googleCloudEngine';
import { handleCustomModelRequest } from '../../engine/customModelEngine';

// --- Main Request Handler -------------------------------------------------

export function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Ultra-low latency: Disable Nagle algorithm on loopback sockets immediately
  if (req.socket && typeof req.socket.setNoDelay === 'function') {
    req.socket.setNoDelay(true);
  }
  if (res.socket && typeof res.socket.setNoDelay === 'function') {
    res.socket.setNoDelay(true);
  }

  // CSRF / Origin Guard: Reject unauthorized external origins attempting local proxy abuse
  if (!isAllowedOrigin(req)) {
    const host = (req.headers.host || '').toLowerCase();
    const isSystemCertNoise =
      host.includes('digicert.com') ||
      host.includes('windowsupdate.com') ||
      host.includes('symcb.com') ||
      host.includes('verisign.com') ||
      host.includes('pki.goog') ||
      host.includes('globalsign.com') ||
      host.includes('sectigo.com');
    if (isSystemCertNoise) {
      log.debug(`[Proxy] Ignored background OS certificate/CRL check: host=${req.headers.host}`);
    } else {
      log.warn(`[Proxy] Blocked request with unauthorized Host/Origin: host=${req.headers.host} origin=${req.headers.origin}`);
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Forbidden: Unauthorized origin' } }));
    return;
  }

  // Health check — keep this FIRST so the LS sees a live port even if other
  // initialization (padding strip, model loading, etc.) is delayed or fails.
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    log.debug(`[Proxy] /health hit from ${req.socket.remoteAddress || 'unknown'}`);
    const memUsage = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        port: getProxyPort(),
        pid: process.pid,
        memory: {
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        state: {
          activeStreamContexts: activeStreamContexts.size,
          modelToolCallIds: modelToolCallIds.size,
          translatedToolCalls: translatedToolCalls.size,
          modelReasoningContent: modelReasoningContent.size,
        },
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  if (handleInternalApiRoute(req, res)) {
    return;
  }

    // CORS Preflight handler for browser-initiated requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  req.url = req.url!.replace(/^.*\/dummy_path_padding/, '');
  // Strip binary patch padding (from LS hostname replacement)
  req.url = req.url!.replace(/\/v1internal\/x+/, '');

  // P0-4: Enforce maximum request body size to prevent memory exhaustion DoS
  const MAX_BODY_SIZE = DEFAULT_MAX_BODY_SIZE;
  let bodyLength = 0;
  let bodyRejected = false;

  const bodyChunks: Buffer[] = [];
  req.on('data', (chunk) => {
    bodyLength += chunk.length;
    if (bodyLength > MAX_BODY_SIZE) {
      if (!bodyRejected) {
        bodyRejected = true;
        const maxMb = Math.round(MAX_BODY_SIZE / (1024 * 1024));
        log.warn(`[Proxy] Request body exceeds ${maxMb}MB limit (${req.method} ${req.url})`);
        if (!res.headersSent) {
          res.writeHead(413, {
            'Content-Type': 'application/json',
            'Connection': 'close',
          });
          res.end(
            JSON.stringify({ error: { message: `Request body too large. Maximum: ${maxMb}MB` } }),
          );
        }
        req.resume();
        res.on('finish', () => {
          req.destroy();
        });
      }
      return;
    }
    bodyChunks.push(chunk);
  });
  req.on('end', async () => {
    if (bodyRejected) return;

    let fullBody = Buffer.concat(bodyChunks);
    const bodyStr = fullBody.toString('utf-8');

    const isRoutineNoise =
      req.url?.includes('Heartbeat') ||
      req.url?.includes('GetUserStatus') ||
      req.url?.includes('listExperiments') ||
      req.url?.includes('loadCodeAssist') ||
      req.url?.includes('recordTrajectoryAnalytics') ||
      req.url?.includes('writeTrajectoryAcls') ||
      req.url?.includes('retrieveUserQuotaSummary') ||
      req.url?.includes('fetchAvailableModels') ||
      req.url?.includes('fetchAdminControls') ||
      req.url?.includes('buildWithGooglePlugins') ||
      req.url?.includes('cascadeNuxes') ||
      req.url?.includes('fetchUserInfo') ||
      req.url === '/health';
    if (isRoutineNoise) {
      log.debug(`[Proxy] Request: ${req.method} ${req.url}`);
    } else {
      log.info(`[Proxy] Request: ${req.method} ${req.url}`);
    }

    // Zero latency: Short-circuit DeepMind / Trajectory telemetry and analytics reporting
    if (
      req.url?.includes('recordTrajectoryAnalytics') ||
      req.url?.includes('writeTrajectoryAcls') ||
      req.url?.includes('analytics')
    ) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ ok: true, status: 'RECORDED_NOOP' }));
      }
      return;
    }

    // MCP relay: the mobile companion asks the desktop session for the list
    // of configured MCP servers (name + tools + status) because the phone
    // holds no credentials or allowlist. The actual MCP runtime is the
    // Antigravity IDE sidecar; we simply delegate and relay its JSON.
    if (req.method === 'GET' && (req.url === '/list_mcp_servers' || req.url === '/mcp_servers')) {
      const listRes = await mcpListServers();
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(listRes));
      }
      return;
    }

    // MCP tool relay (same shape the daemon sends): serverName, toolName,
    // arguments. The proxy forwards to the MCP runtime and relays the JSON.
    if (req.method === 'POST' && req.url === '/call_mcp_tool') {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch (e) {
        if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON body' } }));
        }
        return;
      }
      const callRes = await mcpCallTool(payload);
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(callRes));
      }
      return;
    }

    // OpenAI /chat/completions relay: sanitizes reasoning_content and forwards to upstream provider
    if (req.method === 'POST' && req.url!.includes('/chat/completions')) {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        if (payload.model && /MODEL_PLACEHOLDER_/i.test(payload.model)) {
          const allModels = loadCustomModels();
          const found = allModels.find(
            (m) => generateModelPlaceholderId(m) === payload.model || m.name === payload.model || m.name.endsWith('/' + payload.model),
          );
          if (found && found.externalModelName) {
            payload.model = found.externalModelName;
          } else {
            const active = allModels.filter(m => m.enabled !== false && m.externalModelName);
            const defaultModel = active[0] || allModels[0];
            if (defaultModel && defaultModel.externalModelName) {
              payload.model = defaultModel.externalModelName;
            }
          }
        }
        if (Array.isArray(payload.messages)) {
          for (const msg of payload.messages) {
            delete msg.reasoning_content;
          }
        }
        // Modern reasoning models (gpt-6, astra, luna, o-series) reject non-default temperature
        if (payload.temperature !== undefined && payload.temperature !== 1) {
          delete payload.temperature;
        }
        if (payload.max_tokens && !payload.max_completion_tokens) {
          payload.max_completion_tokens = payload.max_tokens;
          delete payload.max_tokens;
        }
        log.info(`[Relay on 51074] Forwarding request for model: ${payload.model}`);
        const cleanedBody = JSON.stringify(payload);
        const upstreamTarget = (req.headers['x-upstream-url'] as string) || 'https://api.experientiallabs.ai/v1/chat/completions';
        const upstreamUrl = new URL(upstreamTarget);
        const forwardHeaders: Record<string, string> = {
          host: upstreamUrl.host,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(cleanedBody)),
        };
        for (const [k, v] of Object.entries(req.headers)) {
          const lk = k.toLowerCase();
          if (
            lk !== 'host' &&
            lk !== 'content-length' &&
            lk !== 'transfer-encoding' &&
            lk !== 'connection' &&
            lk !== 'accept-encoding' &&
            lk !== 'x-upstream-url' &&
            typeof v === 'string'
          ) {
            forwardHeaders[lk] = v;
          }
        }

        const isHttps = upstreamUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const upstreamReq = client.request(upstreamUrl, {
          method: 'POST',
          headers: forwardHeaders,
        }, (upstreamRes) => {
          safeWriteHead(res, upstreamRes.statusCode || 200, upstreamRes.headers as any);
          upstreamRes.pipe(res);
        });
        upstreamReq.on('error', (err) => {
          log.error('[Proxy] /chat/completions relay network error:', err);
          if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
            safeEnd(res, JSON.stringify({ error: { message: err.message } }));
          }
        });
        upstreamReq.write(cleanedBody);
        upstreamReq.end();
        return;
      } catch (err) {
        log.error('[Proxy] /chat/completions relay error:', err);
      }
    }

    // Fast-Ack for Language Server telemetry & shadow eval RPCs
    if (process.env.AG_FAST_ACK_TELEMETRY !== '0' && isTelemetryRpcUrl(req.url)) {
      log.debug(`[Proxy] Fast-Ack telemetry RPC intercepted: ${req.url}`);
      const isJson = !req.headers['content-type'] || req.headers['content-type'].includes('application/json');
      if (isJson) {
        if (safeWriteHead(res, 200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })) {
          safeEnd(res, '{}');
        }
      } else {
        if (safeWriteHead(res, 200, {
          'Content-Type': req.headers['content-type'] || 'application/connect+proto',
          'Access-Control-Allow-Origin': '*',
          'grpc-status': '0',
        })) {
          safeEnd(res, Buffer.from([0, 0, 0, 0, 0]));
        }
      }
      return;
    }

    // 0. Intercept GetAvailableModels (redirected from Electron webRequest)
    if (req.url!.startsWith('/GetAvailableModels')) {
      const gavParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
      const lsUrl = gavParsed.searchParams.get('ls');
      if (lsUrl) {
        handleGetAvailableModelsProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
        return;
      }
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
        safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
      }
      return;
    }

    // 0.1. Intercept GetUserStatus (redirected from Electron webRequest for Antigravity 2.5+/2.12+)
    if (req.url!.startsWith('/GetUserStatus')) {
      const gusParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
      const lsUrl = gusParsed.searchParams.get('ls');
      if (lsUrl) {
        handleGetUserStatusProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
        return;
      }
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
        safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
      }
      return;
    }

    // 0.5. Intercept /v1internal:listExperiments with caching, enrichment, and fallback
    if (req.url!.includes('/v1internal:listExperiments')) {
      log.debug('[Proxy] Intercepting listExperiments request');

      const buildDefaultExperimentsFallback = () => {
        const flags = [
          { name: 'shadow-call-aicode-mendel', boolValue: false },
          { name: 'mendel_aicode_shadow_diff', boolValue: false },
          { name: 'enable-battle-mode-auto-trigger', boolValue: false },
          { name: 'supercomplete-fast-debounce', boolValue: true },
          { name: 'command-prompt-cache-config', stringValue: '{"enabled": true, "ttl_seconds": 3600}' },
          { name: 'context-force-local-context', boolValue: true },
          { name: 'use-special-edit-code-block', boolValue: true },
          { name: 'use-slash-plan', boolValue: true },
          { name: 'customization-token-budget', intValue: 20000 },
          { name: 'rules-token-budget', intValue: 20000 },
          { name: 'enable-subagent-hub', boolValue: true },
          { name: 'enable-skill-search-tool', boolValue: true },
          { name: 'enable-owl-slash-command', boolValue: true },
          { name: 'enable-browser-subagent-v2', boolValue: true },
          { name: 'enable-customization-load-error-notice', boolValue: true },
          { name: 'send-subagent-initial-prompt-as-message', boolValue: true },
          { name: 'enable-battle-mode-custom-agents', boolValue: true },
          { name: 'enable-command-assessor', boolValue: true },
          { name: 'enable-daemon-commands', boolValue: true },
          { name: 'enable-hook-status', boolValue: true },
          { name: 'enable-mcp-non-blocking-turn-load', boolValue: true },
          { name: 'enable-model-capacity-exhausted-retries', boolValue: true },
          { name: 'enable-persistent-terminals', boolValue: true },
          { name: 'enable-pty', boolValue: true },
          { name: 'enable-sidecars', boolValue: true },
          { name: 'enable-ui-sidecars', boolValue: true },
          { name: 'deprecate-workflows', boolValue: true },
          { name: 'use-core-direct', boolValue: true },
          { name: 'tool-output-max-bytes', intValue: 46080 },
          { name: 'max-tokens-per-step', intValue: 16384 },
          { name: 'show-model-selection-change', boolValue: true },
          { name: 'scheduled-tasks-v2', boolValue: true },
          { name: 'enable-tasks', boolValue: true },
          { name: 'enable-conversation-search-v2', boolValue: true },
          { name: 'enable-background-task-accumulator', boolValue: true },
          { name: 'enable-aux-pane-redesign', boolValue: true },
          { name: 'enable-split-view', boolValue: true },
          // Antigravity 2.25+ Features
          { name: 'enable-permissions-selector', boolValue: true },
          { name: 'jetski-unified-customizations-panel-enabled', boolValue: true },
          { name: 'enable-plugin-sidebar-section', boolValue: true },
          { name: 'enable-plugins', boolValue: true },
          { name: 'enable-auto-permission-preset', boolValue: true },
          { name: 'permission-v2', boolValue: true },
          { name: 'enable-audio-transcription', boolValue: true },
          { name: 'enable-voice-relay', boolValue: true },
          { name: 'enable-marketplace-search-tool', boolValue: true },
          { name: 'google-workspace-mentions', boolValue: true },
          { name: 'enable-customization-skills', boolValue: true },
          { name: 'enable-developer-mode', boolValue: true },
          { name: 'enable-trajectory-debug-tools', boolValue: true },
          { name: 'enable-conversation-forking', boolValue: true },
          { name: 'enable-fork-at-historical-step', boolValue: true },
          { name: 'enable-fork-in-new-worktree', boolValue: true },
          { name: 'enable-conversation-selection-quoting', boolValue: true },
          { name: 'enable-resume-conversations-from-restart', boolValue: true },
          { name: 'enable-thought-editing', boolValue: true },
          { name: 'enable-thought-steering-from-selection', boolValue: true },
          { name: 'enable-input-autocomplete', boolValue: true },
          { name: 'enable-input-draft-persistence', boolValue: true },
          { name: 'context-window-selector', boolValue: true },
          { name: 'show-all-models-in-gemini-app', boolValue: true },
          { name: 'enable-battle-mode', boolValue: true },
          { name: 'enable-battle-contrib-variants', boolValue: true },
          { name: 'jetski-autonomous-mode', boolValue: true },
          { name: 'labs-autonomous-mode', boolValue: true },
          { name: 'enable-agent-team', boolValue: true },
          { name: 'enable-swarm-monitor', boolValue: true },
          { name: 'enable-critique-preview', boolValue: true },
          { name: 'enable-sidebar-unread-dot', boolValue: true },
          { name: 'enable-file-explorer-tab', boolValue: true },
          { name: 'enable-code-search-palette', boolValue: true },
          { name: 'enable-git-vcs-ui', boolValue: true },
          { name: 'enable-jj-vcs-ui', boolValue: true },
          { name: 'enable-file-viewer-keyboard-navigation', boolValue: true },
          { name: 'markdown-table-v2', boolValue: true },
          { name: 'enable-pdf-viewer', boolValue: true },
          { name: 'enable-notebook-rendering', boolValue: true },
          { name: 'enable-upload-html-artifact-to-drive', boolValue: true },
          { name: 'enable-hub-builtin-browser', boolValue: true },
      { name: 'enable-browser-subagent-webview-ux', boolValue: true },
          { name: 'enable-jetbox-terminal-v2', boolValue: true },
          { name: 'remote-control-setting-enabled', boolValue: true },
          { name: 'enable-remote-control-audio-transcription', boolValue: true },
          { name: 'enable-plugin-context-providers', boolValue: true },
          { name: 'enable-mcp-plugin-auth', boolValue: true },
          { name: 'enable-mcp-non-blocking-turn-load', boolValue: true },
          { name: 'enable-remote-ai', boolValue: true },
          { name: 'enable-conversation-sharing-prototype', boolValue: true },
          { name: 'enable-terminal-setup-script', boolValue: true },
          { name: 'enable-context-menu-system', boolValue: true },
          { name: 'configure-artifact-width', boolValue: true },
          { name: 'enable-sidecar-pill-auto-open', boolValue: true },
          { name: 'enable-notifications-settings', boolValue: true },
          { name: 'enable-plugin-auth', boolValue: true },
          { name: 'enable-text-transitions', boolValue: true },
          { name: 'enable-catch-file-viewer', boolValue: true },
          { name: 'enable-project-4k', boolValue: false },
          { name: 'project-4k', boolValue: false },
          { name: 'enable-workspace-scoped-jetski-extension', boolValue: true },
          { name: 'auto-command-config', stringValue: '{"system_allowlist": [], "sandbox_system_allowlist": ["head", "tail", "mkdir", "cd", "cp", "mv", "cat", "find", "grep", "rm", "touch", "less", "clear", "ls"]}' },
          { name: 'cascade-conversation-history-config', stringValue: '{"enabled": true, "max_conversations": 20}' },
          { name: 'invoke-subagent-config', stringValue: '{"enabled": true, "always_inherit_model": false}' },
          { name: 'log-artifacts-config', stringValue: '{"enabled": true, "hideNominalToolSteps": false, "hidePlannerResponseText": false, "maxBytesPerStep": 4096, "maxBytesPerToolArg": 2048, "hideSystemSteps": false, "hideUserImplicitSteps": false}' },
        ];
        return JSON.stringify({
          experimentIds: ['antigravity-2.21-full', 'plan-enabled', 'customizations-unlocked', 'automations-enabled'],
          flags,
        });
      };

      const enrichExperiments = enrichExperimentsPayload;

      // If we have a fresh cache (< 3 minutes), serve it immediately (ensuring enrichment)
      const freshCache = (Date.now() - memoryListExperimentsTime < 180_000) ? loadCachedExperiments() : null;
      if (freshCache) {
        log.debug('[Proxy] Serving fresh cached listExperiments response');
        const enrichedCache = enrichExperiments(freshCache);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedCache);
        }
        return;
      }

      const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.warn(`[Proxy] DNS resolution failed for ${targetHost} on listExperiments:`, e);
        const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
        const enrichedDns = enrichExperiments(cached);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedDns);
        }
        return;
      }

      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      fwdHeaders['host'] = targetHost;
      fwdHeaders['user-agent'] = 'antigravity';
      delete fwdHeaders['connection'];
      delete fwdHeaders['keep-alive'];
      delete fwdHeaders['accept-encoding'];

      const fwdOptions: https.RequestOptions = {
        method: req.method,
        headers: fwdHeaders as Record<string, string>,
        servername: targetHost,
      };

      const fallback = () => {
        if (res.headersSent || res.writableEnded) return;
        const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
        log.debug('[Proxy] Upstream listExperiments fallback active, serving 2.21 enabled flags');
        const enrichedFallback = enrichExperiments(cached);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedFallback);
        }
      };

      let completed = false;
      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        if (googleRes.statusCode === 429 || googleRes.statusCode === 503 || googleRes.statusCode === 401) {
          completed = true;
          fallback();
          return;
        }

        const chunks: Buffer[] = [];
        googleRes.on('data', (c) => chunks.push(c));
        googleRes.on('end', () => {
          if (completed || res.headersSent || res.writableEnded) return;
          completed = true;
          const body = Buffer.concat(chunks).toString('utf-8');
          if (googleRes.statusCode === 200 && body.startsWith('{')) {
            const enriched = enrichExperiments(body);
            saveCachedExperiments(enriched);
            if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
              safeEnd(res, enriched);
            }
          } else if (googleRes.statusCode && googleRes.statusCode < 500) {
            fallback();
          } else {
            fallback();
          }
        });
      });

      googleReq.setTimeout(8_000, () => {
        if (!completed) {
          completed = true;
          googleReq.destroy();
          fallback();
        }
      });

      googleReq.on('error', (err) => {
        if (!completed) {
          completed = true;
          log.warn('[Proxy] Upstream listExperiments network error:', err.message);
          fallback();
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
      return;
    }

    // 0.6. Intercept telemetry metrics & AGI-Control shadow evaluation to avoid noisy upstream 503 UNAVAILABLE errors
    if (
      req.url!.includes('/v1internal:recordCodeAssistMetrics') ||
      req.url!.includes('/v1internal:recordTrajectoryAnalytics') ||
      req.url!.includes('/v1internal:recordClientEvent') ||
      req.url!.includes('/v1internal:uploadPerformanceProfile') ||
      req.url!.includes('/v1internal:checkUrlDenylist') ||
      req.url!.includes('/v1internal:fetchFromTrawlerCache') ||
      req.url!.includes('/v1internal:batchFetchFromTrawlerCache')
    ) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({}));
      }
      return;
    }

    // 0.7. Intercept /v1internal:loadCodeAssist with caching and fast fallback
    if (req.url!.includes('/v1internal:loadCodeAssist')) {
      log.debug('[Proxy] Intercepting loadCodeAssist request');

      const buildDefaultFallback = () => {
        const customModels = loadCustomModels();
        const googleAccount = customModels.find((m) => (m as any).accountProject || (m as any).projectId);
        const projectId = (googleAccount as any)?.accountProject || (googleAccount as any)?.projectId || 'projects/antigravity-local';
        return JSON.stringify({
          cloudaicompanionProject: projectId,
          allowedTiers: [
            { id: 'free-tier', isDefault: false },
            { id: 'standard-tier', isDefault: false },
            { id: 'g1-pro-tier', isDefault: true },
          ],
          currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
          paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        });
      };

      // If we have cached code assist (disk or memory), serve it immediately to guarantee zero-latency response (< 2ms)
      const cached = loadCachedCodeAssist();
      if (cached) {
        log.debug('[Proxy] Serving cached loadCodeAssist response instantly (prevents LS deadline exceeded)');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cached);
        }
        return;
      }

      const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.warn(`[Proxy] DNS resolution failed for ${targetHost} on loadCodeAssist:`, e);
        const cached = loadCachedCodeAssist() || buildDefaultFallback();
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cached);
        }
        return;
      }

      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      fwdHeaders['host'] = targetHost;
      fwdHeaders['user-agent'] = 'antigravity';
      delete fwdHeaders['connection'];
      delete fwdHeaders['keep-alive'];
      delete fwdHeaders['accept-encoding'];

      const fwdOptions: https.RequestOptions = {
        method: req.method,
        headers: fwdHeaders as Record<string, string>,
        servername: targetHost,
      };

      const fallback = (isLocationBlocked?: boolean) => {
        if (res.headersSent || res.writableEnded) return;
        const cached = loadCachedCodeAssist() || buildDefaultFallback();
        log.warn(
          isLocationBlocked
            ? '[Proxy] Upstream loadCodeAssist blocked by LOCATION/GEO. Serving fallback (an egress VPN/proxy may be required for downstream inference).'
            : '[Proxy] Upstream loadCodeAssist failed/timed out, serving fallback response',
        );
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (isLocationBlocked) {
          headers['X-Antigravity-Location-Warning'] = 'LOCATION_BLOCKED';
        }
        if (safeWriteHead(res, 200, headers)) {
          safeEnd(res, cached);
        }
      };

      let completed = false;
      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        if (googleRes.statusCode === 429 || googleRes.statusCode === 503) {
          completed = true;
          fallback();
          return;
        }

        const chunks: Buffer[] = [];
        googleRes.on('data', (c) => chunks.push(c));
        googleRes.on('end', () => {
          if (completed || res.headersSent || res.writableEnded) return;
          completed = true;
          const body = Buffer.concat(chunks).toString('utf-8');
          if (googleRes.statusCode === 200 && body.startsWith('{')) {
            const unlockedBody = unlockCodeAssistPayload(body);
            saveCachedCodeAssist(unlockedBody);
            if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
              safeEnd(res, unlockedBody);
            }
          } else if (
            googleRes.statusCode === 403 ||
            (googleRes.statusCode === 400 && (body.includes('LOCATION') || body.includes('1008') || body.toLowerCase().includes('location')))
          ) {
            log.warn(`[Proxy] Upstream loadCodeAssist rejected with HTTP ${googleRes.statusCode} (${body.slice(0, 150)}). Serving unlocked fallback with location warning.`);
            fallback(true);
          } else if (googleRes.statusCode && googleRes.statusCode < 500) {
            if (safeWriteHead(res, googleRes.statusCode, { 'Content-Type': 'application/json' })) {
              safeEnd(res, body);
            }
          } else {
            fallback();
          }
        });
      });

      googleReq.setTimeout(2_500, () => {
        if (!completed) {
          completed = true;
          googleReq.destroy();
          fallback();
        }
      });

      googleReq.on('error', (err) => {
        if (!completed) {
          completed = true;
          log.warn('[Proxy] Upstream loadCodeAssist network error:', err.message);
          fallback();
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
      return;
    }

    // 1. Intercept /v1internal:fetchAvailableModels
    if (req.url!.includes('/v1internal:fetchAvailableModels')) {
      log.debug('[Proxy] Intercepting fetchAvailableModels request');

      // If we have a fresh in-memory cache (< 60s), serve it immediately to prevent LS WaitForReady deadline exceeded
      const cachedModels = loadCachedAvailableModels();
      if (cachedModels && memoryFetchAvailableModelsTime && Date.now() - memoryFetchAvailableModelsTime < 60_000) {
        log.debug('[Proxy] Serving fresh cached fetchAvailableModels response instantly (prevents LS WaitForReady deadline exceeded)');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cachedModels);
        }
        return;
      }

      // Fire async health check (non-blocking)
      const customModelsForHealth = loadCustomModels();
      if (customModelsForHealth.length > 0) {
        checkAllModelsHealth(customModelsForHealth).catch((err) => {
          log.error('[Proxy] Background health check failed:', err);
        });
      }

      const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.warn(`[Proxy] DNS resolution failed for ${targetHost}, serving cached/synthetic custom models:`, e);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
        }
        return;
      }
      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      fwdHeaders['host'] = targetHost;
      delete fwdHeaders['connection'];
      delete fwdHeaders['keep-alive'];
      delete fwdHeaders['accept-encoding'];

      const fwdOptions: https.RequestOptions = {
        method: req.method,
        headers: fwdHeaders as Record<string, string>,
        servername: targetHost,
      };

      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        let googleResErrored = false;
        googleRes.on('error', (err) => {
          googleResErrored = true;
          log.error('[Proxy] fetchAvailableModels upstream error:', err.message);
        });

        let googleBody = '';
        googleRes.on('data', (chunk) => (googleBody += chunk));
        googleRes.on('end', () => {
          // Guard: timeout or upstream error may have already terminated the response
          if (googleResErrored || res.headersSent || res.writableEnded) {
            log.debug('[Proxy] fetchAvailableModels: skipping end handler (response terminated)');
            return;
          }
          let googleJson: Record<string, unknown> | null = null;
          try {
            log.debug(
              `[Proxy] fetchAvailableModels response status: ${googleRes.statusCode}, body length: ${googleBody.length}`,
            );

            try {
              googleJson = JSON.parse(googleBody) as Record<string, unknown>;
            } catch {
              log.warn(
                `[Proxy] fetchAvailableModels: non-JSON response from upstream (status: ${googleRes.statusCode}), generating synthetic models map`,
              );
              googleJson = { models: {} };
            }
            // DEBUG: dump raw upstream fetchAvailableModels response for diagnosis
            fs.promises
              .writeFile(path.join(os.tmpdir(), 'ag-fetchAvailableModels-dump.json'), JSON.stringify(googleJson, null, 2))
              .catch(() => {});
            const customModels = loadCustomModels();

            log.debug(`[Proxy] Loaded custom models count: ${customModels.length}`);


            let merged = false;
            if (googleJson.models) {
              googleJson.models = mergeModels(googleJson.models, customModels);
              merged = true;
            }
            if (googleJson.availableModels) {
              googleJson.availableModels = mergeModels(googleJson.availableModels, customModels);
              merged = true;
            }
            if (googleJson.available_models) {
              googleJson.available_models = mergeModels(googleJson.available_models, customModels);
              merged = true;
            }

            if (!merged) {
              const synth = buildSyntheticModelsResponse(customModels);
              googleJson.models = synth.models;
              if (!googleJson.agentModelSorts) googleJson.agentModelSorts = synth.agentModelSorts;
            }

            // Sanitize modelExperiments: replace any unresolvable placeholder IDs in experiment strings
            // (e.g. CASCADE_USE_EXPERIMENT_CHECKPOINTER checkpoint_model: MODEL_PLACEHOLDER_M50) with gemini-3.8-flash
            if (googleJson.models && typeof googleJson.models === 'object') {
              for (const mEntry of Object.values(googleJson.models as Record<string, any>)) {
                if (mEntry?.modelExperiments?.experiments) {
                  for (const exp of Object.values(mEntry.modelExperiments.experiments as Record<string, any>)) {
                    if (typeof exp?.stringValue === 'string' && exp.stringValue.includes('MODEL_PLACEHOLDER_')) {
                      exp.stringValue = exp.stringValue.replace(
                        /"checkpoint_model":\s*"MODEL_PLACEHOLDER_[^"]+"/g,
                        '"checkpoint_model": "gemini-3.8-flash"',
                      );
                    }
                  }
                }
              }
            }

            // Unlock any Ultra-gated models (e.g. Gemini 4 Argon) so they appear active and selectable in IDE
            const unlockModelsMap = (modelsMap: any) => {
              if (!modelsMap || typeof modelsMap !== 'object') return;
              for (const [mId, mEntry] of Object.entries(modelsMap as Record<string, any>)) {
                if (!mEntry || typeof mEntry !== 'object') continue;
                const mDisp = String(mEntry.displayName || '');
                const mTag = String(mEntry.tagTitle || '');
                const mDesc = String(mEntry.tagDescription || '');
                if (
                  mId.toLowerCase().includes('argon') ||
                  mDisp.toLowerCase().includes('argon') ||
                  mTag.toLowerCase().includes('unavailable') ||
                  mDesc.toLowerCase().includes('ultra') ||
                  mEntry.disabled === true
                ) {
                  delete mEntry.disabled;
                  if (mTag.toLowerCase().includes('unavailable') || mDesc.toLowerCase().includes('ultra')) {
                    delete mEntry.tagTitle;
                    delete mEntry.tagDescription;
                  }
                  if (!mEntry.quotaInfo) {
                    mEntry.quotaInfo = {
                      remainingFraction: 1,
                      resetTime: '2099-01-01T00:00:00Z',
                    };
                  }
                }
              }
            };
            unlockModelsMap(googleJson.models);
            unlockModelsMap(googleJson.availableModels);
            unlockModelsMap(googleJson.available_models);

            // 2. Injecter les modèles personnalisés dans agentModelSorts (menu déroulant Antigravity IDE)
            // Modèles originaux en tête de liste, modèles personnalisés ajoutés sans duplication
            try {
              if (typeof injectCustomSlugsIntoAgentModelSorts === 'function') {
                injectCustomSlugsIntoAgentModelSorts(googleJson, customModels);
              }
            } catch (sortErr) {
              log.warn('[Proxy] Failed to inject custom slugs into agentModelSorts:', sortErr);
            }

            // P1: Strip Google's upstream error from the response. When Google
            // returns 401/403/etc., the proxy forwards that error object alongside
            // our injected custom models. The Antigravity frontend treats any
            // `error` key as a hard failure and hides the entire model list,
            // even though we successfully injected valid models. Removing the
            // error key lets the frontend render the merged model list normally.
            if (googleJson.error) {
              log.warn(
                `[Proxy] fetchAvailableModels: stripping upstream error from response (status: ${googleRes.statusCode})`,
              );
              delete (googleJson as Record<string, unknown>).error;
            }

            const finalPayload = JSON.stringify(googleJson);
            saveCachedAvailableModels(finalPayload);
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, finalPayload);
          } catch (err) {
            log.error('[Proxy] Parsing fetchAvailableModels failed:', err);
            if (res.headersSent || res.writableEnded) return;
            const customModels = loadCustomModels();
            const mappedCustom: Record<string, unknown> = {};
            customModels.forEach((m) => {
              const slug = toSlug(m);
              const pid = generateModelPlaceholderId(m);
              const entry = {
                displayName: m.displayName,
                maxTokens: 1048576,
                maxOutputTokens: 4096,
                model: pid,
                planModel: pid,
                requestedModel: pid,
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              };
              mappedCustom[slug] = entry;
              mappedCustom[pid] = entry;
            });
            // If googleJson has models, preserve them!
            let responsePayload: Record<string, unknown> = { models: mappedCustom };
            if (googleJson && typeof googleJson === 'object') {
              if (googleJson.models && typeof googleJson.models === 'object') {
                responsePayload = { ...googleJson, models: { ...(googleJson.models as Record<string, unknown>), ...mappedCustom } };
              } else {
                responsePayload = { ...googleJson, models: mappedCustom };
              }
            }
            const fallbackStr = JSON.stringify(responsePayload);
            saveCachedAvailableModels(fallbackStr);
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, fallbackStr);
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Forwarding fetchAvailableModels failed:', err.message);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
        }
      });

      // Bound upstream timeout to 3,500ms to stay safely below Go Language Server's 5s WaitForReady context deadline
      const FETCH_AVAILABLE_MODELS_TIMEOUT_MS = 3_500;
      googleReq.setTimeout(FETCH_AVAILABLE_MODELS_TIMEOUT_MS, () => {
        log.warn(`[Proxy] fetchAvailableModels forward request timed out after ${FETCH_AVAILABLE_MODELS_TIMEOUT_MS}ms. Serving cached/synthetic models to prevent LS WaitForReady deadline exceeded.`);
        googleReq.destroy();
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
      return;
    }

    // 2. Intercept /v1beta/models or /v1/models list request
    if (req.method === 'GET' && (req.url!.endsWith('/models') || req.url!.includes('/models?'))) {
      log.debug('[Proxy] Intercepting models list request');

      const targetHost = GOOGLE_HOSTS.GENERATIVE_LANGUAGE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
        if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost } }));
        }
        return;
      }
      const mdlHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      mdlHeaders['host'] = targetHost;
      delete mdlHeaders['connection'];
      delete mdlHeaders['accept-encoding'];

      const mdlOptions: https.RequestOptions = {
        method: 'GET',
        headers: mdlHeaders as Record<string, string>,
        servername: targetHost,
      };

      const googleReq = https.request(parsedUrl, mdlOptions, (googleRes) => {
        let googleResErrored = false;
        googleRes.on('error', (err) => {
          googleResErrored = true;
          log.error('[Proxy] Models list upstream error:', err.message);
        });

        let googleBody = '';
        googleRes.on('data', (chunk) => (googleBody += chunk));
        googleRes.on('end', () => {
          // Guard: timeout or upstream error may have already terminated the response
          if (googleResErrored || res.headersSent || res.writableEnded) {
            log.debug('[Proxy] Models list: skipping end handler (response terminated)');
            return;
          }
          try {
            const googleJson = JSON.parse(googleBody) as { models?: unknown[] };
            const customModels = loadCustomModels();

            const mappedCustom = customModels.map((m) => ({
              name: 'models/' + generateModelPlaceholderId(m),
              version: '1.0',
              displayName: m.displayName,
              description: m.description,
              inputTokenLimit: 1048576,
              outputTokenLimit: 4096,
              supportedGenerationMethods: ['generateContent', 'countTokens'],
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
            }));

            if (googleJson.models) {
              googleJson.models = [...mappedCustom, ...googleJson.models];
            } else {
              googleJson.models = mappedCustom;
            }

            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify(googleJson));
          } catch (err) {
            log.error('[Proxy] Google list models failed:', err);
            if (res.headersSent || res.writableEnded) return;
            safeWriteHead(res, 502, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ error: { message: `Upstream models parse error: ${(err as Error).message}` } }));
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Google models list request error:', err);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(
            res,
            JSON.stringify({
              models: customModels.map((m) => ({
                name: m.name,
                displayName: m.displayName,
                description: m.description,
                supportedGenerationMethods: ['generateContent'],
              })),
            }),
          );
        }
      });

      // P0-5: Timeout for models list forward request (30s)
      googleReq.setTimeout(30_000, () => {
        log.error('[Proxy] Models list forward request timed out');
        googleReq.destroy();
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(
            res,
            JSON.stringify({
              models: customModels.map((m) => ({
                name: m.name,
                displayName: m.displayName,
                description: m.description,
                supportedGenerationMethods: ['generateContent'],
              })),
            }),
          );
        }
      });
      googleReq.end();
      return;
    }

    // 3. Intercept Cloud Code generation stream or non-stream requests
    let isSessionRemote = false;
    let convId: string | null = null;
    let sessId = '';
    const isCloudCodeStream =
      (req.url!.includes('v1internal') || req.url!.includes('cloudcode')) &&
      (req.url!.includes('streamGenerateContent') || req.url!.includes('generateContent'));
    if (req.method === 'POST' && isCloudCodeStream) {
      try {
        const reqJson = JSON.parse(bodyStr) as Record<string, unknown>;
        const targetReq = (reqJson.request || reqJson) as Record<string, unknown>;

        if (targetReq.systemInstruction && typeof targetReq.systemInstruction === 'object') {
          const si = targetReq.systemInstruction as { parts?: Array<{ text?: string }> };
          const fullSysText = (si.parts || []).map((p) => p.text || '').join('\n');
          const match = fullSysText.match(/Conversation ID:\s*([a-f0-9\-]+)/i);
          if (match) convId = match[1];
        }

        const candidateNames = [
          reqJson.model,
          reqJson.selectedModel,
          reqJson.requestedModel,
          reqJson.modelId,
          reqJson.model_id,
          reqJson.agentModel,
          targetReq.model,
          targetReq.selectedModel,
          targetReq.requestedModel,
          targetReq.modelId,
          targetReq.model_id,
          targetReq.agentModel,
        ].filter((x): x is string => typeof x === 'string' && Boolean(x));

        // Fast-path for IDE internal command input detection (run_command_handler.go)
        const isInputDetection = candidateNames.some((cn) =>
          /2[_\-]5[_\-]flash[_\-]lite|flash[_\-]lite|input[_\-]detect/i.test(cn) ||
          /MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE/i.test(cn)
        );
        if (isInputDetection) {
          const detectedSess = extractSessionId(targetReq, req.headers as Record<string, unknown>) || '';
          log.info(`[Proxy] ? Instant mock resolution for input-detection model call (0ms) [model=${candidateNames[0] || 'input-detect'}${detectedSess ? ` session=${detectedSess}` : ''}]`);
          const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
          if (isStream) {
            if (safeWriteHead(res, 200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            })) {
              const sseChunk = `data: ${JSON.stringify({
                response: {
                  candidates: [{
                    content: { parts: [{ text: 'false' }], role: 'model' },
                    finishReason: 'STOP',
                    index: 0,
                  }],
                },
              })}\n\n`;
              res.write(sseChunk);
              safeEnd(res);
            }
          } else {
            const jsonResp = Buffer.from(JSON.stringify({
              response: {
                candidates: [{
                  content: { parts: [{ text: 'false' }], role: 'model' },
                  finishReason: 'STOP',
                  index: 0,
                }],
              },
            }), 'utf-8');
            if (safeWriteHead(res, 200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': String(jsonResp.length),
            })) {
              safeEnd(res, jsonResp);
            }
          }
          return;
        }

        log.debug(
          `[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`,
        );

        const customModels = expandModelsWithEffort(loadCustomModels());
        let actualGeminiBody: GeminiRequestBody | undefined;
        let sessionKey = '';
        let isAuxiliaryReq = false;
        let auxiliaryType = '';

        if (candidateNames.length > 0) {
          actualGeminiBody = (reqJson.request || reqJson) as GeminiRequestBody;
          sessId = extractSessionId(actualGeminiBody as Record<string, unknown>, req.headers as Record<string, unknown>) || '';
          sessionKey = convId || sessId;

          const rType = String(
            targetReq.requestType ||
            reqJson.requestType ||
            (targetReq as any).type ||
            ''
          ).toUpperCase();
          if (
            rType === 'CONVERSATION_TITLE' ||
            rType === 'TITLE' ||
            rType === 'SUMMARY' ||
            rType === 'CONVERSATION_SUMMARY' ||
            rType === 'SEARCH' ||
            rType === 'INDEX' ||
            rType === 'CORTEX' ||
            rType === 'SONAR'
          ) {
            isAuxiliaryReq = true;
            auxiliaryType = rType;
          } else {
            const siText = (targetReq.systemInstruction as any)?.parts?.[0]?.text || '';
            if (
              /generate a (?:short |concise )?title/i.test(siText) ||
              /summarize the conversation/i.test(siText)
            ) {
              isAuxiliaryReq = true;
              auxiliaryType = /title/i.test(siText) ? 'TITLE' : 'SUMMARY';
            }
          }

          const customCandidate = candidateNames.find(
            (cn) => /MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-') || customModels.some((m) => matchesCustomModel(m, cn))
          );
          const requestedRaw = String(
            customCandidate ||
            reqJson.selectedModel ||
            targetReq.selectedModel ||
            reqJson.model ||
            targetReq.model ||
            reqJson.requestedModel ||
            targetReq.requestedModel ||
            candidateNames[0] ||
            ''
          ).toLowerCase();
          const cleanRequested = requestedRaw.replace(/^models\//, '').trim();
          const isExplicitCustom = Boolean(customCandidate);
          const isPrimaryNative = !isExplicitCustom && (isNativeCloudCodeModel(cleanRequested) || cleanRequested.includes('argon'));
          const isNativeCloudCode = isPrimaryNative || (!isExplicitCustom && (
            cleanRequested.includes('argon') ||
            candidateNames.some((cn) => isNativeCloudCodeModel(cn.replace(/^models\//, '').trim()))
          ));

          // Check if this request is an automated Language Server fallback on a failed native session
          const activeNative = (sessionKey ? getNativeSession(sessionKey) : undefined) ||
                               (convId ? getNativeSession(convId) : undefined) ||
                               (sessId ? getNativeSession(sessId) : undefined) ||
                               (!sessionKey && !convId && !sessId ? getLatestNativeErrorAsSession() : undefined);
          const isNativeProtected = Boolean(
            activeNative &&
            activeNative.lastError &&
            activeNative.originalModel &&
            isNativeCloudCodeModel(activeNative.originalModel)
          );
          const normOrig = isNativeProtected ? (normalizeCloudCodeModelId(activeNative!.originalModel) || activeNative!.originalModel.toLowerCase()) : '';
          const normCurrent = normalizeCloudCodeModelId(cleanRequested) || cleanRequested.toLowerCase();
          const isSameModel = isNativeProtected && (
            normOrig === normCurrent ||
            (normOrig.includes('sonnet') && normCurrent.includes('sonnet')) ||
            (normOrig.includes('opus') && normCurrent.includes('opus')) ||
            (normOrig.includes('flash') && normCurrent.includes('flash') && !normOrig.includes('pro'))
          );
          const isExplicitUserCustom = isExplicitCustom;

          if (isExplicitUserCustom) {
            // User explicitly switched to a custom model from the UI!
            // Clear any native session lock so user's explicit selection is honored immediately.
            if (sessionKey) nativeSessions.delete(sessionKey);
            if (convId) nativeSessions.delete(convId);
            if (sessId) nativeSessions.delete(sessId);
            clearLatestNativeGlobalError();
          }

          const isFallbackToDifferentModel = isNativeProtected && !isSameModel && !isExplicitUserCustom;

          if (isFallbackToDifferentModel) {
            const timeSinceNative = Date.now() - activeNative!.lastSeen;
            if (timeSinceNative < NATIVE_CASCADE_BLOCK_WINDOW_MS) {
              log.warn(
                `[Proxy] ? Blocked automated Language Server fallback to [${requestedRaw}] on native session [${sessionKey || convId || sessId || 'unknown'}] (original model: [${activeNative!.originalModel}], within cascade window). Strict ZERO fallback rule: rejecting fallback to report original error directly.`
              );
              const err = activeNative!.lastError;
              if (err && err.body && err.body.length > 0) {
                const respHeaders = { ...err.headers };
                delete respHeaders['transfer-encoding'];
                respHeaders['content-length'] = String(err.body.length);
                if (safeWriteHead(res, err.statusCode, respHeaders)) {
                  safeEnd(res, err.body);
                }
                return;
              } else {
                const errCode = err?.statusCode || 429;
                const fallbackPayload = Buffer.from(
                  JSON.stringify({
                    error: {
                      code: errCode,
                      message: errCode === 404
                        ? `Model ${activeNative!.originalModel || cleanRequested} is not available.`
                        : `Resource has been exhausted (e.g. check quota) for model ${activeNative!.originalModel || cleanRequested}.`,
                      status: errCode === 404 ? 'NOT_FOUND' : 'RESOURCE_EXHAUSTED',
                    },
                  }),
                  'utf-8',
                );
                if (safeWriteHead(res, errCode, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(fallbackPayload.length) })) {
                  safeEnd(res, fallbackPayload);
                }
                return;
              }
            }
          }

          if (isNativeCloudCode) {
            reqJson.model = cleanRequested;
            if (targetReq && typeof targetReq === 'object') {
              targetReq.model = cleanRequested;
            }
            // Strip any stale custom placeholder models from previous conversation turns
            for (let i = candidateNames.length - 1; i >= 0; i--) {
              if (/MODEL_PLACEHOLDER_/i.test(candidateNames[i]) || candidateNames[i].startsWith('custom-')) {
                candidateNames.splice(i, 1);
              }
            }
            if (!candidateNames.includes(cleanRequested)) {
              candidateNames.unshift(cleanRequested);
            }

            // Fresh native turn: mark native session
            if (sessionKey) markNativeSession(sessionKey, cleanRequested);
            if (convId && convId !== sessionKey) markNativeSession(convId, cleanRequested);
            if (sessId && sessId !== sessionKey) markNativeSession(sessId, cleanRequested);

            if (sessionKey) clearSessionModelFallback(sessionKey);
            if (convId) clearSessionModelFallback(convId);
            if (sessId) clearSessionModelFallback(sessId);
          } else {
            // User explicitly requested a custom model: clear any native session lock
            if (sessionKey) nativeSessions.delete(sessionKey);
            if (convId) nativeSessions.delete(convId);
            if (sessId) nativeSessions.delete(sessId);
          }

          if (sessionKey && !isNativeCloudCode) {
            const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
            if (!allowCrossModel) {
              clearSessionModelFallback(sessionKey);
            } else {
              const explicitSelected = (
                reqJson.model ||
                reqJson.selectedModel ||
                targetReq.model ||
                targetReq.selectedModel ||
                reqJson.requestedModel ||
                targetReq.requestedModel
              ) as string | undefined;

              const activeFallback = getSessionModelFallback(sessionKey);
              if (activeFallback && explicitSelected) {
                const normExplicit = normalizeCloudCodeModelId(explicitSelected);
                const isNative = isNativeCloudCodeModel(explicitSelected.replace(/^models\//, ''));
                if (isNative) {
                  log.info(
                    `[Proxy] ?? User switched to native model [${explicitSelected}]. Clearing active session fallback [${activeFallback.originalModel} -> ${activeFallback.fallbackModel}].`,
                  );
                  clearSessionModelFallback(sessionKey);
                } else {
                  const isFallback = normExplicit === normalizeCloudCodeModelId(activeFallback.fallbackModel);
                  const isOriginal = normExplicit === normalizeCloudCodeModelId(activeFallback.originalModel);
                  if (!isFallback && !isOriginal) {
                    log.info(
                      `[Proxy] ?? User explicitly selected different model [${explicitSelected}]. Clearing active session fallback [${activeFallback.originalModel} -> ${activeFallback.fallbackModel}].`,
                    );
                    clearSessionModelFallback(sessionKey);
                  }
                }
              }
            }
          }
        }

        const customCandidate = candidateNames.find(
          (cn) => /MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-') || customModels.some((m) => matchesCustomModel(m, cn))
        );
        const requestedRaw = String(
          customCandidate ||
          reqJson.selectedModel ||
          targetReq.selectedModel ||
          reqJson.model ||
          targetReq.model ||
          reqJson.requestedModel ||
          targetReq.requestedModel ||
          candidateNames[0] ||
          ''
        ).toLowerCase();
        let cleanRequested = requestedRaw.replace(/^models\//, '').trim();

        let detectedExplicitEffort: string | undefined;
        if (customCandidate) {
          const matchedExplicit = customModels.find((m) => matchesCustomModel(m, customCandidate));
          if (matchedExplicit) {
            detectedExplicitEffort = (matchedExplicit._effortSuffix?.replace('-', '') || matchedExplicit.reasoningEffort || '').toLowerCase();
          }
        }
        if (!detectedExplicitEffort) {
          for (const cn of candidateNames) {
            const mEff = /(?:^|[-_ (])(low|medium|high)(?:$|[-_ )])/i.exec(cn)?.[1]?.toLowerCase();
            if (mEff) {
              detectedExplicitEffort = mEff;
              break;
            }
          }
        }

        if (detectedExplicitEffort && !isAuxiliaryReq) {
          if (sessionKey) setSessionEffortAffinity(sessionKey, detectedExplicitEffort);
          if (sessId && sessId !== sessionKey) setSessionEffortAffinity(sessId, detectedExplicitEffort);
        }

        const inheritedEffort = (!detectedExplicitEffort && !isAuxiliaryReq && (sessionKey || sessId))
          ? (getSessionEffortAffinity(sessionKey) || (sessId ? getSessionEffortAffinity(sessId) : undefined))
          : undefined;

        const activeFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
        if (activeFallback) {
          const normReq = normalizeCloudCodeModelId(cleanRequested);
          const normOrig = normalizeCloudCodeModelId(activeFallback.originalModel);
          const isOrigClaude = activeFallback.originalModel.toLowerCase().includes('claude');
          const matchesOrig = normReq === normOrig || candidateNames.some((cn) => {
            const norm = normalizeCloudCodeModelId(cn);
            return norm === normOrig || (isOrigClaude && cn.toLowerCase().includes('claude'));
          });
          if (matchesOrig) {
            log.info(
              `[Proxy] ?? [Active Session Fallback] Seamlessly routing session ${sessionKey} to [${activeFallback.fallbackModel}] (primary [${activeFallback.originalModel}] in temporary fallback cooldown)`
            );
            cleanRequested = activeFallback.fallbackModel;
          }
        }
        const isExplicitCustom = Boolean(customCandidate);
        const isPrimaryNative = !isExplicitCustom && (isNativeCloudCodeModel(cleanRequested) || cleanRequested.includes('argon'));
        const isNativeCloudCode = isPrimaryNative || (!isExplicitCustom && (
          cleanRequested.includes('argon') ||
          candidateNames.some((cn) => isNativeCloudCodeModel(cn.replace(/^models\//, '').trim()))
        ));

        let matchingCandidates: typeof customModels = [];
        let isNativeRoutedToPool = false;
        if (isNativeCloudCode) {
          const googlePoolCandidates = customModels.filter(
            (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
                   m.enabled !== false &&
                   !(m as any)._poolOnly
          );
          if (googlePoolCandidates.length > 0 && process.env.AG_POOL_NATIVE_MODELS !== '0') {
            const normReq = normalizeCloudCodeModelId(cleanRequested);
            const matchedPool = googlePoolCandidates.filter((m) => {
              const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
              return mTarget === cleanRequested.toLowerCase() ||
                     (normReq && normalizeCloudCodeModelId(mTarget) === normReq);
            });
            let effectivePool = matchedPool;
            if (inheritedEffort && matchedPool.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
              effectivePool = matchedPool.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
            }
            if (effectivePool.length > 0) {
              log.info(`[Proxy] ?? Routing native model [${requestedRaw}] through Google multi-account pool (${effectivePool.length} candidate(s))${inheritedEffort ? ` [Inherited Effort: ${inheritedEffort}]` : ''}.`);
              matchingCandidates = effectivePool;
              isNativeRoutedToPool = true;
            } else {
              log.info(`[Proxy] ? Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
            }
          } else {
            log.info(`[Proxy] ? Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
          }
        } else {
          // Strictly prioritize the model matching cleanRequested (the directly requested model)
          let candidates = customModels.filter((m) => matchesCustomModel(m, cleanRequested));
          if (inheritedEffort && candidates.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
            candidates = candidates.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
          }
          matchingCandidates = candidates;
          if (matchingCandidates.length === 0) {
            // Check candidateNames in precedence order without mixing disparate models
            for (const cn of candidateNames) {
              let matched = customModels.filter((m) => matchesCustomModel(m, cn));
              if (inheritedEffort && matched.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
                matched = matched.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
              }
              if (matched.length > 0) {
                matchingCandidates = matched;
                break;
              }
            }
          }
          if (matchingCandidates.length === 0) {
            for (const cn of candidateNames) {
              if (/MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-')) continue;
              const norm = normalizeGoogleModelId(cn);
              if (norm) {
                const matched = customModels.filter((m) => matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
                if (matched.length > 0) {
                  matchingCandidates = matched;
                  break;
                }
              }
            }
          }
        }
        const targetFam = (cleanRequested || candidateNames[0] || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
        let matchedCustomModel = (isNativeCloudCode && !isNativeRoutedToPool) ? undefined : selectBestModelByQuota(matchingCandidates, customModels, targetFam);
        // Fallback: if a conversation references a placeholder (e.g. M299/M298/M50/M319/M565)
        if (!isNativeCloudCode && !matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
          const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
          matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, targetFam) || activePool[0] || customModels[0];
        }

        const effectiveModelName = (
          matchedCustomModel?.externalModelName ||
          matchedCustomModel?.name ||
          candidateNames[0] ||
          ''
        ).toLowerCase();
        const isClaudeRequest = effectiveModelName.includes('claude');

        // Restore any missing thought_signatures in conversation history for Gemini 3+ function calls
        let signaturesRestored = false;
        let contentsNormalized = false;
        if (Array.isArray(targetReq.contents)) {
          if (normalizeConversationTurns(targetReq.contents)) {
            contentsNormalized = true;
          }
          if (isClaudeRequest) {
            sanitizeCloudCodeGenerationConfig(targetReq, effectiveModelName);
            contentsNormalized = true;
          } else if (sessionKey && isConvCorruptedSignatures(sessionKey)) {
            // This conversation already experienced rejected/corrupted thought signatures upstream.
            // Proactively flatten tool calls in past history to plain text to prevent doomed 400 errors and retries.
            if (flattenAllToolCallsToText(targetReq.contents)) {
              contentsNormalized = true;
              normalizeConversationTurns(targetReq.contents);
              injectAntiHallucinationInstruction(targetReq);
            }
          } else {
            signaturesRestored = restoreThoughtSignatures(targetReq.contents, sessionKey, effectiveModelName);
            if (sanitizeUnsignedToolCalls(targetReq.contents)) {
              contentsNormalized = true;
              normalizeConversationTurns(targetReq.contents);
              injectAntiHallucinationInstruction(targetReq);
            }
          }
        }

        // Subagent Effort Governor: only clamp if AG_CLAMP_SUBAGENTS=1 is explicitly set
        // Disabled by default to strictly honor user-selected reasoning effort without quota throttling
        if (process.env.AG_CLAMP_SUBAGENTS === '1' && clampSubagentReasoning(targetReq)) {
          log.info(`[Proxy] ??? Subagent detected: clamped thinking budget to 2048 tokens to conserve quota`);
          contentsNormalized = true;
        }

        if (!isClaudeRequest && (targetReq.tools || targetReq.toolConfig)) {
            injectAntiHallucinationInstruction(targetReq);
            contentsNormalized = true;
          }

          if (signaturesRestored || contentsNormalized) {
          fullBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
          log.debug(`[Proxy] Re-encoded Cloud Code request with normalized turns/signatures (convId=${sessionKey || 'draft'}, model=${effectiveModelName})`);
        }

          if (matchedCustomModel && (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name.includes(':auto-pool'))) {
            const rawTarget = (matchedCustomModel.externalModelName || matchedCustomModel.name)
              .replace(/^models\//, '')
              .replace(/^google:/, '')
              .replace(/:auto-pool.*$/, '');
            const baseName = getBaseModelId(rawTarget);
            const baseNorm = normalizeCloudCodeModelId(baseName);
            const targetEffort = matchedCustomModel._effortSuffix || matchedCustomModel.reasoningEffort || '';
            const realSiblings = customModels.filter((m) => {
              if (m.apiKey === 'auto' || m.name.includes(':auto-pool') || getOpenBreaker(m)) return false;
              const mRaw = (m.externalModelName || m.name)
                .replace(/^models\//, '')
                .replace(/^google:/, '')
                .replace(/:auto-pool.*$/, '');
              const mBase = getBaseModelId(mRaw);
              const mNorm = normalizeCloudCodeModelId(mBase);
              const mEffort = m._effortSuffix || m.reasoningEffort || '';
              return (mBase === baseName || (baseNorm && mNorm === baseNorm)) && mEffort === targetEffort;
            });
            matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, isClaudeRequest ? 'claude' : 'gemini') || matchedCustomModel;
          }

          if (matchedCustomModel) {
            const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

            // Apply Sticky Session affinity (preserves Cloud Code prompt cache)
            if (sessId) {
              matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
              bindSessionToModel(sessId, matchedCustomModel);
            }

            // Propagate reasoning effort / thinking level from matched model to Cloud Code payload
            const modelEffort = matchedCustomModel.reasoningEffort;
            const modelBudget = matchedCustomModel.thinkingBudget;
            if (modelEffort || modelBudget) {
              const target = (reqJson.request || reqJson) as Record<string, any>;
              if (!target.generationConfig) target.generationConfig = {};
              if (!target.generationConfig.thinkingConfig) target.generationConfig.thinkingConfig = {};
              if (modelEffort) {
                target.generationConfig.thinkingConfig.thinkingLevel = modelEffort;
              }
              if (modelBudget && !target.generationConfig.thinkingConfig.thinkingBudget) {
                target.generationConfig.thinkingConfig.thinkingBudget = modelBudget;
              }
            }

            const auxTag = isAuxiliaryReq ? ` [Auxiliary Task: ${auxiliaryType || 'BACKGROUND'}]` : '';
            log.info(
              `[Proxy] ?? [Incoming Request]${auxTag} Model requested: [${matchedCustomModel.displayName || matchedCustomModel.name}]${sessId ? ` (session: ${sessId})` : ''}`,
            );

            // Resolve fileData URIs then route to translator
            resolveFileData(actualGeminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
              if (isGoogleCloudCodeModel(matchedCustomModel) || matchedCustomModel.name.includes(':auto-pool') || matchedCustomModel.apiKey === 'auto') {
                try {
                  const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
                  const resolvedModelName = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
                  if (resolvedModelName) {
                    reqJson.model = resolvedModelName;
                    if (reqJson.request && typeof reqJson.request === 'object') {
                      (reqJson.request as Record<string, unknown>).model = resolvedModelName;
                    }
                  }
                  log.debug(`[Proxy] Forwarding Cloud Code request via multi-account pool (${accountPool.length} candidate accounts) for model ${resolvedModelName || matchedCustomModel.name}`);
                  await executeGoogleCloudCodeWithPool(
                    req,
                    res,
                    reqJson,
                    accountPool,
                    isSessionRemote,
                    sessionKey,
                    sessId,
                  );
                  return;
                } catch (err) {
                  log.error('[Proxy] Failed to execute Cloud Code request with pool, falling back to translator:', err);
                }
              }
              if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
                log.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
                if (!res.headersSent && !res.writableEnded) {
                  safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
                  safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
                }
                return;
              }

              handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
            });
            return;
          }
      } catch (err) {
        log.error('[Proxy] Failed to parse Cloud Code stream body:', err);
      }
    }

    // 4. Intercept standard generateContent / streamGenerateContent request
    const generateMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):generateContent/);
    const streamMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):streamGenerateContent/);

    const isGenerate = !!generateMatch;
    const isStandardStream = !!streamMatch;

    if (req.method === 'POST' && (isGenerate || isStandardStream)) {
      const matchedModelName = isGenerate ? generateMatch![1] : streamMatch![1];
      const isNative = !matchedModelName.startsWith('custom-') && isNativeCloudCodeModel(matchedModelName);
      let matchedCustomModel: CustomModel | undefined;
      let customModels: CustomModel[] = [];

      customModels = expandModelsWithEffort(loadCustomModels());
      if (isNative) {
        const googlePoolCandidates = customModels.filter(
          (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
                 m.enabled !== false &&
                 !(m as any)._poolOnly
        );
        const cleanMatched = matchedModelName.replace(/^models\//, '').toLowerCase();
        const normMatched = normalizeCloudCodeModelId(cleanMatched);
        const matchedPool = googlePoolCandidates.filter((m) => {
          const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
          return mTarget === cleanMatched || (normMatched && normalizeCloudCodeModelId(mTarget) === normMatched);
        });
        if (matchedPool.length > 0 && process.env.AG_POOL_NATIVE_MODELS !== '0') {
          log.info(`[Proxy] ?? Routing native model [${matchedModelName}] on direct URL through Google multi-account pool.`);
          matchedCustomModel = selectBestModelByQuota(matchedPool, customModels);
        } else {
          log.info(`[Proxy] ? Native Antigravity model requested on direct URL [${matchedModelName}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
        }
      } else {
        let matchingCandidates = customModels.filter((m) =>
          matchesCustomModel(m, matchedModelName),
        );
        if (matchingCandidates.length === 0) {
          const norm = normalizeGoogleModelId(matchedModelName);
          if (norm) {
            matchingCandidates = customModels.filter((m) =>
              matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`),
            );
          }
        }
        const directFam = (matchedModelName || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
        matchedCustomModel = selectBestModelByQuota(matchingCandidates, customModels, directFam);
        if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
          const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
          matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, directFam) || activePool[0] || customModels[0];
        }

        if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
          const baseName = getBaseModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
          const baseNorm = normalizeCloudCodeModelId(baseName);
          const realSiblings = customModels.filter((m) => {
            if (m.apiKey === 'auto' || getOpenBreaker(m)) return false;
            const mBase = getBaseModelId(m.externalModelName || m.name);
            const mNorm = normalizeCloudCodeModelId(mBase);
            return mBase === baseName || (baseNorm && mNorm === baseNorm);
          });
          matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, directFam) || matchedCustomModel;
        }
      }

      if (matchedCustomModel) {
        try {
          const geminiBody = JSON.parse(bodyStr) as GeminiRequestBody;
          if (Array.isArray(geminiBody.contents)) {
            normalizeConversationTurns(geminiBody.contents);
          }

          // Apply Sticky Session affinity (preserves prompt cache across multi-account pool)
          const sessId = extractSessionId(geminiBody as Record<string, unknown>, req.headers as Record<string, unknown>);
          if (sessId) {
            matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
            bindSessionToModel(sessId, matchedCustomModel);
          }

          resolveFileData(geminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
            if (isGoogleCloudCodeModel(matchedCustomModel)) {
              try {
                const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
                const targetModel = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
                sanitizeCloudCodeGenerationConfig(geminiBody as Record<string, unknown>, targetModel);
                const cloudCodePayload = {
                  project: (matchedCustomModel as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
                  model: targetModel,
                  request: geminiBody,
                };

                const origUrl = req.url;
                req.url = isStandardStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent';
                await executeGoogleCloudCodeWithPool(
                  req,
                  res,
                  cloudCodePayload,
                  accountPool,
                  false,
                  convId || '',
                  sessId,
                );
                req.url = origUrl;
                return;
              } catch (err) {
                log.error('[Proxy] Failed to route standard generateContent to Cloud Code natively:', err);
              }
            }

            if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
              log.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
              if (!res.headersSent && !res.writableEnded) {
                safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
                safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
              }
              return;
            }

            handleCustomModelRequest(res, matchedCustomModel, geminiBody, isStandardStream);
          });
          return;
        } catch (e) {
          log.error('[Proxy] JSON parse error in request body:', e);
          if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
            safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON request body' } }));
          }
          return;
        }
      }
    }

    // 5. Fallback: transparent proxy to Google
    // Strip any Claude thinking blocks before forwarding — they carry account-specific HMAC
    // signatures that become invalid if the account differs from the one that generated them.
    let rawModelName = '';
    try {
      const fallbackJson = JSON.parse(bodyStr) as Record<string, unknown>;
      const fallbackReq = (fallbackJson.request || fallbackJson) as Record<string, unknown>;
      rawModelName = extractModelNameFromPayload(fallbackJson).toLowerCase();
      if (typeof fallbackJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackJson.planModel)) {
        delete fallbackJson.planModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (typeof fallbackReq.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackReq.planModel)) {
        delete fallbackReq.planModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (rawModelName.includes('claude') && Array.isArray(fallbackReq.contents)) {
        sanitizeCloudCodeGenerationConfig(fallbackReq, rawModelName);
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (rawModelName.includes('2_5_flash_lite') || rawModelName.includes('2-5-flash-lite') || rawModelName.includes('flash_lite') || rawModelName.includes('flash-lite')) {
        const rewrittenModel = 'gemini-3.8-flash-tiered';
        fallbackJson.model = rewrittenModel;
        if (fallbackJson.request && typeof fallbackJson.request === 'object') {
          (fallbackJson.request as Record<string, unknown>).model = rewrittenModel;
        }
        rawModelName = rewrittenModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
    } catch { /* not JSON — continue as-is */ }

    // Intercept unresolved placeholder models so internal placeholders never leak to Google upstream
    if (/MODEL_PLACEHOLDER_/i.test(rawModelName) || /MODEL_PLACEHOLDER_/i.test(req.url || '')) {
      log.warn(`[Proxy] Unresolved custom model placeholder [${rawModelName}] reached fallback proxy. Rejecting locally with 503 rather than forwarding invalid placeholder to Google.`);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
        safeEnd(res, JSON.stringify({
          error: {
            code: 503,
            status: 'UNAVAILABLE',
            message: `Custom model placeholder [${rawModelName}] could not be resolved by local proxy. The model store may be reloading.`,
          },
        }));
      }
      return;
    }

    await proxyToGoogle(req, res, fullBody, isSessionRemote, undefined, convId || '', undefined, sessId || '', rawModelName);

  });
}
