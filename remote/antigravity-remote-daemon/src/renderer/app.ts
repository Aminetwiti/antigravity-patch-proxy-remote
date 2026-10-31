// ─────────────────────────────────────────────────────────────────────────
// Antigravity Remote Daemon — Renderer Logic
// ─────────────────────────────────────────────────────────────────────────

// DOM Elements
const startRemoteBtn = document.getElementById('startRemoteBtn') as HTMLButtonElement | null;
const remotePort = document.getElementById('remotePort') as HTMLInputElement | null;
const remoteTunnel = document.getElementById('remoteTunnel') as HTMLSelectElement | null;
const remoteAuthToken = document.getElementById('remoteAuthToken') as HTMLInputElement | null;
const regenerateTokenBtn = document.getElementById('regenerateTokenBtn') as HTMLButtonElement | null;
const tokenSavedBadge = document.getElementById('tokenSavedBadge') as HTMLElement | null;
const remoteAllowFirstAdmin = document.getElementById('remoteAllowFirstAdmin') as HTMLInputElement | null;
const remoteCheckHealthBtn = document.getElementById('remoteCheckHealthBtn') as HTMLButtonElement | null;
const remoteCopyWsUrlBtn = document.getElementById('remoteCopyWsUrlBtn') as HTMLButtonElement | null;

const remoteTelemetryBadge = document.getElementById('remoteTelemetryBadge') as HTMLElement | null;
const remoteClientsCount = document.getElementById('remoteClientsCount') as HTMLElement | null;
const remoteSessionsCount = document.getElementById('remoteSessionsCount') as HTMLElement | null;
const remoteUptimeDisplay = document.getElementById('remoteUptimeDisplay') as HTMLElement | null;

const remoteConsole = document.getElementById('remoteConsole') as HTMLTextAreaElement | null;
const clearConsoleBtn = document.getElementById('clearConsoleBtn') as HTMLButtonElement | null;

const remoteQrContainer = document.getElementById('remoteQrContainer') as HTMLElement | null;
const remoteQrPlaceholder = document.getElementById('remoteQrPlaceholder') as HTMLElement | null;
const remoteQrImage = document.getElementById('remoteQrImage') as HTMLImageElement | null;
const remoteStatusText = document.getElementById('remoteStatusText') as HTMLElement | null;
const remotePinDisplay = document.getElementById('remotePinDisplay') as HTMLElement | null;

let isDaemonRunning = false;
let currentActiveWsUrl = '';

// Load saved settings
function loadSettings(): void {
  try {
    const savedToken = localStorage.getItem('ag_remote_auth_token');
    if (savedToken && remoteAuthToken) remoteAuthToken.value = savedToken;

    const savedPort = localStorage.getItem('ag_remote_port');
    if (savedPort && remotePort) remotePort.value = savedPort;

    const savedTunnel = localStorage.getItem('ag_remote_tunnel');
    if (savedTunnel && remoteTunnel) remoteTunnel.value = savedTunnel;

    const savedAdmin = localStorage.getItem('ag_remote_allow_first_admin');
    if (savedAdmin !== null && remoteAllowFirstAdmin) {
      remoteAllowFirstAdmin.checked = savedAdmin === 'true';
    }
  } catch {
    /* ignore storage access error */
  }
}

// Save settings helper
function saveSettings(): void {
  try {
    if (remoteAuthToken) localStorage.setItem('ag_remote_auth_token', remoteAuthToken.value.trim());
    if (remotePort) localStorage.setItem('ag_remote_port', remotePort.value);
    if (remoteTunnel) localStorage.setItem('ag_remote_tunnel', remoteTunnel.value);
    if (remoteAllowFirstAdmin) localStorage.setItem('ag_remote_allow_first_admin', remoteAllowFirstAdmin.checked ? 'true' : 'false');

    if (tokenSavedBadge) {
      tokenSavedBadge.style.display = 'inline';
      setTimeout(() => {
        if (tokenSavedBadge) tokenSavedBadge.style.display = 'none';
      }, 2000);
    }
  } catch {
    /* ignore */
  }
}

// Token Regeneration
if (regenerateTokenBtn) {
  regenerateTokenBtn.addEventListener('click', () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let rand = '';
    for (let i = 0; i < 8; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (remoteAuthToken) {
      remoteAuthToken.value = rand;
      saveSettings();
    }
  });
}

if (remoteAuthToken) {
  remoteAuthToken.addEventListener('input', () => {
    saveSettings();
  });
}

if (remotePort) {
  remotePort.addEventListener('change', () => {
    saveSettings();
  });
}

if (remoteTunnel) {
  remoteTunnel.addEventListener('change', () => {
    saveSettings();
  });
}

if (remoteAllowFirstAdmin) {
  remoteAllowFirstAdmin.addEventListener('change', () => {
    saveSettings();
  });
}

if (clearConsoleBtn && remoteConsole) {
  clearConsoleBtn.addEventListener('click', () => {
    remoteConsole.value = '';
  });
}

// Check Health handler
if (remoteCheckHealthBtn) {
  remoteCheckHealthBtn.addEventListener('click', async () => {
    const port = parseInt(remotePort?.value || '8090', 10);
    const token = remoteAuthToken?.value?.trim() || '11';
    try {
      remoteCheckHealthBtn.textContent = '⏳ Test en cours...';
      const status = await window.agRemote.getDaemonStatus(port, token);
      if (status && status.running) {
        alert(`✅ Daemon opérationnel !\n- Port : ${status.port}\n- Clients connectés : ${status.telemetry?.clients ?? 0}\n- Sessions : ${status.telemetry?.sessions ?? 0}\n- Uptime : ${status.telemetry?.uptime ?? '-'}`);
      } else {
        alert(`❌ Impossible de joindre le daemon sur le port ${port}.\nVérifiez qu'il est bien démarré.`);
      }
    } catch (err: any) {
      alert(`❌ Erreur de test : ${err.message}`);
    } finally {
      remoteCheckHealthBtn.textContent = '🧪 Tester la Santé (/health)';
    }
  });
}

// Copy URL handler
if (remoteCopyWsUrlBtn) {
  remoteCopyWsUrlBtn.addEventListener('click', () => {
    if (currentActiveWsUrl) {
      navigator.clipboard.writeText(currentActiveWsUrl).then(() => {
        const originalText = remoteCopyWsUrlBtn.textContent;
        remoteCopyWsUrlBtn.textContent = '✓ Copié !';
        setTimeout(() => {
          if (remoteCopyWsUrlBtn) remoteCopyWsUrlBtn.textContent = originalText;
        }, 2000);
      });
    } else {
      alert('Aucune URL WebSocket active pour le moment. Démarrez le serveur.');
    }
  });
}

function updateUiForRunningState(running: boolean) {
  isDaemonRunning = running;
  if (startRemoteBtn) {
    if (running) {
      startRemoteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        <span>Stop Remote Server</span>
      `;
      startRemoteBtn.classList.add('btn-danger');
      startRemoteBtn.classList.remove('btn-primary');
    } else {
      startRemoteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Start Remote Server</span>
      `;
      startRemoteBtn.classList.remove('btn-danger');
      startRemoteBtn.classList.add('btn-primary');
    }
  }

  if (remoteTelemetryBadge) {
    if (running) {
      remoteTelemetryBadge.textContent = 'En ligne';
      remoteTelemetryBadge.className = 'badge badge-online';
    } else {
      remoteTelemetryBadge.textContent = 'Hors ligne';
      remoteTelemetryBadge.className = 'badge badge-offline';
    }
  }
}

async function renderQrCode(wsUrl: string, description: string) {
  try {
    currentActiveWsUrl = wsUrl;
    const dataUrl = await window.agRemote.generateQr(wsUrl);
    if (remoteQrImage) remoteQrImage.src = dataUrl;
    if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
    if (remoteQrContainer) remoteQrContainer.style.display = 'flex';
    if (remoteStatusText) {
      remoteStatusText.innerHTML = `${description}: <b style="word-break: break-all; color: var(--text-0);">${wsUrl}</b>`;
    }
  } catch (err) {
    console.error('Failed to generate QR code:', err);
  }
}

async function syncDaemonUiStatus() {
  try {
    const port = parseInt(remotePort?.value || '8090', 10);
    const token = remoteAuthToken?.value?.trim() || '11';
    const status = await window.agRemote.getDaemonStatus(port, token);

    if (status && status.running) {
      updateUiForRunningState(true);

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
        const wsUrl = `wss://${cleanHost}/ws?token=${token}`;
        await renderQrCode(wsUrl, 'Tunnel ready');
      } else if (!currentActiveWsUrl) {
        const ip = await window.agRemote.getLocalIp();
        const wsUrl = `ws://${ip}:${status.port || port}/ws?token=${token}`;
        await renderQrCode(wsUrl, `Server listening on ${ip}:${status.port || port} (Local Network)`);
      }
    } else {
      updateUiForRunningState(false);
      if (remoteClientsCount) remoteClientsCount.textContent = '0';
      if (remoteSessionsCount) remoteSessionsCount.textContent = '0';
      if (remoteUptimeDisplay) remoteUptimeDisplay.textContent = '-';
    }
  } catch {
    /* ignore offline sync */
  }
}

// Listen to daemon logs
if (window.agRemote && window.agRemote.onDaemonLog) {
  window.agRemote.onDaemonLog((data: string) => {
    if (remoteConsole) {
      remoteConsole.value += data;
      remoteConsole.scrollTop = remoteConsole.scrollHeight;

      // Extract PIN code
      const pinMatch = data.match(/Code PIN d'appairage mobile\s*:\s*([0-9]{6})/);
      if (pinMatch && remotePinDisplay) {
        remotePinDisplay.textContent = pinMatch[1];
      }

      // Extract Tunnel / WebSocket URL from logs
      const token = remoteAuthToken?.value?.trim() || '11';
      const cleanData = data
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

      const wssMatch = cleanData.match(/wss:\/\/[^\s"'<>|┌┐└┘│+]+/);
      if (wssMatch) {
        let wsUrl = wssMatch[0].trim().replace(/[\]\)\>\}\│\|\s]+$/, '');
        if (!wsUrl.includes('token=')) {
          wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
        }
        void renderQrCode(wsUrl, 'Tunnel ready');
      } else {
        const httpsMatch = cleanData.match(/https:\/\/([a-zA-Z0-9.-]+\.(?:trycloudflare\.com|pinggy\.link|pangolin\.link|[a-zA-Z]{2,}))/);
        if (httpsMatch) {
          const host = httpsMatch[1].trim();
          const wsUrl = `wss://${host}/ws?token=${token}`;
          void renderQrCode(wsUrl, 'Tunnel ready');
        }
      }
    }
  });
}

// Start / Stop Remote Server button listener
if (startRemoteBtn) {
  startRemoteBtn.addEventListener('click', async () => {
    if (isDaemonRunning) {
      // Stop daemon
      await window.agRemote.stopDaemon();
      updateUiForRunningState(false);
      if (remoteStatusText) remoteStatusText.textContent = 'Server stopped.';
      if (remoteQrContainer) remoteQrContainer.style.display = 'none';
      if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'flex';
      currentActiveWsUrl = '';
      return;
    }

    try {
      startRemoteBtn.setAttribute('disabled', 'true');
      if (remoteStatusText) remoteStatusText.textContent = 'Starting server...';
      if (remoteConsole) remoteConsole.value = '';

      const port = parseInt(remotePort?.value || '8090', 10);
      const tunnel = remoteTunnel?.value || 'cloudflare';
      const token = remoteAuthToken?.value?.trim() || '11';
      const allowFirstAdmin = remoteAllowFirstAdmin?.checked ?? true;

      saveSettings();

      const res = await window.agRemote.startDaemon({ port, tunnel, token, allowFirstAdmin });

      if (res && res.alreadyRunning) {
        await syncDaemonUiStatus();
      } else if (tunnel === 'none') {
        const ip = await window.agRemote.getLocalIp();
        const wsUrl = `ws://${ip}:${port}/ws?token=${token}`;
        await renderQrCode(wsUrl, `Mode Local Wi-Fi actif : ${ip}:${port}`);
      }

      updateUiForRunningState(true);
    } catch (e: any) {
      if (remoteStatusText) remoteStatusText.textContent = `Erreur: ${e.message}`;
    } finally {
      startRemoteBtn.removeAttribute('disabled');
    }
  });
}

// Initialize on page load
loadSettings();
void syncDaemonUiStatus();

// Polling interval when active
setInterval(() => {
  if (isDaemonRunning) {
    void syncDaemonUiStatus();
  }
}, 5000);
