// Polyfill crypto.randomUUID pour navigateurs HTTP non sécurisés
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

let ws = null;
let activeCascadeId = null;
let currentToken = localStorage.getItem('ag_remote_token') || new URLSearchParams(window.location.search).get('token') || '';

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(currentToken)}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('ws-dot').className = 'dot connected';
    document.getElementById('ws-text').textContent = 'Connecté';
    // Récupérer la session active
    sendRPC('get_active_session', {});
  };

  ws.onclose = () => {
    document.getElementById('ws-dot').className = 'dot';
    document.getElementById('ws-text').textContent = 'Déconnecté';
    setTimeout(initWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleIncomingMessage(msg);
    } catch (e) {
      console.error('Erreur parsing WS:', e);
    }
  };
}

function sendRPC(type, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = {
    type: type,
    requestId: crypto.randomUUID(),
    cascadeId: activeCascadeId,
    ...data
  };
  ws.send(JSON.stringify(payload));
}

function handleIncomingMessage(msg) {
  switch (msg.type) {
    case 'host_telemetry':
      if (msg.data) {
        document.getElementById('cpu-stat').textContent = `${msg.data.cpuPercent}%`;
        document.getElementById('ram-stat').textContent = `${Math.round(msg.data.ramUsedMb / 1024 * 10) / 10} / ${Math.round(msg.data.ramTotalMb / 1024)} Go`;
      }
      break;

    case 'ide_status':
      if (msg.data) {
        document.getElementById('ide-stat').textContent = msg.data.running ? `Actif (Port ${msg.data.port})` : 'Éteint';
      }
      break;

    case 'stream_delta':
      appendDelta(msg.data?.delta || msg.data?.thinkingDelta || '');
      break;

    case 'stream_start':
      startAgentMessage();
      break;

    case 'stream_end':
      finishAgentMessage();
      break;

    case 'tool_approval_request':
      renderApprovalCard(msg.data);
      break;

    case 'response':
      if (msg.data && msg.data.cascadeId) {
        activeCascadeId = msg.data.cascadeId;
      }
      break;
  }
}

let currentAgentMsgEl = null;

function appendUserMessage(text) {
  const container = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'message user';
  msgEl.textContent = text;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function startAgentMessage() {
  const container = document.getElementById('chat-messages');
  currentAgentMsgEl = document.createElement('div');
  currentAgentMsgEl.className = 'message agent';
  currentAgentMsgEl.textContent = '';
  container.appendChild(currentAgentMsgEl);
  container.scrollTop = container.scrollHeight;
}

function appendDelta(delta) {
  if (!currentAgentMsgEl) {
    startAgentMessage();
  }
  currentAgentMsgEl.textContent += delta;
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function finishAgentMessage() {
  currentAgentMsgEl = null;
}

function renderApprovalCard(data) {
  const container = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'message approval';
  card.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 6px;">⚠️ Approbation d'action requise</div>
    <div style="font-size: 12px; margin-bottom: 10px; color: var(--text-muted);">${data.toolName || 'Outil'}</div>
    <div style="display: flex; gap: 8px;">
      <button class="primary" style="flex: 1;" onclick="submitApproval('${data.callId}', 'allow')">Autoriser</button>
      <button class="danger" style="flex: 1;" onclick="submitApproval('${data.callId}', 'deny')">Refuser</button>
    </div>
  `;
  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
}

function submitApproval(callId, decision) {
  sendRPC('submit_approval', {
    callId: callId,
    decision: decision,
    scope: 'once'
  });
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  appendUserMessage(text);

  if (!activeCascadeId) {
    sendRPC('create_cascade', {});
  }
  sendRPC('send_prompt', { prompt: text });
}

function launchIDE() { sendRPC('ide_launch', {}); }
function restartIDE() { sendRPC('ide_restart', {}); }
function emergencyStop() { sendRPC('emergency_stop', {}); }

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  initWebSocket();
});
