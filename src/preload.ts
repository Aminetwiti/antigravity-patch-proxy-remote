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
  exportProviders: () => ipcRenderer.invoke('storage:export-providers'),
  importProviders: () => ipcRenderer.invoke('storage:import-providers'),
  getDoctorDiagnostics: () => ipcRenderer.invoke('storage:get-doctor-diagnostics'),
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

// Intercept GetUserStatus and GetAvailableModels in the renderer without redirects (which break ConnectRPC)
try {
  webFrame.executeJavaScript(`
    (function() {
      if (window.__ag_fetch_hooked) return;
      window.__ag_fetch_hooked = true;
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
        const isUserStatus = typeof url === 'string' && url.includes('LanguageServerService/GetUserStatus');
        const isAvailableModels = typeof url === 'string' && url.includes('LanguageServerService/GetAvailableModels');

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
      const CONSOLE_URL = "https://pharmaceuticals-willing-warrant-pound.trycloudflare.com/console?token=4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d";
      window.__ag_selected_env = window.__ag_selected_env || "local";

      function getRemoteUrl() {
        try {
          return localStorage.getItem("ag_remote_url") || CONSOLE_URL;
        } catch (_) {
          return CONSOLE_URL;
        }
      }

      function setRemoteConsoleVisible(visible) {
        let container = document.getElementById("__ag_remote_console_container");
        if (visible) {
          if (!container) {
            container = document.createElement("div");
            container.id = "__ag_remote_console_container";
            container.style.cssText = "position:absolute;top:36px;left:0;right:0;bottom:0;z-index:50;background:#181818;display:flex;flex-direction:column;border-top:1px solid rgba(255,255,255,0.1);";

            const header = document.createElement("div");
            header.style.cssText = "height:34px;min-height:34px;background:#1e1e1e;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;padding:0 12px;font-size:12px;color:#cccccc;user-select:none;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";
            header.innerHTML = '<span style="display:flex;align-items:center;gap:6px;font-weight:500;"><span style="color:#60a5fa;">☁️</span> Antigravity Remote Agent Cloud Console <span style="opacity:0.6;font-size:11px;">(62.169.27.8:4155)</span></span><div style="margin-left:auto;display:flex;align-items:center;gap:8px;"><button id="__ag_remote_reload" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;" title="Reload Console">↻</button><button id="__ag_remote_open_ext" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;" title="Open in Browser">↗</button><button id="__ag_remote_close" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:15px;padding:0 5px;border-radius:4px;" title="Close Panel">✕</button></div>';
            container.appendChild(header);

            const iframe = document.createElement("iframe");
            iframe.id = "__ag_remote_iframe";
            iframe.src = getRemoteUrl();
            iframe.style.cssText = "flex:1;width:100%;height:100%;border:none;background:#121212;";
            container.appendChild(iframe);

            document.body.appendChild(container);

            header.querySelector("#__ag_remote_reload").onclick = () => {
              iframe.src = getRemoteUrl();
            };
            header.querySelector("#__ag_remote_open_ext").onclick = () => {
              window.open(getRemoteUrl(), "_blank");
            };
            header.querySelector("#__ag_remote_close").onclick = () => {
              setRemoteConsoleVisible(false);
              window.__ag_selected_env = "local";
              updateTriggerButton();
            };
          }
          container.style.display = "flex";
        } else {
          if (container) {
            container.style.display = "none";
          }
        }
      }

      function closeEnvironmentPopover() {
        try {
          window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
        } catch (_) {}
      }

      function updateTriggerButton() {
        const isRemote = (window.__ag_selected_env === "remote");
        const buttons = document.querySelectorAll('button[aria-label="Select Environment"]');
        buttons.forEach(btn => {
          const labelSpan = btn.querySelector('span.truncate, span.select-none');
          const iconEl = btn.querySelector('[class*="shrink-0"], span:first-child');
          if (isRemote) {
            if (labelSpan && labelSpan.textContent !== "Remote") labelSpan.textContent = "Remote";
            if (iconEl && iconEl.getAttribute("name") !== "cloud") {
              iconEl.textContent = "cloud";
              iconEl.setAttribute("name", "cloud");
            }
          } else if (window.__ag_selected_env === "local") {
            if (labelSpan && labelSpan.textContent === "Remote") labelSpan.textContent = "Local";
            if (iconEl && iconEl.getAttribute("name") === "cloud") {
              iconEl.textContent = "computer";
              iconEl.setAttribute("name", "computer");
            }
          }
        });
      }

      function hookReact(React) {
        if (!React || React.__ag_remote_selectable_hooked) return;
        React.__ag_remote_selectable_hooked = true;
        const origCreateElement = React.createElement;

        React.createElement = function(type, props, ...children) {
          // 1. Intercept Select Environment trigger button to show "Remote" when active
          if (props && props["aria-label"] === "Select Environment") {
            if (window.__ag_selected_env === "remote") {
              const mappedChildren = children.map(c => {
                if (c && typeof c === 'object') {
                  if (c.props && c.props.className && c.props.className.includes("truncate")) {
                    return origCreateElement("span", c.props, "Remote");
                  }
                  if (c.props && (c.props.name === "computer" || c.props.name === "call_split")) {
                    return origCreateElement(c.type, Object.assign({}, c.props, { name: "cloud" }));
                  }
                }
                return c;
              });
              return origCreateElement.apply(this, [type, props, ...mappedChildren]);
            }
          }

          // 2. Intercept New Worktree to append selectable "Remote" item
          if (props && (props.title === "New Worktree" || props.title === "New Workspace")) {
            const origEl = origCreateElement.apply(this, [type, props, ...children]);
            const iconComp = (props.icon && props.icon.type) ? props.icon.type : "span";
            const cloudIcon = origCreateElement(iconComp, { name: "cloud", size: 14, className: "mt-0.5" });

            const isRemoteSelected = (window.__ag_selected_env === "remote");
            const remoteProps = Object.assign({}, props, {
              title: "Remote",
              icon: cloudIcon,
              subtitle: "Remote Agent Cloud Console (62.169.27.8)",
              selected: isRemoteSelected,
              disabled: false,
              onClick: function(e) {
                window.__ag_selected_env = "remote";
                setRemoteConsoleVisible(true);
                updateTriggerButton();
                closeEnvironmentPopover();
              }
            });

            const origWorktreeClick = props.onClick;
            props.onClick = function(e) {
              window.__ag_selected_env = "worktree";
              setRemoteConsoleVisible(false);
              updateTriggerButton();
              if (typeof origWorktreeClick === "function") origWorktreeClick.apply(this, arguments);
            };

            const remoteEl = origCreateElement.apply(this, [type, remoteProps]);
            return origCreateElement(React.Fragment, null, origEl, remoteEl);
          }

          // 3. Intercept Local item to handle switching back
          if (props && props.title === "Local") {
            const origLocalClick = props.onClick;
            props.onClick = function(e) {
              window.__ag_selected_env = "local";
              setRemoteConsoleVisible(false);
              updateTriggerButton();
              if (typeof origLocalClick === "function") origLocalClick.apply(this, arguments);
            };
            if (window.__ag_selected_env === "remote") {
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
      if (!window.__ag_dom_observer) {
        const observer = new MutationObserver(() => {
          updateTriggerButton();
          const items = document.querySelectorAll('button, div[role="menuitem"], div[role="option"]');
          for (const item of items) {
            if (item.textContent.includes("New Worktree") && !item.parentElement.querySelector('[data-ag-remote]')) {
              const clone = item.cloneNode(true);
              clone.setAttribute('data-ag-remote', 'true');
              const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
              let node;
              while (node = walker.nextNode()) {
                if (node.textContent.includes("New Worktree")) {
                  node.textContent = "Remote";
                } else if (node.textContent.includes("Worktree from") || node.textContent.includes("reuse")) {
                  node.textContent = "Remote Agent Cloud Console (62.169.27.8)";
                }
              }
              const icons = clone.querySelectorAll('[class*="call_split"], span');
              for (const ic of icons) {
                if (ic.textContent === "call_split" || ic.getAttribute('name') === "call_split") {
                  ic.textContent = "cloud";
                  ic.setAttribute('name', 'cloud');
                }
              }
              clone.onclick = (e) => {
                e.stopPropagation();
                window.__ag_selected_env = "remote";
                setRemoteConsoleVisible(true);
                updateTriggerButton();
                closeEnvironmentPopover();
              };
              item.parentElement.insertBefore(clone, item.nextSibling);
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.__ag_dom_observer = observer;
      }

      setInterval(updateTriggerButton, 300);
    })();
  `);
} catch (e) {
  preloadLog.error('Failed to install Remote environment hook', e);
}

export * from './preload/types';
