import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

export let memoryListExperimentsCache: string | null = null;
export let memoryListExperimentsTime = 0;

export function getListExperimentsCachePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }
  return path.join(dir, 'list_experiments_cache.json');
}

export function loadCachedExperiments(): string | null {
  if (memoryListExperimentsCache) return memoryListExperimentsCache;
  try {
    const p = getListExperimentsCachePath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8').trim();
      if (content.startsWith('{')) {
        memoryListExperimentsCache = content;
        return content;
      }
    }
  } catch (e) {
    log.debug('[Proxy] Failed to load cached experiments:', e);
  }
  return null;
}

export function saveCachedExperiments(content: string): void {
  try {
    memoryListExperimentsCache = content;
    memoryListExperimentsTime = Date.now();
    const p = getListExperimentsCachePath();
    fs.writeFileSync(p, content, 'utf-8');
  } catch (e) {
    log.warn('[Proxy] Failed to save cached experiments:', e);
  }
}

export function enrichExperimentsPayload(rawBody: string): string {
  try {
    const data = JSON.parse(rawBody);
    if (!Array.isArray(data.flags)) {
      data.flags = [];
    }
    const requiredFlags = [
      { name: 'shadow-call-aicode-mendel', boolValue: false },
      { name: 'mendel_aicode_shadow_diff', boolValue: false },
      { name: 'enable-battle-mode-auto-trigger', boolValue: false },
      { name: 'supercomplete-fast-debounce', boolValue: true },
      { name: 'command-prompt-cache-config', stringValue: '{"enabled": true}' },
      { name: 'context-force-local-context', boolValue: true },
      { name: 'use-special-edit-code-block', boolValue: true },
      { name: 'supercomplete-always-use-cache-on-equal-state', boolValue: true },
      { name: 'supercomplete-max-concurrent-requests', intValue: 2 },
      { name: 'supercomplete-regular-debounce', intValue: 350 },
      { name: 'use-anthropic-token-efficient-tools-beta', boolValue: true },
      { name: 'cascade-use-replace-content-edit-tool', boolValue: true },
      { name: 'use-slash-plan', boolValue: true },
      { name: 'customization-token-budget', intValue: 20000 },
      { name: 'rules-token-budget', intValue: 20000 },
      { name: 'enable-subagent-hub', boolValue: true },
      { name: 'enable-skill-search-tool', boolValue: true },
      { name: 'enable-owl-slash-command', boolValue: true },
      { name: 'enable-browser-subagent-v2', boolValue: true },
      { name: 'send-subagent-initial-prompt-as-message', boolValue: true },
      { name: 'show-model-selection-change', boolValue: true },
      { name: 'scheduled-tasks-v2', boolValue: true },
      { name: 'enable-tasks', boolValue: true },
      { name: 'enable-conversation-search-v2', boolValue: true },
      { name: 'enable-background-task-accumulator', boolValue: true },
      { name: 'enable-aux-pane-redesign', boolValue: true },
      { name: 'enable-ui-sidecars', boolValue: true },
      { name: 'enable-sidecars', boolValue: true },
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
      { name: 'enable-battle-mode-custom-agents', boolValue: true },
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
      { name: 'enable-persistent-terminals', boolValue: true },
      { name: 'enable-jetbox-terminal-v2', boolValue: true },
      { name: 'enable-pty', boolValue: true },
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
    ];
    for (const reqFlag of requiredFlags) {
      const existing = data.flags.find((f: any) => f && f.name === reqFlag.name);
      if (!existing) {
        data.flags.push(reqFlag);
      } else if (reqFlag.boolValue !== undefined) {
        existing.boolValue = reqFlag.boolValue;
      } else if (reqFlag.intValue !== undefined) {
        existing.intValue = reqFlag.intValue;
      } else if ((reqFlag as any).stringValue !== undefined) {
        existing.stringValue = (reqFlag as any).stringValue;
      }
    }
    return JSON.stringify(data);
  } catch (_) {
    return rawBody;
  }
}
