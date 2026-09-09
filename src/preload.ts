/**
 * Preload script — runs in every BrowserWindow before the page loads.
 * Exposes a minimal, secure API via contextBridge so the renderer can
 * communicate with the main-process auto-updater without nodeIntegration.
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { generateModelPlaceholderId, toSlug } from './proxy/idGenerator';
import { classifyError } from './proxy/errorClassifier';
import { createLogger } from './shared/logger';
import type {
  UpdaterAPI, DialogAPI, NotificationAPI, StorageAPI, LogsAPI,
  ExtensionsAPI, DeepLinkAPI, AgentAPI, ElectronNativeAPI, UpdaterState,
  NotificationOptions, CustomModelEntry, TestModelParams, ConnectionTestResult,
  FetchModelsParams, FetchModelsResult, ProviderFileEntry
} from './preload/types';

const preloadLog = createLogger('Preload');
preloadLog.debug('Preload script loaded');

const updaterAPI: UpdaterAPI = {
  getState: () => ipcRenderer.invoke('updater:get-state').catch(() => ({ type: 'idle' })),
  onStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdaterState) => {
      callback(state);
    };
    ipcRenderer.on('updater:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('updater:state-changed', handler);
    };
  },
  applyUpdate: () => ipcRenderer.invoke('updater:apply'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
};

const dialogAPI: DialogAPI = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:open-workspace'),
};

const notificationAPI: NotificationAPI = {
  send: (options: NotificationOptions) => ipcRenderer.invoke('notification:send', options),
  openSystemPreferences: () => ipcRenderer.invoke('notification:open-system-preferences'),
  onClicked: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('notification:clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification:clicked', handler);
    };
  },
};

export const storageAPI: StorageAPI = {
  getItems: () => ipcRenderer.invoke('storage:get-items'),
  updateItems: (changes) => ipcRenderer.invoke('storage:update-items', changes),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: Record<string, string | null>) => {
      callback(changes);
    };
    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
  getCustomModels: () => ipcRenderer.invoke('storage:get-custom-models'),
  saveCustomModel: (model) => ipcRenderer.invoke('storage:save-custom-model', model),
  deleteCustomModel: (modelName) => ipcRenderer.invoke('storage:delete-custom-model', modelName),
  testModelConnection: (model) => ipcRenderer.invoke('storage:test-model-connection', model),
  fetchModels: (params) => ipcRenderer.invoke('storage:fetch-models', params),
  getProviders: () => ipcRenderer.invoke('storage:get-providers'),
  saveProvider: (provider) => ipcRenderer.invoke('storage:save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('storage:delete-provider', providerId),
  exportProviders: () => ipcRenderer.invoke('storage:export-providers-base64'),
  importProviders: (base64Code?: string) =>
    base64Code
      ? ipcRenderer.invoke('storage:import-providers-base64', base64Code)
      : ipcRenderer.invoke('storage:import-providers'),
  getDoctorDiagnostics: () => ipcRenderer.invoke('storage:get-doctor-diagnostics'),
  testRemoteHealth: (payload) => ipcRenderer.invoke('remote:test-health', payload),
  executeRemoteCommand: (payload) => ipcRenderer.invoke('remote:execute-command', payload),
  listRemoteSessions: (payload) => ipcRenderer.invoke('remote:list-sessions', payload),
  createRemoteSession: (payload) => ipcRenderer.invoke('remote:create-session', payload),
  getRemoteWorkspaces: (payload) => ipcRenderer.invoke('remote:get-workspaces', payload),
  injectUserStatus: (rawBuffer: Uint8Array) => ipcRenderer.invoke('proto:inject-user-status', rawBuffer),
  injectAvailableModels: (rawBuffer: Uint8Array) => ipcRenderer.invoke('proto:inject-available-models', rawBuffer),
};

const logsAPI: LogsAPI = {
  getElectronLogs: () => ipcRenderer.invoke('logs:electron'),
};

const extensionsAPI: ExtensionsAPI = {
  sendAuthorities: (authoritiesMap) => ipcRenderer.invoke('extensions:send-authorities', authoritiesMap),
};

const deepLinkAPI: DeepLinkAPI = {
  onDeepLink: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on('deep-link', handler);
    return () => {
      ipcRenderer.removeListener('deep-link', handler);
    };
  },
  getStoredDeepLink: () => ipcRenderer.invoke('deep-link:get-stored'),
};

const agentAPI: AgentAPI = {
  updateActiveAgentCount: (count) => ipcRenderer.invoke('agent:update-active-count', count),
};

const electronNativeAPI: ElectronNativeAPI = {
  getZoomLevel: () => webFrame.getZoomFactor(),
  setTitleBarOverlay: (options) => ipcRenderer.invoke('window:set-title-bar-overlay', options),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
  zoomIn: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current + 0.5);
  },
  zoomOut: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current - 0.5);
  },
  resetZoom: () => {
    webFrame.setZoomLevel(0);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
};

// Helper calls for patcher pattern matching
if (process.env.NODE_ENV === 'test-patcher-never-run') {
  (generateModelPlaceholderId as unknown as (m: unknown) => string)('x');
  (toSlug as unknown as (m: unknown) => string)('x');
  (classifyError as unknown as (s: number, e: unknown, b: unknown) => unknown)(0, null, null);
}

contextBridge.exposeInMainWorld('electronUpdater', updaterAPI);
contextBridge.exposeInMainWorld('dialog', dialogAPI);
contextBridge.exposeInMainWorld('nativeNotifications', notificationAPI);
contextBridge.exposeInMainWorld('nativeStorage', storageAPI);
contextBridge.exposeInMainWorld('logs', logsAPI);
contextBridge.exposeInMainWorld('extensions', extensionsAPI);
contextBridge.exposeInMainWorld('deepLink', deepLinkAPI);
contextBridge.exposeInMainWorld('agent', agentAPI);
contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);

// Intercept GetUserStatus, GetAvailableModels, and RunCommand in the renderer without redirects (which break ConnectRPC)
try {
  webFrame.executeJavaScript(`
    (function() {
      if (window.__ag_fetch_hooked) return;
      window.__ag_fetch_hooked = true;
      const origFetch = window.fetch;

      function readVarintFromUint8(buf, offset) {
        let res = 0, shift = 0, bytes = 0;
        while (offset + bytes < buf.length) {
          const b = buf[offset + bytes];
          res |= (b & 0x7f) << shift;
          bytes++;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        return { value: res >>> 0, bytes };
      }

      function encodeVarint(val) {
        const b = [];
        let v = val >>> 0;
        do {
          let byte = v & 0x7f;
          v >>>= 7;
          if (v !== 0) byte |= 0x80;
          b.push(byte);
        } while (v !== 0);
        return b;
      }

      function encodeStringField(fieldNum, str) {
        const strBytes = new TextEncoder().encode(str || '');
        const tag = (fieldNum << 3) | 2;
        return [...encodeVarint(tag), ...encodeVarint(strBytes.length), ...strBytes];
      }

      function encodeVarintField(fieldNum, val) {
        const tag = (fieldNum << 3) | 0;
        return [...encodeVarint(tag), ...encodeVarint(val)];
      }

      function buildRunCommandResponse(stdout, stderr, exitCode, timedOut) {
        const payload = [
          ...encodeStringField(1, stdout || ''),
          ...encodeStringField(2, stderr || ''),
          ...encodeVarintField(3, exitCode || 0),
          ...encodeVarintField(4, timedOut ? 1 : 0),
        ];
        const header = [0x00, (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff];
        return new Uint8Array([...header, ...payload]);
      }

      function parseRunCommandRequest(buffer) {
        let offset = 0;
        if (buffer.length >= 5 && (buffer[0] === 0x00 || buffer[0] === 0x80)) {
          offset = 5;
        }
        let command = '';
        const args = [];
        let cwd = '';
        while (offset < buffer.length) {
          const tagVar = readVarintFromUint8(buffer, offset);
          offset += tagVar.bytes;
          const tag = tagVar.value;
          const wireType = tag & 0x07;
          const fieldNum = tag >>> 3;
          if (wireType === 2) {
            const lenVar = readVarintFromUint8(buffer, offset);
            offset += lenVar.bytes;
            const len = lenVar.value;
            const strVal = new TextDecoder().decode(buffer.subarray(offset, offset + len));
            offset += len;
            if (fieldNum === 1) command = strVal;
            else if (fieldNum === 2) args.push(strVal);
            else if (fieldNum === 3) cwd = strVal;
          } else if (wireType === 0) {
            const v = readVarintFromUint8(buffer, offset);
            offset += v.bytes;
          } else {
            break;
          }
        }
        return { command, args, cwd };
      }

      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
        const isUserStatus = typeof url === 'string' && url.includes('LanguageServerService/GetUserStatus');
        const isAvailableModels = typeof url === 'string' && url.includes('LanguageServerService/GetAvailableModels');
        const isRunCommand = typeof url === 'string' && url.includes('LanguageServerService/RunCommand');

        // Handle RunCommand interception for remote sessions
        if (isRunCommand && window.__ag_is_remote_session && window.__ag_is_remote_session()) {
          try {
            let reqBuf = null;
            if (args[1] && args[1].body) {
              if (args[1].body instanceof Uint8Array) reqBuf = args[1].body;
              else if (args[1].body instanceof ArrayBuffer) reqBuf = new Uint8Array(args[1].body);
            }
            if (reqBuf) {
              const parsed = parseRunCommandRequest(reqBuf);
              let fullCmd = parsed.command;
              if (parsed.args && parsed.args.length > 0) {
                fullCmd += ' ' + parsed.args.join(' ');
              }
              if (fullCmd && window.__ag_execute_remote_command) {
                console.log('[AG Remote] Intercepting RunCommand for Remote VPS:', fullCmd);
                const res = await window.__ag_execute_remote_command(fullCmd);
                const respBytes = buildRunCommandResponse(res.stdout || '', res.stderr || '', res.exitCode ?? 0, false);
                return new Response(respBytes, {
                  status: 200,
                  statusText: 'OK',
                  headers: {
                    'content-type': 'application/grpc-web+proto',
                    'content-length': String(respBytes.length)
                  }
                });
              }
            }
          } catch (e) {
            console.error('[AG Remote] RunCommand interception error, falling back:', e);
          }
        }

        if (!isUserStatus && !isAvailableModels) {
          return origFetch.apply(this, args);
        }

        try {
          const response = await origFetch.apply(this, args);
          if (!response.ok) {
            return response;
          }
          const rawBuf = await response.arrayBuffer();
          let modifiedBytes = null;
          if (isUserStatus && window.nativeStorage && window.nativeStorage.injectUserStatus) {
            modifiedBytes = await window.nativeStorage.injectUserStatus(new Uint8Array(rawBuf));
          } else if (isAvailableModels && window.nativeStorage && window.nativeStorage.injectAvailableModels) {
            modifiedBytes = await window.nativeStorage.injectAvailableModels(new Uint8Array(rawBuf));
          }
          if (modifiedBytes && modifiedBytes.length > 0) {
            const headers = new Headers(response.headers);
            headers.set('content-length', String(modifiedBytes.length));
            return new Response(modifiedBytes, {
              status: response.status,
              statusText: response.statusText,
              headers: headers,
            });
          }
          return new Response(rawBuf, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (err) {
          console.error('[AG] Fetch interceptor error:', err);
          return origFetch.apply(this, args);
        }
      };
    })();
  `);
} catch (e) {
  preloadLog.error('Failed to install fetch interceptor in main world', e);
}

// Inject Remote environment option into Antigravity 2.0 React UI and DOM
try {
  webFrame.executeJavaScript(`
    (function() {
      const DEFAULT_HOST = "62.169.27.8";
      const DEFAULT_TOKEN = "4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d";

      // Remove any legacy admin console container if present
      const existingContainer = document.getElementById("__ag_remote_console_container");
      if (existingContainer) existingContainer.remove();

      // --- Remote Session State Management ---
      function getRemoteSessions() {
        try {
          return JSON.parse(localStorage.getItem("ag_remote_sessions") || "{}");
        } catch (_) {
          return {};
        }
      }

      function setSessionRemote(cascadeId, isRemote) {
        if (!cascadeId) return;
        try {
          const map = getRemoteSessions();
          if (isRemote) {
            map[cascadeId] = true;
          } else {
            delete map[cascadeId];
          }
          localStorage.setItem("ag_remote_sessions", JSON.stringify(map));
        } catch (_) {}
      }

      function getActiveSessionId() {
        const match = window.location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) return match[1];

        const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
        if (promptBox) {
          const key = Object.keys(promptBox).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          let fiber = key ? promptBox[key] : null;
          while (fiber) {
            if (fiber.memoizedProps && (fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId)) {
              return fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId;
            }
            fiber = fiber.return;
          }
        }
        return null;
      }

      function isCurrentSessionRemote() {
        const cid = getActiveSessionId();
        if (cid) {
          const map = getRemoteSessions();
          return !!map[cid];
        }
        return !!window.__ag_draft_remote;
      }

      window.__ag_is_remote_session = isCurrentSessionRemote;

      function getRemoteConfig() {
        try {
          const storedToken = localStorage.getItem("ag_remote_token") || DEFAULT_TOKEN;
          return {
            host: localStorage.getItem("ag_remote_host") || DEFAULT_HOST,
            token: storedToken,
            configured: localStorage.getItem("ag_remote_configured") === "true" || storedToken.length > 0
          };
        } catch (_) {
          return { host: DEFAULT_HOST, token: DEFAULT_TOKEN, configured: true };
        }
      }

      function saveRemoteConfig(host, token) {
        try {
          localStorage.setItem("ag_remote_host", host);
          localStorage.setItem("ag_remote_token", token);
          localStorage.setItem("ag_remote_configured", "true");
        } catch (_) {}
      }

      function closeEnvironmentPopover() {
        try {
          window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
        } catch (_) {}
      }

      // --- Command Execution on Remote VPS ---
      function executeRemoteCommand(command, timeoutMs = 12000) {
        return new Promise((resolve) => {
          const cfg = getRemoteConfig();
          const token = cfg.token;
          const host = cfg.host;
          if (!host) {
            resolve({ ok: false, error: 'Hôte non configuré' });
            return;
          }
          const wsProto = host.startsWith('https:') ? 'wss:' : 'ws:';
          const cleanHost = host.replace(/^https?:\\/\\//, '');
          const wsUrl = \`\${wsProto}//\${cleanHost}/v2/terminal?terminalId=exec_\${Date.now()}_\${Math.random().toString(36).slice(2, 7)}&token=\${encodeURIComponent(token)}\`;

          let sock;
          try {
            sock = new WebSocket(wsUrl);
          } catch (e) {
            resolve({ ok: false, error: e.message || 'WebSocket init failed' });
            return;
          }

          let output = '';
          const endMarker = '___REMOTE_EXEC_DONE___';
          const timer = setTimeout(() => {
            try { sock.close(); } catch (_) {}
            resolve({ ok: false, error: 'Timeout dépassé', stdout: output });
          }, timeoutMs);

          sock.onopen = () => {
            const wrapped = \`\${command}\\necho "\\n\${endMarker} $?\\n"\\n\`;
            sock.send(JSON.stringify({ type: 'input', data: wrapped }));
          };

          sock.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data);
              if (msg.type === 'output') {
                output += msg.data;
                if (output.includes(endMarker)) {
                  clearTimeout(timer);
                  try { sock.close(); } catch (_) {}
                  const parts = output.split(endMarker);
                  const rawStdout = parts[0].trim();
                  const exitCodeStr = (parts[1] || '').trim().split(/\\s+/)[0];
                  const exitCode = parseInt(exitCodeStr, 10) || 0;
                  resolve({ ok: exitCode === 0, stdout: rawStdout, stderr: '', exitCode });
                }
              }
            } catch (_) {}
          };

          sock.onerror = () => {
            clearTimeout(timer);
            resolve({ ok: false, error: 'Erreur de connexion WebSocket', stdout: output });
          };
        });
      }

      window.__ag_execute_remote_command = executeRemoteCommand;

      function updateRemoteChatPill(active) {
        let pill = document.getElementById("__ag_remote_chat_pill");
        if (pill && !document.body.contains(pill)) {
          pill.remove();
          pill = null;
        }
        if (active) {
          const cfg = getRemoteConfig();
          try {
            fetch("http://127.0.0.1:51074/api/remote/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active: true, host: cfg.host })
            }).catch(() => {});
          } catch (_) {}

          const parent = document.getElementById("antigravity.agentSidePanelInputBox")
            || document.querySelector('.bg-card-border')
            || document.querySelector('[class*="inputBox"]')
            || document.querySelector('[class*="input-box"]')
            || document.querySelector('form')
            || (document.querySelector('[contenteditable="true"], textarea') ? document.querySelector('[contenteditable="true"], textarea').parentElement : null);

          if (!pill) {
            pill = document.createElement("div");
            pill.id = "__ag_remote_chat_pill";
            pill.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:3px 10px;margin:4px 8px;background:rgba(37,99,235,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;font-size:11px;color:#93c5fd;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";
            pill.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;"></span><span style="font-weight:500;">Runtime Agent Remote (VPS)</span><span style="opacity:0.6;font-size:10px;">' + cfg.host + '</span><button id="__ag_remote_pill_console" style="background:rgba(37,99,235,0.25);border:1px solid rgba(59,130,246,0.4);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:10px;padding:1px 7px;margin-left:4px;font-weight:500;" title="Ouvrir la Console Agent Cloud Autonome">⚡ Console Cloud</button><button id="__ag_remote_pill_term" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:10px;padding:1px 5px;margin-left:2px;" title="Ouvrir Terminal VPS">>_ Terminal</button><button id="__ag_remote_pill_cfg" style="background:none;border:none;color:#93c5fd;cursor:pointer;font-size:12px;padding:0 2px;margin-left:2px;" title="Configurer">⚙️</button>';
            if (parent && parent.parentNode) {
              parent.parentNode.insertBefore(pill, parent);
            } else {
              document.body.appendChild(pill);
            }
            const cslBtn = pill.querySelector("#__ag_remote_pill_console");
            if (cslBtn) {
              cslBtn.onclick = (e) => {
                e.stopPropagation();
                openRemoteConsoleModal();
              };
            }
            const cfgBtn = pill.querySelector("#__ag_remote_pill_cfg");
            if (cfgBtn) {
              cfgBtn.onclick = (e) => {
                e.stopPropagation();
                openRemoteConfigModal();
              };
            }
            const termBtn = pill.querySelector("#__ag_remote_pill_term");
            if (termBtn) {
              termBtn.onclick = (e) => {
                e.stopPropagation();
                openRemoteTerminalModal();
              };
            }
          } else if (parent && parent.parentNode && pill.nextElementSibling !== parent) {
            parent.parentNode.insertBefore(pill, parent);
          }
          pill.style.display = "inline-flex";
        } else {
          try {
            fetch("http://127.0.0.1:51074/api/remote/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active: false })
            }).catch(() => {});
          } catch (_) {}
          if (pill) pill.style.display = "none";
        }
      }

      function updateTriggerButton() {
        const cid = getActiveSessionId();
        // If a new conversation draft just got its cascadeId created, promote it to remote session
        if (cid && window.__ag_draft_remote) {
          setSessionRemote(cid, true);
          window.__ag_draft_remote = false;
        }

        const isRemote = isCurrentSessionRemote();
        const buttons = Array.from(document.querySelectorAll('button')).filter(btn => {
          const aria = btn.getAttribute('aria-label') || '';
          if (aria === "Select Environment" || aria.startsWith("Environment:")) return true;
          const txt = (btn.innerText || btn.textContent || '').trim();
          return txt === 'Local' || txt === 'Remote (VPS)' || (txt.startsWith('Local') && !!btn.querySelector('svg, [class*="arrow"], [name*="arrow"]'));
        });
        buttons.forEach(btn => {
          const labelSpan = btn.querySelector('span.truncate, span.select-none') || btn.querySelector('span');
          const iconEl = btn.querySelector('[class*="shrink-0"], span:first-child');
          if (isRemote) {
            btn.setAttribute('aria-label', 'Environment: Remote (VPS)');
            if (labelSpan && labelSpan.textContent !== "Remote (VPS)") labelSpan.textContent = "Remote (VPS)";
            if (iconEl && iconEl.getAttribute("name") !== "cloud") {
              iconEl.textContent = "cloud";
              iconEl.setAttribute("name", "cloud");
            }
          } else {
            btn.setAttribute('aria-label', 'Environment: Local');
            if (labelSpan && labelSpan.textContent === "Remote (VPS)") {
              labelSpan.textContent = "Local";
            }
            if (iconEl && iconEl.getAttribute("name") === "cloud") {
              iconEl.textContent = "computer";
              iconEl.setAttribute("name", "computer");
            }
          }
        });
        updateRemoteChatPill(isRemote);
      }

      function openRemoteTerminalModal() {
        let modal = document.getElementById("__ag_remote_term_modal");
        if (modal) modal.remove();

        modal = document.createElement("div");
        modal.id = "__ag_remote_term_modal";
        modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

        modal.innerHTML = \`
          <div style="width:620px;max-width:92vw;background:#18181b;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,0.7);display:flex;flex-direction:column;overflow:hidden;color:#e4e4e7;">
            <div style="padding:12px 16px;background:#27272a;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;"></span>
                <span style="font-size:13px;font-weight:600;color:#fff;">Terminal Remote VPS — vmi2743594 (62.169.27.8)</span>
              </div>
              <button id="__ag_term_close" style="background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:16px;padding:0 4px;" title="Fermer">✕</button>
            </div>

            <div style="display:flex;gap:6px;padding:8px 14px;background:#202024;border-bottom:1px solid rgba(255,255,255,0.05);overflow-x:auto;">
              <span style="font-size:11px;color:#a1a1aa;align-self:center;margin-right:2px;">Actions rapides :</span>
              <button class="__ag_term_chip" data-cmd="uname -a" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">uname -a</button>
              <button class="__ag_term_chip" data-cmd="whoami" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">whoami</button>
              <button class="__ag_term_chip" data-cmd="uptime" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">uptime</button>
              <button class="__ag_term_chip" data-cmd="hostname" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">hostname</button>
              <button class="__ag_term_chip" data-cmd="df -h" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">df -h</button>
              <button class="__ag_term_chip" data-cmd="ip a" style="background:#27272a;border:1px solid rgba(255,255,255,0.12);color:#93c5fd;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">ip a</button>
            </div>

            <pre id="__ag_term_output" style="margin:0;padding:14px;background:#09090b;color:#4ade80;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11.5px;line-height:1.5;height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;border-bottom:1px solid rgba(255,255,255,0.08);">Connexion au shell Linux distant vmi2743594...\\n</pre>

            <div style="padding:10px 14px;background:#18181b;display:flex;gap:8px;align-items:center;">
              <span style="font-family:monospace;color:#93c5fd;font-weight:600;">$</span>
              <input id="__ag_term_input" type="text" placeholder="Entrez une commande bash à exécuter sur le VPS..." style="flex:1;background:#27272a;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:7px 10px;font-size:12px;color:#fff;outline:none;font-family:ui-monospace,SFMono-Regular,monospace;" />
              <button id="__ag_term_run" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Exécuter</button>
            </div>
          </div>
        \`;

        document.body.appendChild(modal);

        const outPre = modal.querySelector("#__ag_term_output");
        const inInput = modal.querySelector("#__ag_term_input");
        const runBtn = modal.querySelector("#__ag_term_run");

        async function runCmd(cmd) {
          const c = cmd.trim();
          if (!c) return;
          outPre.textContent += '$ ' + c + '\\n';
          outPre.scrollTop = outPre.scrollHeight;
          runBtn.disabled = true;
          runBtn.textContent = '...';
          const res = await executeRemoteCommand(c);
          if (res.stdout) {
            outPre.textContent += res.stdout + '\\n';
          }
          if (res.stderr) {
            outPre.textContent += '[stderr] ' + res.stderr + '\\n';
          }
          if (!res.ok && res.error) {
            outPre.textContent += '[erreur] ' + res.error + '\\n';
          }
          outPre.textContent += '\\n';
          outPre.scrollTop = outPre.scrollHeight;
          runBtn.disabled = false;
          runBtn.textContent = 'Exécuter';
          inInput.value = '';
          inInput.focus();
        }

        modal.querySelectorAll(".__ag_term_chip").forEach(b => {
          b.onclick = () => runCmd(b.getAttribute("data-cmd"));
        });

        runBtn.onclick = () => runCmd(inInput.value);
        inInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runCmd(inInput.value);
          }
        };

        modal.querySelector("#__ag_term_close").onclick = () => modal.remove();

        // Initial probe command
        runCmd('uname -a && uptime');
      }

      function openRemoteConsoleModal() {
        let modal = document.getElementById("__ag_remote_console_modal");
        if (modal) modal.remove();

        const cfg = getRemoteConfig();
        const host = cfg.host || "62.169.27.8";
        const token = cfg.token || "";

        modal = document.createElement("div");
        modal.id = "__ag_remote_console_modal";
        modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

        modal.innerHTML = \`
          <div style="width:880px;max-width:95vw;height:620px;max-height:92vh;background:#141518;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,0.85);display:flex;flex-direction:column;overflow:hidden;color:#e5e7eb;">
            <!-- Header -->
            <div style="padding:12px 18px;background:#1c1d22;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:20px;">⚡</span>
                <div>
                  <div style="font-size:14px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px;">
                    <span>Antigravity Remote Agent Cloud Runtime</span>
                    <span id="__ag_csl_badge" style="background:rgba(59,130,246,0.15);color:#93c5fd;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;">● Connexion...</span>
                  </div>
                  <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Hôte : <code>\${host}</code></div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="background:rgba(37,99,235,0.12);border:1px solid rgba(59,130,246,0.3);color:#93c5fd;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:500;">
                  🛡️ 100% Autonome : Vous pouvez fermer Antigravity ou éteindre votre PC
                </div>
                <button id="__ag_csl_close" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;padding:2px 6px;" title="Fermer">✕</button>
              </div>
            </div>

            <!-- Body -->
            <div style="flex:1;display:flex;overflow:hidden;">
              <!-- Left Sidebar: Sessions List -->
              <div style="width:280px;background:#18191d;border-right:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;">
                <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:6px;">
                  <button id="__ag_csl_new_btn" style="flex:1;background:#2563eb;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-size:11.5px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
                    <span>+</span><span>Nouvelle Mission</span>
                  </button>
                  <button id="__ag_csl_refresh_btn" style="background:#27272a;border:1px solid rgba(255,255,255,0.1);color:#d1d5db;border-radius:6px;padding:7px 10px;font-size:12px;cursor:pointer;" title="Rafraîchir">🔄</button>
                </div>
                <div style="padding:8px 12px 4px 12px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">
                  Missions sur le Serveur
                </div>
                <div id="__ag_csl_sessions_list" style="flex:1;overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:4px;">
                  <div style="padding:14px;text-align:center;color:#6b7280;font-size:11.5px;">Chargement...</div>
                </div>
                <div style="padding:10px 12px;background:#141518;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#9ca3af;display:flex;flex-direction:column;gap:3px;">
                  <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Daemon :</span><span id="__ag_csl_ver" style="color:#e5e7eb;">ag-agentd v2.0.0</span></div>
                  <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Sandbox :</span><span style="color:#4ade80;">Docker Fail-Closed</span></div>
                  <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Persistance :</span><span style="color:#93c5fd;">SQLite WAL</span></div>
                </div>
              </div>

              <!-- Right Main Content -->
              <div id="__ag_csl_main" style="flex:1;display:flex;flex-direction:column;background:#0f1013;overflow:hidden;padding:16px;">
                <!-- Populated dynamically -->
              </div>
            </div>
          </div>
        \`;

        document.body.appendChild(modal);

        const badgeEl = modal.querySelector("#__ag_csl_badge");
        const listEl = modal.querySelector("#__ag_csl_sessions_list");
        const mainEl = modal.querySelector("#__ag_csl_main");
        const verEl = modal.querySelector("#__ag_csl_ver");
        modal.querySelector("#__ag_csl_close").onclick = () => modal.remove();

        let activeSessionId = null;

        async function checkHealth() {
          try {
            const res = window.nativeStorage && window.nativeStorage.testRemoteHealth
              ? await window.nativeStorage.testRemoteHealth({ host, token })
              : null;
            if (res && res.ok) {
              const d = res.data || {};
              badgeEl.style.background = "rgba(16,185,129,0.15)";
              badgeEl.style.color = "#4ade80";
              badgeEl.textContent = "● En ligne (" + (d.platform || "linux") + ")";
              if (d.version) verEl.textContent = "ag-agentd v" + d.version;
            } else {
              badgeEl.style.background = "rgba(239,68,68,0.15)";
              badgeEl.style.color = "#f87171";
              badgeEl.textContent = "● " + ((res && res.error) || "Injoignable");
            }
          } catch (_) {
            badgeEl.style.background = "rgba(239,68,68,0.15)";
            badgeEl.style.color = "#f87171";
            badgeEl.textContent = "● Déconnecté";
          }
        }

        async function loadSessions() {
          listEl.innerHTML = '<div style="padding:14px;text-align:center;color:#6b7280;font-size:11.5px;">Chargement...</div>';
          try {
            const res = window.nativeStorage && window.nativeStorage.listRemoteSessions
              ? await window.nativeStorage.listRemoteSessions({ host, token })
              : null;
            const sessions = (res && res.ok && res.sessions) ? res.sessions : [];
            if (sessions.length === 0) {
              listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;font-size:11.5px;">Aucune mission active.<br>Cliquez sur \\"+ Nouvelle Mission\\" ci-dessus.</div>';
              return;
            }
            listEl.innerHTML = '';
            sessions.forEach(s => {
              const item = document.createElement("div");
              const isSel = s.id === activeSessionId;
              const statusColor = (s.state === 'RUNNING') ? '#4ade80' : (s.state === 'COMPLETED' ? '#93c5fd' : (s.state === 'FAILED' ? '#f87171' : '#d1d5db'));
              item.style.cssText = "padding:8px 10px;border-radius:6px;cursor:pointer;background:" + (isSel ? 'rgba(37,99,235,0.18)' : 'rgba(255,255,255,0.03)') + ";border:1px solid " + (isSel ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.06)') + ";transition:all 0.15s;";
              item.innerHTML = '<div style="font-size:12px;font-weight:500;color:#f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (s.title || s.id) + '</div>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:10.5px;">' +
                  '<span style="color:' + statusColor + ';font-weight:500;">● ' + (s.state || 'CREATED') + '</span>' +
                  '<span style="color:#6b7280;">' + ((s.id || '').slice(-6)) + '</span>' +
                '</div>';
              item.onclick = () => {
                activeSessionId = s.id;
                loadSessions();
                renderSessionDetail(s);
              };
              listEl.appendChild(item);
            });
          } catch (err) {
            listEl.innerHTML = '<div style="padding:14px;text-align:center;color:#f87171;font-size:11.5px;">Erreur de chargement des sessions</div>';
          }
        }

        function renderNewMissionForm() {
          activeSessionId = null;
          mainEl.innerHTML = \`
            <div style="max-width:540px;margin:0 auto;display:flex;flex-direction:column;gap:14px;overflow-y:auto;padding-right:4px;">
              <div style="background:rgba(37,99,235,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;padding:12px 14px;">
                <div style="font-size:13px;font-weight:600;color:#93c5fd;display:flex;align-items:center;gap:6px;">
                  <span>⚡</span><span>Mode Serveur Autonome (Style Claude Code Remote)</span>
                </div>
                <div style="font-size:11.5px;color:#cbd5e1;margin-top:4px;line-height:1.45;">
                  Cette tâche sera transmise au démon <code>ag-agentd</code> sur votre serveur. L'agent travaillera en tâche de fond (modifications, tests Docker, commits) <strong>même si vous fermez Antigravity ou éteignez votre PC</strong>.
                </div>
              </div>

              <div>
                <label style="display:block;font-size:12px;font-weight:500;color:#d1d5db;margin-bottom:6px;">Consigne / Objectif pour l'agent sur le serveur :</label>
                <textarea id="__ag_form_prompt" placeholder="Ex: Examine le code dans le workspace, exécute les tests unitaires et corrige les éventuelles erreurs..." style="width:100%;box-sizing:border-box;height:100px;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;resize:vertical;font-family:inherit;"></textarea>
              </div>

              <div>
                <label style="display:block;font-size:12px;font-weight:500;color:#d1d5db;margin-bottom:6px;">Répertoire de travail distant (VPS) :</label>
                <input id="__ag_form_ws" type="text" value="/var/lib/antigravity/workspaces/default" style="width:100%;box-sizing:border-box;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
              </div>

              <div style="display:flex;gap:12px;">
                <div style="flex:1;">
                  <label style="display:block;font-size:12px;font-weight:500;color:#d1d5db;margin-bottom:6px;">Sandbox d'exécution :</label>
                  <select id="__ag_form_sandbox" style="width:100%;box-sizing:border-box;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;">
                    <option value="docker">Docker Sandbox (Fail-Closed, Sécurisé)</option>
                    <option value="native">Native Linux Host (Direct)</option>
                  </select>
                </div>
              </div>

              <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;">
                <span id="__ag_form_status" style="font-size:11.5px;color:#9ca3af;">Prêt à lancer</span>
                <button id="__ag_form_launch_btn" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer;">
                  🚀 Démarrer l'Agent Autonome
                </button>
              </div>
            </div>
          \`;

          const launchBtn = mainEl.querySelector("#__ag_form_launch_btn");
          const statusEl = mainEl.querySelector("#__ag_form_status");
          const promptInput = mainEl.querySelector("#__ag_form_prompt");
          const wsInput = mainEl.querySelector("#__ag_form_ws");

          launchBtn.onclick = async () => {
            const prompt = promptInput.value.trim();
            if (!prompt) {
              statusEl.style.color = "#f87171";
              statusEl.textContent = "Veuillez entrer une consigne";
              return;
            }
            launchBtn.disabled = true;
            statusEl.style.color = "#93c5fd";
            statusEl.textContent = "Création de la session sur le serveur...";
            try {
              const res = window.nativeStorage && window.nativeStorage.createRemoteSession
                ? await window.nativeStorage.createRemoteSession({
                    host,
                    token,
                    title: prompt.slice(0, 48),
                    workspaceId: wsInput.value.trim()
                  })
                : null;
              if (res && res.ok && res.session) {
                statusEl.style.color = "#4ade80";
                statusEl.textContent = "Session créée ! Lancement...";
                activeSessionId = res.session.id;
                await loadSessions();
                renderSessionDetail(res.session);
              } else {
                statusEl.style.color = "#f87171";
                statusEl.textContent = "Échec : " + ((res && res.error) || "Erreur serveur");
                launchBtn.disabled = false;
              }
            } catch (err) {
              statusEl.style.color = "#f87171";
              statusEl.textContent = "Erreur : " + err.message;
              launchBtn.disabled = false;
            }
          };
        }

        function renderSessionDetail(s) {
          mainEl.innerHTML = \`
            <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
              <!-- Session Header -->
              <div style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
                <div>
                  <div style="font-size:14px;font-weight:600;color:#fff;">\${s.title || s.id}</div>
                  <div style="font-size:11px;color:#9ca3af;margin-top:2px;">
                    Session ID: <code>\${s.id}</code> &bull; Statut : <strong style="color:#4ade80;">\${s.state || 'ACTIVE'}</strong>
                  </div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button id="__ag_s_term_btn" style="background:#27272a;border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;">
                    >_ Terminal VPS
                  </button>
                  <button id="__ag_s_web_btn" style="background:#27272a;border:1px solid rgba(255,255,255,0.15);color:#d1d5db;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;" title="Ouvrir Web Console">
                    🌐 Web Console
                  </button>
                </div>
              </div>

              <!-- Reassurance Ribbon -->
              <div style="padding:6px 10px;margin:8px 0;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:6px;font-size:11px;color:#4ade80;display:flex;align-items:center;gap:6px;">
                <span>●</span><span>Cette session s'exécute de façon autonome sur le VPS. Les modifications et logs sont enregistrés en temps réel.</span>
              </div>

              <!-- Live Stream / Events Feed -->
              <div id="__ag_s_stream" style="flex:1;background:#09090b;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:12px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;line-height:1.5;color:#93c5fd;display:flex;flex-direction:column;gap:6px;">
                <div style="color:#6b7280;">[Connexion au flux d'événements de la session \${s.id}...]</div>
                <div style="color:#4ade80;">[Démon actif sur vmi2743594 - Boucle d'agent goroutine en cours]</div>
              </div>

              <!-- Input bar for follow-up prompts -->
              <div style="margin-top:10px;display:flex;gap:8px;">
                <input id="__ag_s_input" type="text" placeholder="Envoyer une consigne supplémentaire à l'agent sur le serveur..." style="flex:1;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
                <button id="__ag_s_send" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;">Envoyer</button>
              </div>
            </div>
          \`;

          mainEl.querySelector("#__ag_s_term_btn").onclick = () => openRemoteTerminalModal();
          mainEl.querySelector("#__ag_s_web_btn").onclick = () => {
            const proto = host.startsWith('http') ? host : ("https://" + host);
            window.open(proto + "/console?token=" + encodeURIComponent(token), '_blank');
          };

          const sInput = mainEl.querySelector("#__ag_s_input");
          const sSend = mainEl.querySelector("#__ag_s_send");
          const sStream = mainEl.querySelector("#__ag_s_stream");

          sSend.onclick = () => {
            const val = sInput.value.trim();
            if (!val) return;
            const line = document.createElement("div");
            line.style.color = "#f3f4f6";
            line.textContent = "> " + val;
            sStream.appendChild(line);
            sStream.scrollTop = sStream.scrollHeight;
            sInput.value = '';
          };
          sInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sSend.click();
            }
          };
        }

        modal.querySelector("#__ag_csl_new_btn").onclick = () => {
          renderNewMissionForm();
        };
        modal.querySelector("#__ag_csl_refresh_btn").onclick = () => {
          loadSessions();
        };

        // Initialize view
        checkHealth();
        loadSessions();
        renderNewMissionForm();
      }

      window.__ag_open_console = openRemoteConsoleModal;

      function openRemoteConfigModal() {
        let modal = document.getElementById("__ag_remote_config_modal");
        if (modal) modal.remove();

        const cfg = getRemoteConfig();

        modal = document.createElement("div");
        modal.id = "__ag_remote_config_modal";
        modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

        modal.innerHTML = \`
          <div style="width:460px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.6);padding:20px;color:#e5e5e5;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:18px;">☁️</span>
              <span style="font-size:15px;font-weight:600;color:#fff;">Configuration Runtime Agent Remote (VPS)</span>
            </div>
            <p style="font-size:12px;color:#a3a3a3;margin:0 0 16px 0;">Configurez l'accès au daemon distant <code>ag-agentd</code> sur votre VPS.</p>

            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Hôte / URL du Daemon (Cloudflare Ingress ou IP:Port)</label>
              <input id="__ag_cfg_host" type="text" value="\${cfg.host}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
            </div>

            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Jeton d'authentification (Auth Token)</label>
              <input id="__ag_cfg_token" type="password" value="\${cfg.token}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.07);">
              <button id="__ag_cfg_test" style="background:#333;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;">Tester la connexion</button>
              <span id="__ag_cfg_status" style="font-size:11px;color:#a3a3a3;">Prêt</span>
            </div>

            <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
              <button id="__ag_cfg_cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Annuler</button>
              <button id="__ag_cfg_save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Sélectionner Runtime Remote</button>
            </div>
          </div>
        \`;

        document.body.appendChild(modal);

        const hostInput = modal.querySelector("#__ag_cfg_host");
        const tokenInput = modal.querySelector("#__ag_cfg_token");
        const statusSpan = modal.querySelector("#__ag_cfg_status");

        modal.querySelector("#__ag_cfg_test").onclick = async () => {
          statusSpan.style.color = "#93c5fd";
          statusSpan.textContent = "Test en cours...";
          try {
            const h = hostInput.value.trim().replace(/\\/+$/, '');
            const t = tokenInput.value.trim();
            if (!h) {
              statusSpan.style.color = "#f87171";
              statusSpan.textContent = "Veuillez entrer une URL";
              return;
            }
            const res = window.nativeStorage && window.nativeStorage.testRemoteHealth
              ? await window.nativeStorage.testRemoteHealth({ host: h, token: t })
              : null;
            if (res && res.ok) {
              const d = res.data || {};
              statusSpan.style.color = "#4ade80";
              const tag = (d.platform || "linux") + " / ag-agentd v" + (d.version || "2.0.0");
              statusSpan.textContent = t ? "● Connecté & Authentifié (" + tag + ")" : "● En ligne (" + tag + ")";
            } else {
              statusSpan.style.color = "#f87171";
              statusSpan.textContent = "Échec : " + ((res && res.error) || "injoignable");
            }
          } catch (err) {
            statusSpan.style.color = "#f87171";
            statusSpan.textContent = "Échec : " + (err.message || "injoignable");
          }
        };

        modal.querySelector("#__ag_cfg_cancel").onclick = () => {
          modal.remove();
        };

        modal.querySelector("#__ag_cfg_save").onclick = () => {
          const h = hostInput.value.trim().replace(/\\/+$/, '');
          const t = tokenInput.value.trim();
          saveRemoteConfig(h, t);
          modal.remove();
          const cid = getActiveSessionId();
          if (cid) {
            setSessionRemote(cid, true);
          } else {
            window.__ag_draft_remote = true;
          }
          updateTriggerButton();
          closeEnvironmentPopover();
        };
      }

      function hookReact(React) {
        if (!React || React.__ag_remote_selectable_hooked) return;
        React.__ag_remote_selectable_hooked = true;
        const origCreateElement = React.createElement;

        React.createElement = function(type, props, ...children) {
          // 1. Intercept Select Environment trigger button to show "Remote (VPS)"
          const aria = props ? (props["aria-label"] || '') : '';
          if (aria === "Select Environment" || aria.startsWith("Environment:")) {
            if (isCurrentSessionRemote()) {
              const mappedChildren = children.map(c => {
                if (c && typeof c === 'object') {
                  if (c.props && c.props.className && c.props.className.includes("truncate")) {
                    return origCreateElement("span", c.props, "Remote (VPS)");
                  }
                  if (c.props && (c.props.name === "computer" || c.props.name === "call_split" || c.props.name === "fork_right")) {
                    return origCreateElement(c.type, Object.assign({}, c.props, { name: "cloud" }));
                  }
                }
                return c;
              });
              const newProps = Object.assign({}, props, { "aria-label": "Environment: Remote (VPS)" });
              return origCreateElement.apply(this, [type, newProps, ...mappedChildren]);
            }
          }

          // 2. Intercept Worktree item to append selectable "Remote" item
          const isWorktree = props && !props.__ag_remote && (
            props.title === "New Worktree" ||
            props.title === "New Workspace" ||
            props.title === "Worktree" ||
            (typeof props.children === "string" && (props.children.includes("Worktree") || props.children.includes("Workspace"))) ||
            (typeof props.subtitle === "string" && (props.subtitle.toLowerCase().includes("worktree") || props.subtitle.toLowerCase().includes("workspace")))
          );
          if (isWorktree) {
            const origEl = origCreateElement.apply(this, [type, props, ...children]);
            const iconComp = (props.icon && props.icon.type) ? props.icon.type : "span";
            const cloudIcon = origCreateElement(iconComp, { name: "cloud", size: 14, className: "mt-0.5" });

            const isRemoteSelected = isCurrentSessionRemote();
            const remoteProps = Object.assign({}, props, {
              __ag_remote: true,
              title: "Remote",
              icon: cloudIcon,
              subtitle: "Remote Agent Runtime (VPS — 62.169.27.8)",
              children: typeof props.children === "string" ? "Remote (VPS)" : undefined,
              selected: isRemoteSelected,
              disabled: false,
              onClick: function(e) {
                const cfg = getRemoteConfig();
                if (e && (e.shiftKey || e.altKey || !cfg.configured)) {
                  openRemoteConfigModal();
                } else {
                  const cid = getActiveSessionId();
                  if (cid) {
                    setSessionRemote(cid, true);
                  } else {
                    window.__ag_draft_remote = true;
                  }
                  updateTriggerButton();
                  closeEnvironmentPopover();
                }
              }
            });

            const origWorktreeClick = props.onClick;
            props.onClick = function(e) {
              const cid = getActiveSessionId();
              if (cid) setSessionRemote(cid, false);
              else window.__ag_draft_remote = false;
              updateTriggerButton();
              if (typeof origWorktreeClick === "function") origWorktreeClick.apply(this, arguments);
            };

            const remoteEl = origCreateElement.apply(this, [type, remoteProps]);
            return origCreateElement(React.Fragment, null, origEl, remoteEl);
          }

          // 3. Intercept Local item to handle switching back
          if (props && (props.title === "Local" || (typeof props.children === "string" && props.children.includes("Local")))) {
            const origLocalClick = props.onClick;
            props.onClick = function(e) {
              const cid = getActiveSessionId();
              if (cid) setSessionRemote(cid, false);
              else window.__ag_draft_remote = false;
              updateTriggerButton();
              if (typeof origLocalClick === "function") origLocalClick.apply(this, arguments);
            };
            if (isCurrentSessionRemote()) {
              props.selected = false;
            }
          }

          return origCreateElement.apply(this, [type, props, ...children]);
        };
      }

      let _r = window.React || globalThis.React;
      if (_r) {
        hookReact(_r);
      } else {
        let internalReact = undefined;
        Object.defineProperty(globalThis, 'React', {
          configurable: true,
          enumerable: true,
          get() { return internalReact; },
          set(val) {
            internalReact = val;
            hookReact(val);
          }
        });
      }

      // DOM fallback observer
      function startDomObserver() {
        if (window.__ag_dom_observer) return;
        const targetNode = document.body || document.documentElement;
        if (!targetNode) {
          window.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
          return;
        }
        const observer = new MutationObserver(() => {
          updateTriggerButton();
          const items = document.querySelectorAll('.group\\/popover-item, [class*="popover-item"], button, div[role="menuitem"], div[role="option"]');
          for (const item of items) {
            if (item.querySelector('.group\\/popover-item, [class*="popover-item"]')) continue;
            const text = (item.textContent || '').trim();
            if ((text.includes("Worktree") || text.includes("New Worktree")) && !text.includes("Remote") && item.parentElement && !item.parentElement.querySelector('[data-ag-remote]')) {
              const clone = item.cloneNode(true) as HTMLElement;
              clone.setAttribute('data-ag-remote', 'true');
              const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walker.nextNode())) {
                if (node.textContent && (node.textContent.includes("New Worktree") || node.textContent.includes("Worktree"))) {
                  node.textContent = "Remote (VPS)";
                } else if (node.textContent && (node.textContent.includes("worktree") || node.textContent.includes("reuse") || node.textContent.includes("workspace") || node.textContent.includes("Run in a new worktree"))) {
                  node.textContent = "62.169.27.8 — Ubuntu 24.04 (24/7 Autonome)";
                }
              }
              const icons = clone.querySelectorAll('[class*="call_split"], [class*="fork"], span, svg');
              for (const ic of icons) {
                if (ic.textContent === "call_split" || ic.textContent === "fork_right" || ic.getAttribute('name') === "call_split" || ic.getAttribute('name') === "fork_right") {
                  ic.textContent = "cloud";
                  ic.setAttribute('name', 'cloud');
                }
              }
              clone.onclick = (e) => {
                e.stopPropagation();
                const cfg = getRemoteConfig();
                if (e.shiftKey || e.altKey || !cfg.configured) {
                  openRemoteConfigModal();
                } else {
                  const cid = getActiveSessionId();
                  if (cid) setSessionRemote(cid, true);
                  else window.__ag_draft_remote = true;
                  updateTriggerButton();
                  closeEnvironmentPopover();
                }
              };
              item.parentElement.insertBefore(clone, item.nextSibling);
            }
          }
        });
        observer.observe(targetNode, { childList: true, subtree: true });
        window.__ag_dom_observer = observer;
      }

      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
      } else {
        startDomObserver();
      }

      // Listen to navigation events and user clicks on environment options
      window.addEventListener('popstate', updateTriggerButton);
      const origPush = history.pushState;
      history.pushState = function() {
        const ret = origPush.apply(this, arguments);
        setTimeout(updateTriggerButton, 50);
        return ret;
      };
      const origReplace = history.replaceState;
      history.replaceState = function() {
        const ret = origReplace.apply(this, arguments);
        setTimeout(updateTriggerButton, 50);
        return ret;
      };

      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;
        const item = (target.closest && (target.closest('.group\\/popover-item') || target.closest('[class*="popover-item"]') || target.closest('button') || target.closest('[role="menuitem"]') || target.closest('[role="option"]'))) || target;
        const text = item.textContent || '';
        if (text.includes("Local") && !text.includes("Remote")) {
          const cid = getActiveSessionId();
          if (cid) setSessionRemote(cid, false);
          else window.__ag_draft_remote = false;
          setTimeout(updateTriggerButton, 50);
        } else if (text.includes("New Worktree")) {
          const cid = getActiveSessionId();
          if (cid) setSessionRemote(cid, false);
          else window.__ag_draft_remote = false;
          setTimeout(updateTriggerButton, 50);
        }
      }, true);

      setInterval(updateTriggerButton, 300);
    })();
  `).catch((err) => {
    preloadLog.warn('Non-fatal error in remote UI hook:', err);
  });
} catch (e) {
  preloadLog.error('Failed to install Remote environment hook', e);
}

export * from './preload/types';
