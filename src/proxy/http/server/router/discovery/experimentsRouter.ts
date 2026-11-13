import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import log from 'electron-log';
import { GOOGLE_HOSTS } from '../../../../../constants';
import { resolveGoogleIp } from '../../dnsResolver';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import {
  enrichExperimentsPayload,
  loadCachedExperiments,
  saveCachedExperiments,
  memoryListExperimentsTime,
} from '../../../routes/endpointHandlers';

export function buildDefaultExperimentsFallback(): string {
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
}

export async function handleExperimentsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
): Promise<boolean> {
  if (!req.url!.includes('/v1internal:listExperiments')) {
    return false;
  }
  log.debug('[Proxy] Intercepting listExperiments request');

  const enrichExperiments = enrichExperimentsPayload;

  const freshCache = (Date.now() - memoryListExperimentsTime < 180_000) ? loadCachedExperiments() : null;
  if (freshCache) {
    log.debug('[Proxy] Serving fresh cached listExperiments response');
    const enrichedCache = enrichExperiments(freshCache);
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, enrichedCache);
    }
    return true;
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
    return true;
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
  return true;
}
