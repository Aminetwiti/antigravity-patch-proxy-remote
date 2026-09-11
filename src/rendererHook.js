// Antigravity 2.0 Remote Agent Runtime Hook
// Injects Remote (VPS) into Antigravity 2.0 UI, handles remote command execution, and provides status UI.
(() => {
  if (window.__ag_remote_hook_installed) {
    if (window.__ag_dom_observer) {
      window.__ag_dom_observer.disconnect();
    }
  }
  window.__ag_remote_hook_installed = true;

  console.log('[Antigravity 2.0] Initializing Remote Environment Hook...');

  const DEFAULT_HOST = 'https://dqlwdgordp4apddvek8gvgn0.ty-dev.site';
  const DEFAULT_TOKEN = 'antigravity-secret-cloud-2026';

  function getRemoteConfig() {
    try {
      const storedToken = localStorage.getItem('ag_remote_token') || DEFAULT_TOKEN;
      return {
        host: localStorage.getItem('ag_remote_host') || DEFAULT_HOST,
        token: storedToken,
        configured: localStorage.getItem('ag_remote_configured') === 'true' || storedToken.length > 0,
      };
    } catch (_) {
      return { host: DEFAULT_HOST, token: DEFAULT_TOKEN, configured: true };
    }
  }

  function syncRemoteStateToProxy(active, host, remoteSessions) {
    if (window.nativeStorage && typeof window.nativeStorage.setRemoteState === 'function') {
      window.nativeStorage.setRemoteState({ active, host, remoteSessions }).catch(() => {});
    }
    try {
      fetch('http://127.0.0.1:51074/api/remote/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, host, remoteSessions }),
      }).catch(() => {});
    } catch (_) {}
  }

  function saveRemoteConfig(host, token) {
    try {
      localStorage.setItem('ag_remote_host', host);
      localStorage.setItem('ag_remote_token', token);
      localStorage.setItem('ag_remote_configured', 'true');
      syncRemoteStateToProxy(true, host, getRemoteSessions());
    } catch (_) {}
  }

  function getRemoteSessions() {
    try {
      return JSON.parse(localStorage.getItem('ag_remote_sessions') || '{}');
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
      localStorage.setItem('ag_remote_sessions', JSON.stringify(map));
      const cfg = getRemoteConfig();
      syncRemoteStateToProxy(isRemote, cfg.host, { [cascadeId]: isRemote });
    } catch (_) {}
  }

  function getActiveSessionId() {
    const path = window.location.pathname || '';
    const parts = path.split('/c/');
    if (parts.length > 1) {
      const id = parts[1].split('/')[0].split('?')[0];
      if (id) return id;
    }
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (promptBox) {
      const key = Object.keys(promptBox).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
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

  function closeEnvironmentPopover() {
    try {
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    } catch (_) {}
  }

  // --- Command Execution on Remote VPS ---
  function executeRemoteCommand(command, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const cfg = getRemoteConfig();
      const token = cfg.token;
      const host = cfg.host;
      if (!host) {
        resolve({ ok: false, error: 'Hôte non configuré' });
        return;
      }
      const wsProto = host.startsWith('https:') ? 'wss:' : 'ws:';
      const cleanHost = host.replace('https://', '').replace('http://', '');
      const wsUrl = `${wsProto}//${cleanHost}/v2/terminal?terminalId=exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}&token=${encodeURIComponent(token)}`;

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
        const wrapped = `${command}\necho "\n${endMarker} $?\n"\n`;
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
              const exitCodeStr = (parts[1] || '').trim().split(' ')[0];
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

  // --- Connection Prober (Bypasses CORS & Mixed Content) ---
  // --- Connection Prober (Fast WebSocket first, then IPC fallback) ---
  async function probeConnection(h, t) {
    // 1. WebSocket probe (instant in Chromium renderer, bypasses CORS & Mixed Content)
    const wsResult = await new Promise((resolve) => {
      let wsProto = 'wss:';
      let cleanHost = h.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?$/i.test(cleanHost) || (cleanHost.includes(':') && !cleanHost.endsWith(':443'))) {
        wsProto = 'ws:';
      }
      if (h.startsWith('http://')) wsProto = 'ws:';
      if (h.startsWith('https://')) wsProto = 'wss:';

      const wsUrl = `${wsProto}//${cleanHost}/ws?token=${encodeURIComponent(t)}`;
      let resolved = false;
      let sock;
      try {
        sock = new WebSocket(wsUrl);
      } catch (err) {
        resolve({ ok: false, error: err.message || 'Échec initialisation WebSocket' });
        return;
      }

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { sock.close(); } catch (_) {}
          resolve({ ok: false, error: "Délai d'attente dépassé (timeout)" });
        }
      }, 2000);

      sock.onopen = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { sock.close(); } catch (_) {}
          resolve({ ok: true, data: { platform: 'daemon', connected: true }, via: 'websocket' });
        }
      };

      sock.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: 'Connexion refusée ou port fermé' });
        }
      };

      sock.onclose = (e) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (e.code === 1008 || e.code === 4401 || (e.reason && e.reason.toLowerCase().includes('unauthor'))) {
            resolve({ ok: false, error: "Jeton d'authentification refusé (401)" });
          } else {
            resolve({ ok: false, error: `Fermé par l'hôte (code ${e.code})` });
          }
        }
      };
    });

    if (wsResult.ok) return wsResult;

    // 2. Try Electron IPC fallback if available
    if (window.nativeStorage && typeof window.nativeStorage.testRemoteHealth === 'function') {
      try {
        const ipcRes = await window.nativeStorage.testRemoteHealth({ host: h, token: t });
        if (ipcRes && ipcRes.ok) {
          return { ok: true, data: ipcRes.data || {}, via: 'ipc' };
        }
      } catch (_) {}
    }

    return wsResult;
  }

  // --- Configuration Modal ---
  function openRemoteConfigModal() {
    let modal = document.getElementById('__ag_remote_config_modal');
    if (modal) modal.remove();

    const cfg = getRemoteConfig();
    modal = document.createElement('div');
    modal.id = '__ag_remote_config_modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';

    modal.innerHTML = `
      <div style="width:480px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.6);padding:22px;color:#e5e5e5;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:18px;">☁️</span>
          <span style="font-size:15px;font-weight:600;color:#fff;">Configuration Runtime Agent Remote (VPS)</span>
        </div>
        <p style="font-size:12px;color:#a3a3a3;margin:0 0 16px 0;">Configurez l'accès au daemon distant <code>ag-agentd</code> ou bridge local.</p>

        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Hôte / URL du Daemon (IP:Port ou Domaine)</label>
          <input id="__ag_cfg_host" type="text" value="${cfg.host}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button type="button" class="__ag_preset_btn" data-host="127.0.0.1:8090" data-token="11" style="background:#262626;border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">⚡ Local (127.0.0.1:8090)</button>
            <button type="button" class="__ag_preset_btn" data-host="https://formula-hosting-substantially-hearing.trycloudflare.com" data-token="11" style="background:#262626;border:1px solid rgba(255,255,255,0.15);color:#a78bfa;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">🌐 Tunnel Cloudflare</button>
            <button type="button" class="__ag_preset_btn" data-host="62.169.27.8:8090" data-token="11" style="background:#262626;border:1px solid rgba(255,255,255,0.15);color:#34d399;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">☁️ VPS (62.169.27.8)</button>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Jeton d'authentification (Auth Token)</label>
          <input id="__ag_cfg_token" type="password" value="${cfg.token}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.07);">
          <button id="__ag_cfg_test" style="background:#333;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:5px;padding:5px 12px;font-size:11px;cursor:pointer;">Tester la connexion</button>
          <span id="__ag_cfg_status" style="font-size:11px;color:#a3a3a3;">Prêt</span>
        </div>

        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
          <button id="__ag_cfg_cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Annuler</button>
          <button id="__ag_cfg_save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Enregistrer & Sélectionner</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const hostInput = modal.querySelector('#__ag_cfg_host');
    const tokenInput = modal.querySelector('#__ag_cfg_token');
    const statusSpan = modal.querySelector('#__ag_cfg_status');

    modal.querySelectorAll('.__ag_preset_btn').forEach((btn) => {
      btn.onclick = () => {
        hostInput.value = btn.getAttribute('data-host') || '';
        tokenInput.value = btn.getAttribute('data-token') || '';
        statusSpan.style.color = '#93c5fd';
        statusSpan.textContent = 'Prêt à tester';
      };
    });

    modal.querySelector('#__ag_cfg_test').onclick = async () => {
      statusSpan.style.color = '#93c5fd';
      statusSpan.textContent = 'Test en cours...';
      try {
        let h = hostInput.value.trim();
        while (h.endsWith('/')) h = h.slice(0, -1);
        const t = tokenInput.value.trim();
        if (!h) {
          statusSpan.style.color = '#f87171';
          statusSpan.textContent = 'Veuillez entrer une URL';
          return;
        }
        const res = await probeConnection(h, t);
        if (res.ok) {
          statusSpan.style.color = '#4ade80';
          const info = res.data || {};
          const label = info.tunnelProvider || info.platform || (res.via === 'websocket' ? 'WebSocket OK' : 'Connecté');
          statusSpan.textContent = `● En ligne (${label}${info.pid ? ' / PID ' + info.pid : ''})`;
        } else {
          statusSpan.style.color = '#f87171';
          statusSpan.textContent = `Échec: ${res.error || 'injoignable'}`;
        }
      } catch (err) {
        statusSpan.style.color = '#f87171';
        statusSpan.textContent = `Échec: ${err.message || 'injoignable'}`;
      }
    };

    modal.querySelector('#__ag_cfg_cancel').onclick = () => modal.remove();

    modal.querySelector('#__ag_cfg_save').onclick = () => {
      let h = hostInput.value.trim();
      while (h.endsWith('/')) h = h.slice(0, -1);
      const t = tokenInput.value.trim();
      saveRemoteConfig(h, t);
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, true);
      else window.__ag_draft_remote = true;
      updateTriggerButton();
      modal.remove();
    };
  }

  window.__ag_open_config = openRemoteConfigModal;

  // --- UI Updates ---
  function updateTriggerButton() {
    const isRemote = isCurrentSessionRemote();
    const trigger = document.querySelector('[aria-label="Select Environment"]') ||
                    document.querySelector('[aria-label^="Environment:"]') ||
                    Array.from(document.querySelectorAll('button')).find((b) => {
                      const txt = (b.innerText || '').trim();
                      return txt === 'Local' || txt === 'Remote (VPS)' || txt === 'New Worktree' || txt === 'New Workspace';
                    });

    if (trigger) {
      const labelSpan = trigger.querySelector('.select-none.truncate') || trigger.querySelector('span');
      const iconContainer = trigger.querySelector('[class*="shrink-0"]') || trigger.querySelector('div, span');
      if (isRemote) {
        trigger.setAttribute('aria-label', 'Environment: Remote (VPS)');
        if (labelSpan && labelSpan.textContent !== 'Remote (VPS)') {
          labelSpan.textContent = 'Remote (VPS)';
        }
        trigger.style.color = '#34d399';
        trigger.style.borderColor = 'rgba(52, 211, 153, 0.4)';
      } else {
        trigger.setAttribute('aria-label', 'Environment: Local');
        if (labelSpan && labelSpan.textContent === 'Remote (VPS)') {
          labelSpan.textContent = 'Local';
        }
        trigger.style.color = '';
        trigger.style.borderColor = '';
      }
    }

    // Remote Status Pill next to prompt input container
    let pill = document.getElementById('__ag_remote_pill');
    const inputContainer = document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                           document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border');

    if (inputContainer) {
      if (isRemote) {
        const cfg = getRemoteConfig();
        const rawH = (cfg.host || '127.0.0.1:8090').trim();
        const cleanH = rawH.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        const proto = rawH.startsWith('https') ? 'https' : 'http';
        const consoleUrl = `${proto}://${cleanH}/web/?token=${encodeURIComponent(cfg.token)}`;
        if (!pill) {
          pill = document.createElement('div');
          pill.id = '__ag_remote_pill';
          pill.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;margin:4px 8px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:9999px;font-size:11px;font-weight:500;color:#34d399;width:fit-content;user-select:none;transition:all 0.2s;';
          pill.innerHTML = `
            <span>☁️ Remote: <b>${cleanH}</b></span>
            <button id="__ag_btn_console" title="Ouvrir la Console Cloud Web" style="background:rgba(255,255,255,0.12);border:none;border-radius:4px;color:#fff;padding:2px 7px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px;">⚡ Console</button>
            <span id="__ag_btn_cfg" style="font-size:11px;cursor:pointer;opacity:0.85;" title="Configurer">⚙️</span>
          `;
          pill.querySelector('#__ag_btn_console').onclick = (e) => {
            e.stopPropagation();
            if (window.electronNative && typeof window.electronNative.openExternal === 'function') {
              window.electronNative.openExternal(consoleUrl);
            } else {
              window.open(consoleUrl, '_blank');
            }
          };
          pill.querySelector('#__ag_btn_cfg').onclick = (e) => {
            e.stopPropagation();
            openRemoteConfigModal();
          };
          pill.onclick = (e) => {
            if (e.target && e.target.id !== '__ag_btn_console' && e.target.id !== '__ag_btn_cfg') {
              openRemoteConfigModal();
            }
          };
          inputContainer.parentElement.insertBefore(pill, inputContainer);
        }
      } else if (pill) {
        pill.remove();
      }
    }

    // Inline Environment Toggle Button next to Model Selector
    const modelTrigger = document.querySelector('[data-testid="model-selector-trigger"]');
    if (modelTrigger) {
      const container = modelTrigger.parentElement ? modelTrigger.parentElement.parentElement : null;
      const row = container ? container.parentElement : null;
      if (row) {
        let inlineBtn = document.getElementById('__ag_inline_remote_btn');
        if (!inlineBtn) {
          inlineBtn = document.createElement('button');
          inlineBtn.id = '__ag_inline_remote_btn';
          inlineBtn.type = 'button';
          inlineBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:2px 8px;margin-left:6px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;transition:all 0.15s;user-select:none;';
          row.insertBefore(inlineBtn, container.nextSibling);
        }

        const desiredMode = isRemote ? 'remote' : 'local';
        if (inlineBtn.dataset.agMode !== desiredMode) {
          inlineBtn.dataset.agMode = desiredMode;
          if (isRemote) {
            inlineBtn.style.background = 'rgba(52,211,153,0.12)';
            inlineBtn.style.border = '1px solid rgba(52,211,153,0.35)';
            inlineBtn.style.color = '#34d399';
            inlineBtn.innerHTML = '<span>☁️ Remote (VPS)</span>';
            inlineBtn.title = 'Session en mode Remote Cloud. Cliquer pour désactiver ou Shift+clic pour configurer.';
          } else {
            inlineBtn.style.background = 'rgba(255,255,255,0.06)';
            inlineBtn.style.border = '1px solid rgba(255,255,255,0.12)';
            inlineBtn.style.color = '#a3a3a3';
            inlineBtn.innerHTML = '<span>⚡ Local</span>';
            inlineBtn.title = 'Session locale Windows. Cliquer pour activer le mode Remote VPS.';
          }
        }

        inlineBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const cid = getActiveSessionId();
          if (!isRemote) {
            const cfg = getRemoteConfig();
            if (e.shiftKey || e.altKey || !cfg.configured) {
              openRemoteConfigModal();
            } else {
              if (cid) setSessionRemote(cid, true);
              else window.__ag_draft_remote = true;
              updateTriggerButton();
            }
          } else {
            if (e.shiftKey || e.altKey) {
              openRemoteConfigModal();
            } else {
              if (cid) setSessionRemote(cid, false);
              else window.__ag_draft_remote = false;
              updateTriggerButton();
            }
          }
        };
      }
    }
  }

  // --- Popover Item Injection ---
  function injectRemoteOption() {
    const all = Array.from(document.querySelectorAll('.main-row-trigger, [class*="popover-item"], button, div[role="menuitem"], div[role="option"], div.cursor-pointer'));
    for (const row of all) {
      const text = (row.innerText || row.textContent || '').trim();
      if ((text.includes('New Worktree') || text.includes('New Workspace')) && !text.includes('Remote')) {
        let container = row;
        if (row.parentElement && row.parentElement.classList.contains('w-full') && row.parentElement.parentElement) {
          container = row.parentElement;
        }
        const parent = container.parentElement;
        if (!parent || parent.querySelector('[data-ag-remote="true"]')) continue;

        const clone = container.cloneNode(true);
        clone.setAttribute('data-ag-remote', 'true');

        // Target Title and Subtitle precisely
        const spans = Array.from(clone.querySelectorAll('span'));
        let foundTitle = false;
        for (const sp of spans) {
          const txt = sp.textContent.trim();
          if (txt === 'New Worktree' || txt === 'New Workspace' || txt.includes('Worktree') || txt.includes('Workspace')) {
            sp.textContent = 'Remote (VPS)';
            foundTitle = true;
          } else if (foundTitle && txt.length > 3 && !txt.includes('Remote')) {
            sp.textContent = '62.169.27.8 — Ubuntu 24.04 (24/7 Autonome)';
          }
        }

        // Target and replace Icon with Cloud icon
        const iconWrap = clone.querySelector('.shrink-0') || clone.querySelector('div');
        if (iconWrap) {
          iconWrap.innerHTML = '<span style="font-size:14px;line-height:1;">☁️</span>';
        }

        const clickable = clone.classList.contains('main-row-trigger') || clone.classList.contains('cursor-pointer')
          ? clone
          : (clone.querySelector('.main-row-trigger') || clone.querySelector('.cursor-pointer') || clone);

        clickable.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          console.log('[Antigravity 2.0 Remote] Clicked Remote (VPS)!');
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

        parent.appendChild(clone);
        console.log('[Antigravity 2.0 Remote] Injected Remote (VPS) row into popover.');
      }
    }
  }

  // --- Global Top Bar Status Button (visible on all screens including Projects & Dashboard) ---
  function injectTopBarButton() {
    if (!document.body) return;
    let topBtn = document.getElementById('__ag_topbar_remote_btn');
    if (!topBtn) {
      topBtn = document.createElement('div');
      topBtn.id = '__ag_topbar_remote_btn';
      topBtn.style.cssText = 'position:fixed;top:8px;right:140px;z-index:9999;display:flex;align-items:center;gap:6px;padding:3px 10px;border-radius:12px;background:rgba(20,20,20,0.85);backdrop-filter:blur(6px);font-size:11px;font-weight:500;cursor:pointer;user-select:none;transition:all 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
      topBtn.onclick = () => openRemoteConfigModal();
      document.body.appendChild(topBtn);
    }
    const isRemote = isCurrentSessionRemote();
    const desiredMode = isRemote ? 'remote' : 'local';
    if (topBtn.dataset.agMode === desiredMode) return;
    topBtn.dataset.agMode = desiredMode;

    if (isRemote) {
      topBtn.style.border = '1px solid rgba(52,211,153,0.4)';
      topBtn.style.color = '#34d399';
      topBtn.innerHTML = '<span>☁️ Remote (VPS)</span>';
      topBtn.title = 'Antigravity 2.0 Mode Remote (VPS) Actif. Cliquer pour configurer.';
    } else {
      topBtn.style.border = '1px solid rgba(255,255,255,0.15)';
      topBtn.style.color = '#a3a3a3';
      topBtn.innerHTML = '<span>⚡ Local (PC)</span>';
      topBtn.title = 'Antigravity 2.0 Mode Local. Cliquer pour configurer ou activer Remote.';
    }
  }

  // --- Observer & Listeners ---
  let isUpdating = false;
  let rafId = null;

  function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (isUpdating) return;
      isUpdating = true;
      try {
        injectRemoteOption();
        injectTopBarButton();
        updateTriggerButton();
      } catch (err) {
        console.warn('[AG Remote Hook] Error in scheduleUpdate:', err);
      } finally {
        setTimeout(() => { isUpdating = false; }, 60);
      }
    });
  }

  function startObserver() {
    if (window.__ag_dom_observer) {
      window.__ag_dom_observer.disconnect();
    }
    const obs = new MutationObserver((mutations) => {
      let onlyOurs = true;
      for (let i = 0; i < mutations.length; i++) {
        const t = mutations[i].target;
        if (!t || !t.closest || !t.closest('#__ag_topbar_remote_btn, #__ag_remote_pill, #__ag_inline_remote_btn, [data-ag-remote]')) {
          onlyOurs = false;
          break;
        }
      }
      if (onlyOurs) return;
      scheduleUpdate();
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.__ag_dom_observer = obs;

    scheduleUpdate();
  }

  document.addEventListener('click', (e) => {
    setTimeout(scheduleUpdate, 25);
    setTimeout(scheduleUpdate, 100);
    setTimeout(scheduleUpdate, 250);

    const target = e.target;
    if (!target) return;
    const item = (target.closest && (target.closest('.main-row-trigger') || target.closest('button') || target.closest('[role="menuitem"]') || target.closest('.cursor-pointer'))) || target;
    const text = item.textContent || '';
    if (text.includes('Local') && !text.includes('Remote')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    } else if (text.includes('New Worktree') || text.includes('New Workspace')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    }
  }, true);

  window.addEventListener('popstate', scheduleUpdate);
  const origPush = history.pushState;
  history.pushState = function() {
    const ret = origPush.apply(this, arguments);
    scheduleUpdate();
    return ret;
  };
  const origReplace = history.replaceState;
  history.replaceState = function() {
    const ret = origReplace.apply(this, arguments);
    scheduleUpdate();
    return ret;
  };

  setInterval(scheduleUpdate, 1500);

  // Prompt submit interceptor: guarantees active session is registered on proxy before LLM dispatch
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isCurrentSessionRemote()) {
        const cid = getActiveSessionId();
        if (cid) setSessionRemote(cid, true);
        const cfg = getRemoteConfig();
        syncRemoteStateToProxy(true, cfg.host, cid ? { [cid]: true } : {});
      }
    }
  }, true);

  document.addEventListener('click', (e) => {
    const sendBtn = e.target && (e.target.closest && (e.target.closest('button[aria-label*="Send"]') || e.target.closest('button[type="submit"]') || e.target.closest('.send-button')));
    if (sendBtn && isCurrentSessionRemote()) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, true);
      const cfg = getRemoteConfig();
      syncRemoteStateToProxy(true, cfg.host, cid ? { [cid]: true } : {});
    }
  }, true);

  // Sync initial state from Proxy / nativeStorage
  try {
    fetch('http://127.0.0.1:51074/api/remote/status')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.remoteSessions) {
          const cur = getRemoteSessions();
          localStorage.setItem('ag_remote_sessions', JSON.stringify({ ...cur, ...data.remoteSessions }));
        }
        if (data && data.host && !localStorage.getItem('ag_remote_host')) {
          localStorage.setItem('ag_remote_host', data.host);
        }
        const cid = getActiveSessionId();
        if (cid && isCurrentSessionRemote()) {
          const cfg = getRemoteConfig();
          syncRemoteStateToProxy(true, cfg.host, { [cid]: true });
        }
        updateTriggerButton();
        injectTopBarButton();
      })
      .catch(() => {});
  } catch (_) {}

  try {
    if (window.nativeStorage && typeof window.nativeStorage.getRemoteState === 'function') {
      window.nativeStorage.getRemoteState().then((res) => {
        if (res && res.ok && res.state) {
          if (res.state.host && !localStorage.getItem('ag_remote_host')) {
            localStorage.setItem('ag_remote_host', res.state.host);
          }
          if (res.state.remoteSessions) {
            const cur = getRemoteSessions();
            localStorage.setItem('ag_remote_sessions', JSON.stringify({ ...cur, ...res.state.remoteSessions }));
          }
          updateTriggerButton();
          injectTopBarButton();
        }
      }).catch(() => {});
    }
  } catch (_) {}

  // --- Active Cloud Session Auto-Discovery & Real-Time Live Handover ---
  function getSessionBindings() {
    try {
      return JSON.parse(localStorage.getItem('ag_session_bindings') || '{}');
    } catch (_) {
      return {};
    }
  }

  function setSessionBinding(conversationId, remoteSessionId, workspaceId) {
    if (!conversationId) return;
    try {
      const bindings = getSessionBindings();
      bindings[conversationId] = {
        remoteSessionId,
        workspaceId,
        updatedAt: Date.now()
      };
      localStorage.setItem('ag_session_bindings', JSON.stringify(bindings));
    } catch (_) {}
  }

  let activeLiveWs = null;
  let attachedSessionId = null;

  async function checkActiveCloudSessions() {
    const cfg = getRemoteConfig();
    if (!cfg.host || !cfg.token) return;

    let apiBase = cfg.host;
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
      apiBase = 'https://' + apiBase;
    }
    apiBase = apiBase.replace(/\/+$/, '');

    const currentConvId = getActiveSessionId();
    const bindings = getSessionBindings();
    const currentBinding = currentConvId ? bindings[currentConvId] : null;

    try {
      const resp = await fetch(`${apiBase}/v2/sessions?token=${encodeURIComponent(cfg.token)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const sessions = data.sessions || [];

      // Ponytail: scoped resolution — verify strong binding first, never guess by workspace alone
      let targetSession = null;
      if (currentBinding && currentBinding.remoteSessionId) {
        targetSession = sessions.find((s) => s.id === currentBinding.remoteSessionId && (s.state === 'running' || s.state === 'waiting_input'));
      } else if (isCurrentSessionRemote()) {
        targetSession = sessions.find((s) => s.state === 'running' || s.state === 'waiting_input');
        if (targetSession && currentConvId) {
          setSessionBinding(currentConvId, targetSession.id, targetSession.workspaceId);
        }
      }

      renderCloudLiveBanner(targetSession);
      updateScopedPromptFreeze(targetSession, currentConvId);
    } catch (_) {}
  }

  function updateScopedPromptFreeze(session, conversationId) {
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (!promptBox) return;

    if (session && (session.state === 'running' || session.state === 'starting')) {
      promptBox.setAttribute('data-ag-frozen-conv', conversationId || '');
      promptBox.setAttribute('disabled', 'true');
      promptBox.style.opacity = '0.65';
      promptBox.style.cursor = 'not-allowed';
      if (!promptBox.getAttribute('data-ag-orig-placeholder')) {
        promptBox.setAttribute('data-ag-orig-placeholder', promptBox.getAttribute('placeholder') || '');
      }
      promptBox.setAttribute('placeholder', '🔒 Session Cloud active pour ce projet — saisie locale temporairement réservée.');
    } else if (promptBox.getAttribute('data-ag-frozen-conv')) {
      promptBox.removeAttribute('disabled');
      promptBox.style.opacity = '1';
      promptBox.style.cursor = 'text';
      const orig = promptBox.getAttribute('data-ag-orig-placeholder');
      if (orig) promptBox.setAttribute('placeholder', orig);
      promptBox.removeAttribute('data-ag-frozen-conv');
    }
  }

  function renderCloudLiveBanner(session) {
    let banner = document.getElementById('__ag_cloud_live_banner');
    if (!session) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__ag_cloud_live_banner';
      banner.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:12px;padding:8px 18px;border-radius:12px;background:rgba(15,23,42,0.94);border:1px solid rgba(52,211,153,0.45);box-shadow:0 8px 30px rgba(0,0,0,0.6);color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;font-size:12px;backdrop-filter:blur(10px);user-select:none;transition:all 0.2s ease-in-out;';
      document.body.appendChild(banner);
    }

    const isAttached = attachedSessionId === session.id;
    const rawTitle = session.title || session.id || 'Session 24/7';
    const cleanTitle = rawTitle.length > 35 ? rawTitle.slice(0, 32) + '...' : rawTitle;
    banner.innerHTML = `
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;flex-shrink:0;"></span>
      <span style="font-weight:500;"><strong>Session Cloud VPS active :</strong> "${cleanTitle}"</span>
      <span style="color:#94a3b8;font-size:11px;background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">Session verrouillée</span>
      <button id="__ag_attach_live_btn" style="background:${isAttached ? 'rgba(52,211,153,0.2)' : '#059669'};color:${isAttached ? '#34d399' : '#ffffff'};border:${isAttached ? '1px solid #34d399' : 'none'};padding:5px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;">
        ${isAttached ? '🟢 En direct' : '⚡ Suivre le direct'}
      </button>
    `;

    const attachBtn = document.getElementById('__ag_attach_live_btn');
    if (attachBtn) {
      attachBtn.onclick = () => {
        if (!isAttached) attachToLiveSession(session.id);
      };
    }
  }

  function attachToLiveSession(sessionId) {
    if (activeLiveWs) {
      try { activeLiveWs.close(); } catch (_) {}
    }
    const cfg = getRemoteConfig();
    let wsBase = cfg.host;
    let wsProto = wsBase.startsWith('https://') ? 'wss:' : 'ws:';
    wsBase = wsBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const wsUrl = `${wsProto}//${wsBase}/v2/ws?token=${encodeURIComponent(cfg.token)}`;

    try {
      activeLiveWs = new WebSocket(wsUrl);
      attachedSessionId = sessionId;

      activeLiveWs.onopen = () => {
        activeLiveWs.send(JSON.stringify({
          version: '2.0',
          type: 'session.attach',
          sessionId: sessionId,
          lastSequence: 0
        }));
        showLiveStreamDrawer(sessionId);
        checkActiveCloudSessions();
      };

      activeLiveWs.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleLiveStreamEvent(msg);
        } catch (_) {}
      };

      activeLiveWs.onclose = () => {
        attachedSessionId = null;
        checkActiveCloudSessions();
      };
    } catch (_) {}
  }

  async function handleSafeSyncClick() {
    const cfg = getRemoteConfig();
    let apiBase = cfg.host;
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
      apiBase = 'https://' + apiBase;
    }
    apiBase = apiBase.replace(/\/+$/, '');

    const btn = document.getElementById('__ag_sync_local_btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Garde-fou preflight...';
    }

    try {
      // 1. Exécuter le preflight de sécurité
      const pfResp = await fetch(`${apiBase}/v2/workspaces/sync?token=${encodeURIComponent(cfg.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preflight' }),
      });
      const pf = await pfResp.json();

      if (!pf.canSync) {
        if (btn) {
          btn.disabled = false;
          btn.style.background = '#dc2626';
          btn.textContent = '❌ Sync bloquée';
        }
        alert(`⚠️ Synchronisation bloquée par sécurité :\n\n${pf.reason}\n\nStratégie : ${pf.strategy}`);
        return;
      }

      // 2. Safe Fast-Forward pull
      if (btn) btn.textContent = '📥 Fast-forward...';
      const syncResp = await fetch(`${apiBase}/v2/workspaces/sync?token=${encodeURIComponent(cfg.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'safe_pull' }),
      });
      const syncRes = await syncResp.json();

      if (syncResp.ok && syncRes.success) {
        if (btn) {
          btn.style.background = '#059669';
          btn.textContent = '✅ Synchronisé !';
        }
      } else {
        if (btn) {
          btn.disabled = false;
          btn.style.background = '#d97706';
          btn.textContent = '⚠️ Erreur sync';
        }
        alert(`Échec : ${syncRes.error || syncRes.message}`);
      }
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '❌ Erreur réseau';
      }
    }
  }

  function showLiveStreamDrawer(sessionId) {
    let drawer = document.getElementById('__ag_live_stream_drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = '__ag_live_stream_drawer';
      drawer.style.cssText = 'position:fixed;bottom:135px;right:24px;width:440px;max-height:360px;z-index:9999;border-radius:12px;background:rgba(15,23,42,0.96);border:1px solid rgba(52,211,153,0.3);box-shadow:0 12px 35px rgba(0,0,0,0.7);backdrop-filter:blur(12px);display:flex;flex-direction:column;overflow:hidden;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;color:#cbd5e1;';
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-weight:600;color:#34d399;">☁️ Live Feed VPS (${sessionId.slice(0, 8)})</span>
          <button id="__ag_close_live_drawer" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;line-height:1;">✕</button>
        </div>
        <div id="__ag_live_log_container" style="flex:1;overflow-y:auto;padding:10px;line-height:1.5;max-height:280px;">
          <div style="color:#64748b;">Connexion établie avec le VPS. Réception du flux live...</div>
        </div>
        <div id="__ag_live_sync_footer" style="display:none;padding:8px 12px;background:rgba(52,211,153,0.1);border-top:1px solid rgba(52,211,153,0.3);text-align:center;">
          <span style="color:#34d399;font-weight:500;">🎉 Tâche terminée sur le VPS !</span>
          <button id="__ag_sync_local_btn" style="margin-left:8px;background:#10b981;color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">📥 Git Pull Sécurisé</button>
        </div>
      `;
      document.body.appendChild(drawer);

      document.getElementById('__ag_sync_local_btn').onclick = handleSafeSyncClick;

      document.getElementById('__ag_close_live_drawer').onclick = () => {
        if (activeLiveWs) {
          try { activeLiveWs.close(); } catch (_) {}
          activeLiveWs = null;
        }
        attachedSessionId = null;
        drawer.remove();
        checkActiveCloudSessions();
      };
    }
  }

  function handleLiveStreamEvent(msg) {
    const logs = document.getElementById('__ag_live_log_container');
    if (!logs) return;

    if (msg.type === 'session.catchup' && Array.isArray(msg.events)) {
      for (const ev of msg.events) {
        appendLiveEventLog(logs, ev);
      }
    } else if (msg.type === 'session.event' && msg.event) {
      appendLiveEventLog(logs, msg.event);
    }
  }

  function appendLiveEventLog(container, ev) {
    const el = document.createElement('div');
    el.style.marginBottom = '4px';

    if (ev.type === 'agent.thought_chunk') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#93c5fd';
        el.textContent = '💭 ' + p.chunk;
      } catch (_) {}
    } else if (ev.type === 'tool.call') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#fbbf24';
        el.textContent = `⚙️ [Outil] ${p.name}`;
      } catch (_) {}
    } else if (ev.type === 'git.auto_checkpoint') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#34d399';
        el.style.fontWeight = 'bold';
        el.textContent = `📌 [Git Auto-Checkpoint] ${p.commitHash?.slice(0, 7) || ''} (${p.branch}) -> ${p.pushed ? 'origin pushed ✅' : 'local'}`;
      } catch (_) {}
    } else if (ev.type === 'agent.completed') {
      el.style.color = '#34d399';
      el.style.fontWeight = 'bold';
      el.textContent = '✅ [Terminé] Tâche terminée avec succès sur le VPS.';
      const footer = document.getElementById('__ag_live_sync_footer');
      if (footer) footer.style.display = 'block';
    } else {
      el.style.color = '#64748b';
      el.textContent = `• ${ev.type}`;
    }

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  setInterval(checkActiveCloudSessions, 4000);
  window.addEventListener('focus', checkActiveCloudSessions);
  checkActiveCloudSessions();

  window.__ag_update_trigger = updateTriggerButton;
  console.log('[Antigravity 2.0 Remote] Hook setup completed successfully.');
})();
