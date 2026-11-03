

﻿// Remote Server (QR Code)
// ─────────────────────────────────────────────────────────────────────────────

const startRemoteBtn = $('#startRemoteBtn');
const remoteQrContainer = $('#remoteQrContainer');
const remoteQrImage = $('#remoteQrImage') as HTMLImageElement;
const remoteQrPlaceholder = $('#remoteQrPlaceholder');
const remoteStatusText = $('#remoteStatusText');
const remotePort = $('#remotePort') as HTMLInputElement;
const remoteTunnel = $('#remoteTunnel') as HTMLSelectElement;
const remoteAuthToken = $('#remoteAuthToken') as HTMLInputElement;
const remoteConsole = $('#remoteConsole') as HTMLTextAreaElement;
const regenerateTokenBtn = $('#regenerateTokenBtn');
const tokenSavedBadge = $('#tokenSavedBadge');
const remoteAllowFirstAdmin = $('#remoteAllowFirstAdmin') as HTMLInputElement;
const remotePinDisplay = $('#remotePinDisplay');
const remoteTelemetryBadge = $('#remoteTelemetryBadge');
const remoteClientsCount = $('#remoteClientsCount');
const remoteSessionsCount = $('#remoteSessionsCount');
const remoteUptimeDisplay = $('#remoteUptimeDisplay');
const remoteCheckHealthBtn = $('#remoteCheckHealthBtn');
const remoteCopyWsUrlBtn = $('#remoteCopyWsUrlBtn');
const remoteIdeStatusBanner = $('#remoteIdeStatusBanner');
const remoteIdeDot = $('#remoteIdeDot');
const remoteIdeText = $('#remoteIdeText');
const remoteLaunchIdeBtn = $('#remoteLaunchIdeBtn');
const remoteClearConsoleBtn = $('#remoteClearConsoleBtn');
const remoteCopyLogsBtn = $('#remoteCopyLogsBtn');
const remoteContextualStartBtn = $('#remoteContextualStartBtn');
const remoteCopyPinBtn = $('#remoteCopyPinBtn');
const remoteSyncedAccountsCount = $('#remoteSyncedAccountsCount');

function updateRemoteSyncedAccountsBadge() {
  if (!remoteSyncedAccountsCount) return;
  const readyCount = Array.isArray(googleAccountsCache)
    ? googleAccountsCache.filter((a) => a.enabled !== false).length
    : 0;
  remoteSyncedAccountsCount.textContent = `${readyCount} prêt${readyCount > 1 ? 's' : ''}`;
  remoteSyncedAccountsCount.style.color = readyCount > 0 ? '#10b981' : 'var(--text-2)';
}

let isDaemonRunning = false;
let tokenBadgeTimeout: any = null;
let currentActiveWsUrl = '';

function generateSecureToken(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

function getOrGenerateAuthToken(): string {
  let token = remoteAuthToken?.value?.trim() || localStorage.getItem('ag_remote_auth_token') || '';
  if (!token || token === '11') {
    token = generateSecureToken(16);
    try {
      localStorage.setItem('ag_remote_auth_token', token);
    } catch { /* ignore */ }
    if (remoteAuthToken) {
      remoteAuthToken.value = token;
    }
  }
  return token;
}

function attachCopyButton(wsUrl: string) {
  currentActiveWsUrl = wsUrl;
  const btn = $('#copyRemoteWsBtn');
  if (btn) {
    btn.onclick = () => {
      navigator.clipboard.writeText(wsUrl).then(() => {
        toast('URL WebSocket copiée dans le presse-papier !', 'ok');
      }).catch(() => {
        toast('Impossible de copier l\'URL', 'warn');
      });
    };
  }
}

function renderRemoteStatusText(label: string, url: string, suffix = ''): void {
  if (!remoteStatusText) return;
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  remoteStatusText.innerHTML = `${safeLabel} : <b style="word-break: break-all;">${safeUrl}</b>${suffix}<br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
  attachCopyButton(url);
}

async function syncIdeStatus() {
  try {
    const status = await window.ag?.antigravityStatus?.();
    if (status && status.ok) {
      if (remoteIdeDot) {
        remoteIdeDot.style.background = 'var(--accent-green, #22c55e)';
        remoteIdeDot.style.boxShadow = '0 0 6px rgba(34, 197, 94, 0.6)';
      }
      if (remoteIdeText) remoteIdeText.textContent = 'IDE Antigravity Détecté';
      if (remoteLaunchIdeBtn) remoteLaunchIdeBtn.style.display = 'none';
    } else {
      if (remoteIdeDot) {
        remoteIdeDot.style.background = 'var(--accent-amber, #f59e0b)';
        remoteIdeDot.style.boxShadow = 'none';
      }
      if (remoteIdeText) remoteIdeText.textContent = 'IDE Non Détecté';
      if (remoteLaunchIdeBtn) remoteLaunchIdeBtn.style.display = 'inline-block';
    }
  } catch {
    if (remoteIdeDot) remoteIdeDot.style.background = 'var(--text-2)';
    if (remoteIdeText) remoteIdeText.textContent = 'Statut IDE Inconnu';
  }
}

function flashTokenSavedBadge() {
  if (tokenSavedBadge) {
    tokenSavedBadge.style.display = 'inline';
    if (tokenBadgeTimeout) clearTimeout(tokenBadgeTimeout);
    tokenBadgeTimeout = setTimeout(() => {
      tokenSavedBadge.style.display = 'none';
    }, 2000);
  }
}

// ── Restauration initiale depuis localStorage ───────────────────────────────
try {
  let savedToken = localStorage.getItem('ag_remote_auth_token');
  if (savedToken === '11' || !savedToken) {
    savedToken = generateSecureToken(16);
    localStorage.setItem('ag_remote_auth_token', savedToken);
  }
  if (remoteAuthToken) {
    remoteAuthToken.value = savedToken;
  }
  const savedPort = localStorage.getItem('ag_remote_port');
  if (savedPort !== null && remotePort) {
    remotePort.value = savedPort;
  }
  const savedTunnel = localStorage.getItem('ag_remote_tunnel');
  if (savedTunnel !== null && remoteTunnel) {
    remoteTunnel.value = savedTunnel;
  }
  const savedAllowAdmin = localStorage.getItem('ag_remote_allow_first_admin');
  if (savedAllowAdmin !== null && remoteAllowFirstAdmin) {
    remoteAllowFirstAdmin.checked = savedAllowAdmin === 'true';
  }
} catch { /* ignore */ }

// ── Sauvegarde automatique temps-réel ───────────────────────────────────────
remoteAuthToken?.addEventListener('input', () => {
  try {
    const val = remoteAuthToken.value.trim();
    localStorage.setItem('ag_remote_auth_token', val);
    flashTokenSavedBadge();
    if (isDaemonRunning) {
      void syncDaemonUiStatus();
    }
  } catch { /* ignore */ }
});

remotePort?.addEventListener('input', () => {
  try {
    localStorage.setItem('ag_remote_port', remotePort.value.trim());
  } catch { /* ignore */ }
});

remoteTunnel?.addEventListener('change', () => {
  try {
    localStorage.setItem('ag_remote_tunnel', remoteTunnel.value);
  } catch { /* ignore */ }
});

remoteAllowFirstAdmin?.addEventListener('change', () => {
  try {
    localStorage.setItem('ag_remote_allow_first_admin', remoteAllowFirstAdmin.checked ? 'true' : 'false');
  } catch { /* ignore */ }
});

regenerateTokenBtn?.addEventListener('click', () => {
  const currentToken = remoteAuthToken?.value?.trim();
  if (currentToken && isDaemonRunning) {
    const ok = window.confirm('Remplacer le jeton actuel alors que le serveur tourne déconnectera les compagnons mobiles appairés. Continuer ?');
    if (!ok) return;
  }
  const rand = generateSecureToken(16);
  if (remoteAuthToken) {
    remoteAuthToken.value = rand;
    try {
      localStorage.setItem('ag_remote_auth_token', rand);
      flashTokenSavedBadge();
    } catch { /* ignore */ }
    if (isDaemonRunning) {
      void syncDaemonUiStatus();
    }
    toast(`Nouveau token cryptographique généré et sauvegardé : ${rand}`, 'ok');
  }
});

remoteContextualStartBtn?.addEventListener('click', () => {
  startRemoteBtn?.click();
});

remoteCopyPinBtn?.addEventListener('click', () => {
  const pin = remotePinDisplay?.textContent?.trim() || '';
  if (pin && pin !== '------') {
    navigator.clipboard.writeText(pin).then(() => {
      toast(`Code PIN ${pin} copié dans le presse-papier !`, 'ok');
    }).catch(() => {
      toast('Impossible de copier le code PIN', 'warn');
    });
  } else {
    toast('Aucun code PIN actif à copier (démarrez le serveur distant)', 'warn');
  }
});

remoteCopyWsUrlBtn?.addEventListener('click', () => {
  if (currentActiveWsUrl) {
    navigator.clipboard.writeText(currentActiveWsUrl).then(() => {
      toast('URL WebSocket copiée !', 'ok');
    }).catch(() => {
      toast('Impossible de copier', 'warn');
    });
  } else {
    const port = parseInt(remotePort?.value || '8090');
    const token = getOrGenerateAuthToken();
    window.ag?.getLocalIp?.().then((ip: string) => {
      const url = `ws://${ip}:${port}/ws?token=${encodeURIComponent(token)}`;
      navigator.clipboard.writeText(url).then(() => {
        toast(`URL locale copiée : ${url}`, 'ok');
      });
    });
  }
});

remoteCheckHealthBtn?.addEventListener('click', async () => {
  const port = parseInt(remotePort?.value || '8090');
  const token = getOrGenerateAuthToken();
  try {
    const status = await window.ag?.getDaemonStatus?.(port, token);
    if (status && status.running) {
      const sessions = status.telemetry?.sessions ?? 0;
      const clients = status.telemetry?.clients ?? 0;
      const uptime = status.telemetry?.uptime ?? 'récent';
      toast(`✅ Démon sain sur :${port} — ${clients} client(s), ${sessions} session(s), Uptime: ${uptime}`, 'ok');
    } else {
      toast(`⚠️ Démon non joignable sur le port ${port}`, 'warn');
    }
  } catch (err: any) {
    toast(`❌ Erreur santé: ${err.message}`, 'err');
  }
});

async function syncDaemonUiStatus(port?: number) {
  try {
    const currentPort = port || parseInt(remotePort?.value || localStorage.getItem('ag_remote_port') || '8090');
    const token = getOrGenerateAuthToken();
    const status = await window.ag?.getDaemonStatus?.(currentPort, token);
    if (status && status.running) {
      isDaemonRunning = true;
      if (startRemoteBtn) {
        startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Stop Remote Server';
        startRemoteBtn.classList.add('btn-danger');
        startRemoteBtn.removeAttribute('disabled');
      }

      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'En ligne';
        remoteTelemetryBadge.style.background = 'rgba(34, 197, 94, 0.2)';
        remoteTelemetryBadge.style.color = '#22c55e';
      }
      if (status.telemetry) {
        if (remoteClientsCount && typeof status.telemetry.clients !== 'undefined') {
          remoteClientsCount.textContent = status.telemetry.clients.toString();
        }
        if (remoteSessionsCount && typeof status.telemetry.sessions !== 'undefined') {
          remoteSessionsCount.textContent = status.telemetry.sessions.toString();
        }
        if (remoteUptimeDisplay && status.telemetry.uptime) {
          remoteUptimeDisplay.textContent = status.telemetry.uptime;
        }
      }

      if (status.publicUrl && status.publicUrl.length > 0) {
        const cleanHost = status.publicUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const wsUrl = `wss://${cleanHost}/ws?token=${encodeURIComponent(token)}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        renderRemoteStatusText('Tunnel prêt', wsUrl);
      } else {
        const ip = await window.ag.getLocalIp();
        const wsUrl = `ws://${ip}:${status.port || currentPort}/ws?token=${encodeURIComponent(token)}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        renderRemoteStatusText('Serveur à l\'écoute (Réseau local)', wsUrl);
      }
      updateRemoteSyncedAccountsBadge();
    } else {
      isDaemonRunning = false;
      if (startRemoteBtn) {
        startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Remote Server';
        startRemoteBtn.classList.remove('btn-danger');
        startRemoteBtn.removeAttribute('disabled');
      }
      if (remoteQrContainer) remoteQrContainer.style.display = 'none';
      if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'flex';
      if (remoteStatusText) {
        remoteStatusText.textContent = 'Cliquez sur \'Démarrer le Serveur Distant\' pour héberger le serveur distant';
      }
      if (remotePinDisplay) {
        remotePinDisplay.textContent = '------';
      }
      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'Hors ligne';
        remoteTelemetryBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        remoteTelemetryBadge.style.color = 'var(--text-2)';
      }
      if (remoteClientsCount) remoteClientsCount.textContent = '0';
      if (remoteSessionsCount) remoteSessionsCount.textContent = '0';
      if (remoteUptimeDisplay) remoteUptimeDisplay.textContent = '-';
      updateRemoteSyncedAccountsBadge();
    }
  } catch { /* ignore */ }
}

remoteLaunchIdeBtn?.addEventListener('click', async () => {
  try {
    toast('Lancement d\'Antigravity...', 'ok');
    await window.ag?.antigravityLaunch?.();
    setTimeout(() => {
      void syncIdeStatus();
    }, 2500);
  } catch (err: any) {
    toast(`Erreur lancement IDE: ${err.message}`, 'err');
  }
});

remoteClearConsoleBtn?.addEventListener('click', () => {
  if (remoteConsole) {
    remoteConsole.value = '';
    toast('Console effacée', 'ok');
  }
});

remoteCopyLogsBtn?.addEventListener('click', () => {
  if (remoteConsole && remoteConsole.value) {
    navigator.clipboard.writeText(remoteConsole.value).then(() => {
      toast('Logs de la console copiés !', 'ok');
    }).catch(() => {
      toast('Impossible de copier les logs', 'warn');
    });
  } else {
    toast('Console vide', 'warn');
  }
});

if (window.ag && window.ag.onDaemonLog) {
  window.ag.onDaemonLog((data: string) => {
    if (remoteConsole) {
      remoteConsole.value += data;
      remoteConsole.scrollTop = remoteConsole.scrollHeight;

      // Extract PIN code if present in daemon logs
      const pinMatch = data.match(/Code PIN d'appairage mobile\s*:\s*([0-9]{6})/);
      if (pinMatch && remotePinDisplay) {
        remotePinDisplay.textContent = pinMatch[1];
      }

      const cleanData = data
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

      // Détection de l'arrêt inopiné du daemon
      if (cleanData.includes('[Daemon terminé') || cleanData.includes('Daemon arrêté')) {
        isDaemonRunning = false;
        if (startRemoteBtn) {
          startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Remote Server';
          startRemoteBtn.classList.remove('btn-danger');
          startRemoteBtn.removeAttribute('disabled');
        }
        if (remoteQrContainer) remoteQrContainer.style.display = 'none';
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'flex';
        if (remotePinDisplay) remotePinDisplay.textContent = '------';
        if (remoteTelemetryBadge) {
          remoteTelemetryBadge.textContent = 'Arrêté';
          remoteTelemetryBadge.style.background = 'rgba(239, 68, 68, 0.2)';
          remoteTelemetryBadge.style.color = '#ef4444';
        }
        if (remoteStatusText) {
          remoteStatusText.innerHTML = '<span style="color: var(--accent-amber, #f59e0b);">Le serveur distant est arrêté. Cliquez sur "Start Remote Server" pour relancer.</span>';
        }
        void syncIdeStatus();
      }

      // Extract tunnel URL (Pinggy or Cloudflare or wss://) from logs to generate QR Code dynamically!
      let wsUrl = '';
      const token = getOrGenerateAuthToken();

      const wssMatch = cleanData.match(/wss:\/\/[^\s"'<>|┌┐└┘│+]+/);
      if (wssMatch) {
        wsUrl = wssMatch[0].trim().replace(/[\]\)\>\}\│\|\s]+$/, '');
        if (!wsUrl.includes('token=')) {
          wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
        }
      } else {
        const httpsMatch = cleanData.match(/https:\/\/([a-zA-Z0-9.-]+\.(?:trycloudflare\.com|pinggy\.link|pangolin\.link|[a-zA-Z]{2,}))/);
        if (httpsMatch) {
          const host = httpsMatch[1].trim();
          wsUrl = `wss://${host}/ws?token=${encodeURIComponent(token)}`;
        }
      }

      if (wsUrl && remoteQrImage) {
        currentActiveWsUrl = wsUrl;
        window.ag.generateQr(wsUrl).then((dataUrl) => {
          remoteQrImage.src = dataUrl;
          if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
          if (remoteQrContainer) remoteQrContainer.style.display = 'block';
          renderRemoteStatusText('Tunnel prêt', wsUrl);
        }).catch((err) => {
          console.error('[ag-doctor-ui] QR generation failed for tunnel URL:', err);
          renderRemoteStatusText('Tunnel prêt', wsUrl);
        });
      } else if (cleanData.includes('Daemon listening on') || cleanData.includes('Tunnel non démarré') || cleanData.includes('introuvable')) {
        const port = parseInt(remotePort?.value || '8090');
        window.ag.getLocalIp().then((localIp: string) => {
          const localWsUrl = `ws://${localIp}:${port}/ws?token=${encodeURIComponent(token)}`;
          currentActiveWsUrl = localWsUrl;
          window.ag.generateQr(localWsUrl).then((dataUrl: string) => {
            if (remoteQrImage) remoteQrImage.src = dataUrl;
            if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
            if (remoteQrContainer) remoteQrContainer.style.display = 'block';
            renderRemoteStatusText('Mode Local Wi-Fi actif', localWsUrl, '<br/><span style="font-size: 11px; opacity: 0.75;">(Scannez avec votre mobile connecté au même Wi-Fi)</span>');
          }).catch((err) => {
            console.error('[ag-doctor-ui] QR generation failed for local URL:', err);
            renderRemoteStatusText('Mode Local Wi-Fi actif', localWsUrl, '<br/><span style="font-size: 11px; opacity: 0.75;">(Scannez avec votre mobile connecté au même Wi-Fi)</span>');
          });
        });
      }

    }
  });
}

if (startRemoteBtn) {
  startRemoteBtn.addEventListener('click', async () => {
    if (isDaemonRunning) {
      // Arrêter le démon
      await window.ag.stopDaemon();
      isDaemonRunning = false;
      startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Remote Server';
      startRemoteBtn.classList.remove('btn-danger');
      if (remoteStatusText) remoteStatusText.textContent = 'Serveur arrêté.';
      if (remoteQrContainer) remoteQrContainer.style.display = 'none';
      if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'flex';
      if (remotePinDisplay) remotePinDisplay.textContent = '------';
      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'Hors ligne';
        remoteTelemetryBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        remoteTelemetryBadge.style.color = 'var(--text-2)';
      }
      return;
    }

    try {
      startRemoteBtn.setAttribute('disabled', 'true');
      if (remoteStatusText) remoteStatusText.textContent = 'Démarrage du serveur...';
      if (remoteConsole) remoteConsole.value = ''; // clear console

      const port = parseInt(remotePort?.value || '8090');
      const tunnel = remoteTunnel?.value || 'pinggy';
      const allowFirstAdmin = remoteAllowFirstAdmin?.checked ?? true;
      const token = getOrGenerateAuthToken();

      // Sauvegarde persistante des choix
      try {
        localStorage.setItem('ag_remote_auth_token', token);
        localStorage.setItem('ag_remote_port', port.toString());
        localStorage.setItem('ag_remote_tunnel', tunnel);
        localStorage.setItem('ag_remote_allow_first_admin', allowFirstAdmin ? 'true' : 'false');
      } catch { /* ignore */ }

      const res = await window.ag.startDaemon({ port, tunnel, token, allowFirstAdmin });

      if (res && res.alreadyRunning) {
        await syncDaemonUiStatus(port);
      } else if (tunnel === 'none') {
        const ip = await window.ag.getLocalIp();
        const wsUrl = `ws://${ip}:${port}/ws?token=${encodeURIComponent(token)}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        renderRemoteStatusText('Serveur à l\'écoute (Réseau local)', wsUrl);
      }

      isDaemonRunning = true;
      startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Stop Remote Server';
      startRemoteBtn.classList.add('btn-danger');
    } catch (e: any) {
      if (remoteStatusText) remoteStatusText.textContent = `Erreur: ${e.message}`;
    } finally {
      startRemoteBtn.removeAttribute('disabled');
    }
  });
}

// Auto-détection inconditionnelle de l'état du daemon et de l'IDE (quand l'onglet remote est actif)
setInterval(() => {
  const isRemoteActive = Boolean(document.getElementById('view-remote')?.classList.contains('active'));
  if (isRemoteActive) {
    void syncDaemonUiStatus();
    void syncIdeStatus();
    updateRemoteSyncedAccountsBadge();
  }
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
