import fs from 'fs';
import path from 'path';

export interface DeveloperEnvironment {
  enabled: boolean;
  userCohort: 'google' | 'enterprise' | 'external';
  binary: 'hub' | 'editor';
  os: 'windows' | 'darwin' | 'linux';
}

export const OPTIMAL_45_FLAGS: Record<string, boolean> = {
  'enable-developer-mode': true,
  'enable-permissions-selector': true,
  'enable-thought-editing': true,
  'enable-thought-steering-from-selection': true,
  'enable-battle-mode': true,
  'enable-battle-contrib-variants': true,
  'enable-battle-mode-custom-agents': true,
  'jetski-autonomous-mode': true,
  'labs-autonomous-mode': true,
  'enable-agent-team': true,
  'enable-swarm-monitor': true,
  'enable-critique-preview': true,
  'enable-conversation-forking': true,
  'enable-fork-at-historical-step': true,
  'enable-fork-in-new-worktree': true,
  'enable-conversation-navigator': true,
  'enable-conversation-groups': true,
  'enable-conversation-sharing-prototype': true,
  'enable-trajectory-debug-tools': true,
  'enable-hub-builtin-browser': true,
  'enable-pdf-viewer': true,
  'enable-notebook-rendering': true,
  'enable-audio-transcription': true,
  'enable-voice-relay': true,
  'google-workspace-mentions': true,
  'enable-plugins': true,
  'enable-plugin-bundles': true,
  'enable-plugin-context-providers': true,
  'enable-mcp-plugin-auth': true,
  'enable-split-view': true,
  'enable-input-autocomplete': true,
  'enable-file-explorer-tab': true,
  'enable-code-search-palette': true,
  'enable-git-vcs-ui': true,
  'enable-jj-vcs-ui': true,
  'markdown-table-v2': true,
  'scheduled-tasks-v2': true,
  'enable-tasks': true,
  'enable-remote-ai': true,
  'enable-auto-permission-preset': true,
  'enable-sidebar-unread-dot': true,
  'enable-sidecar-pill-auto-open': true,
  'enable-terminal-setup-script': true,
  'enable-context-menu-system': true,
  'configure-artifact-width': true
};

export function getAsarPath(): string {
  const localAppData = process.env.LOCALAPPDATA || '';
  return path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar');
}

export function patchAsarPreventOverridePurge(): { success: boolean; replaced: number; error?: string } {
  const asarPath = getAsarPath();
  if (!fs.existsSync(asarPath)) {
    return { success: false, replaced: 0, error: `app.asar not found at ${asarPath}` };
  }

  try {
    const buf = fs.readFileSync(asarPath);
    let str = buf.toString('latin1');
    const target1 = "localStorage.removeItem('jetski.developer.featureEnvironmentOverride');";
    const target2 = "window.localStorage.removeItem('jetski.developer.featureEnvironmentOverride');";

    let replaced = 0;
    while (str.includes(target1)) {
      const repl = '/* keeping dev env override */ void(0);'.padEnd(target1.length, ' ');
      str = str.replace(target1, repl);
      replaced++;
    }
    while (str.includes(target2)) {
      const repl = '/* keeping dev env override */ void(0);'.padEnd(target2.length, ' ');
      str = str.replace(target2, repl);
      replaced++;
    }

    if (replaced > 0) {
      if (!fs.existsSync(asarPath + '.bak')) {
        try {
          fs.copyFileSync(asarPath, asarPath + '.bak');
        } catch (bakErr: any) {
          return { success: false, replaced: 0, error: `Failed to create app.asar backup: ${bakErr.message}` };
        }
      }
      const tmpPath = asarPath + '.tmp';
      try {
        fs.writeFileSync(tmpPath, Buffer.from(str, 'latin1'));
        fs.renameSync(tmpPath, asarPath);
      } catch (writeErr: any) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        if (writeErr.code === 'EBUSY' || writeErr.code === 'EPERM') {
          return { success: false, replaced: 0, error: 'app.asar is currently locked by a running Antigravity process. Close the IDE and retry.' };
        }
        return { success: false, replaced: 0, error: writeErr.message };
      }
    }
    return { success: true, replaced };
  } catch (err: any) {
    return { success: false, replaced: 0, error: err.message };
  }
}
