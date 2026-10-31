const fs = require('fs');

const htmlPath = 'ag-doctor-ui/src/renderer/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

const devPanel = `
        <!-- Developer Features & Cohort Override Panel -->
        <div class="panel" style="margin-top:24px" id="settingsDevFeaturesPanel">
          <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:18px;">🛠️</span>
              <div>
                <h2 style="margin:0;">Developer Features &amp; Cohort Override</h2>
                <div style="font-size:12px; color:var(--text-2); margin-top:2px;">Contrôle du mode interne Google, de la protection permanente et des 45 drapeaux expérimentaux.</div>
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <span class="badge" id="devCohortBadge" style="background:rgba(34, 197, 94, 0.15); color:#22c55e; border:1px solid rgba(34, 197, 94, 0.3); font-weight:600; padding:3px 10px; border-radius:12px; font-size:11px;">🟢 Cohorte : Google</span>
              <span class="badge" id="devImmunityBadge" style="background:rgba(59, 130, 246, 0.15); color:#3b82f6; border:1px solid rgba(59, 130, 246, 0.3); font-weight:600; padding:3px 10px; border-radius:12px; font-size:11px;">🛡️ Auto-reset Neutralisé</span>
            </div>
          </div>
          <div class="panel-body">
            <!-- Action Hero Box -->
            <div style="background:var(--bg-0, #141416); border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
              <div style="max-width:580px;">
                <div style="font-size:14px; font-weight:600; color:var(--text-0); display:flex; align-items:center; gap:6px;">
                  <span>⚡ Developer Boost (Optimal 45 Flags)</span>
                </div>
                <div style="font-size:12px; color:var(--text-2); margin-top:4px; line-height:1.4;">
                  Verrouille le profil interne <strong>Google</strong>, active le <strong>Swarm Monitor</strong> multi-agents, le <strong>Thought Steering</strong> en direct, les <strong>Git Worktrees</strong> dédiés et neutralise définitivement la désactivation automatique dans <code>app.asar</code>.
                </div>
              </div>
              <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn btn-primary" id="btnDevApplyBoost" type="button" style="font-weight:600; display:flex; align-items:center; gap:6px;">
                  <span>✨</span><span>Appliquer le Boost (45 Flags)</span>
                </button>
                <button class="btn btn-ghost btn-sm" id="btnDevCheckStatus" type="button" title="Vérifier l'état actuel" style="border:1px solid var(--border);">
                  <span>🔍 Statut</span>
                </button>
              </div>
            </div>

            <!-- Key Features Visual Chips -->
            <div style="margin-top:12px;">
              <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted, #71717a); margin-bottom:8px;">Fonctionnalités Clés Incluses (45 actifs) :</div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;">
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Swarm Monitor (Multi-Agents)</span>
                </div>
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Thought Steering &amp; Editing</span>
                </div>
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Git Worktree Forking</span>
                </div>
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Jujutsu VCS UI (jj)</span>
                </div>
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Builtin Browser &amp; PDF Viewer</span>
                </div>
                <div style="background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:6px; font-size:12px; display:flex; align-items:center; gap:8px;">
                  <span style="color:#22c55e;">●</span><span>Battle Mode &amp; Custom Agents</span>
                </div>
              </div>
            </div>

            <!-- Expandable 45 flags list -->
            <details style="margin-top:14px; background:var(--bg-0); border:1px solid var(--border); border-radius:6px; padding:10px 14px;">
              <summary style="font-size:12px; font-weight:500; color:var(--text-1); cursor:pointer;">Consulter la liste complète des 45 drapeaux configurés ▾</summary>
              <div id="devFullFlagsList" style="margin-top:10px; font-family:var(--font-mono, monospace); font-size:11px; color:var(--text-2); display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:6px;">
                <div>• enable-developer-mode</div>
                <div>• enable-permissions-selector</div>
                <div>• enable-thought-editing</div>
                <div>• enable-thought-steering-from-selection</div>
                <div>• enable-battle-mode</div>
                <div>• enable-battle-contrib-variants</div>
                <div>• enable-battle-mode-custom-agents</div>
                <div>• jetski-autonomous-mode</div>
                <div>• labs-autonomous-mode</div>
                <div>• enable-agent-team</div>
                <div>• enable-swarm-monitor</div>
                <div>• enable-critique-preview</div>
                <div>• enable-conversation-forking</div>
                <div>• enable-fork-at-historical-step</div>
                <div>• enable-fork-in-new-worktree</div>
                <div>• enable-conversation-navigator</div>
                <div>• enable-conversation-groups</div>
                <div>• enable-conversation-sharing-prototype</div>
                <div>• enable-trajectory-debug-tools</div>
                <div>• enable-hub-builtin-browser</div>
                <div>• enable-pdf-viewer</div>
                <div>• enable-notebook-rendering</div>
                <div>• enable-audio-transcription</div>
                <div>• enable-voice-relay</div>
                <div>• google-workspace-mentions</div>
                <div>• enable-plugins</div>
                <div>• enable-plugin-bundles</div>
                <div>• enable-plugin-context-providers</div>
                <div>• enable-mcp-plugin-auth</div>
                <div>• enable-split-view</div>
                <div>• enable-input-autocomplete</div>
                <div>• enable-file-explorer-tab</div>
                <div>• enable-code-search-palette</div>
                <div>• enable-git-vcs-ui</div>
                <div>• enable-jj-vcs-ui</div>
                <div>• markdown-table-v2</div>
                <div>• scheduled-tasks-v2</div>
                <div>• enable-tasks</div>
                <div>• enable-remote-ai</div>
                <div>• enable-auto-permission-preset</div>
                <div>• enable-sidebar-unread-dot</div>
                <div>• enable-sidecar-pill-auto-open</div>
                <div>• enable-terminal-setup-script</div>
                <div>• enable-context-menu-system</div>
                <div>• configure-artifact-width</div>
              </div>
            </details>
          </div>
        </div>
`;

const target = '<div class="panel" style="margin-top:24px" id="settingsChatEnhancementsPanel">';
if (html.includes(target)) {
  html = html.replace(target, devPanel + target);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('Successfully injected Developer panel into index.html');
} else {
  console.error('Target not found in HTML');
  process.exit(1);
}
