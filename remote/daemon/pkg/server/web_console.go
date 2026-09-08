package server

import (
	"net/http"
)

// WebConsoleHTML contains the self-contained Single-Page Application for observing and controlling the agent.
const WebConsoleHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Remote Agent Cloud Console</title>
  <style>
    :root {
      --bg: #0d0e11;
      --sidebar: #13151b;
      --card: #1c1f26;
      --border: #2b303c;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Header */
    header {
      background: var(--sidebar);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 16px;
    }
    .brand-badge {
      background: rgba(59, 130, 246, 0.15);
      color: var(--accent);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .server-status {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 500;
      font-size: 12px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    /* Layout */
    .app-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    /* Sidebar */
    aside {
      width: 320px;
      background: var(--sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    .aside-header {
      padding: 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: var(--success); }
    .btn-success:hover { background: #059669; }
    .btn-secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #262b35; }
    .sessions-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .session-item {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .session-item:hover, .session-item.active {
      border-color: var(--accent);
      background: rgba(59, 130, 246, 0.05);
    }
    .session-title {
      font-weight: 500;
      font-size: 14px;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-muted);
    }
    .badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .badge-running { background: rgba(59, 130, 246, 0.2); color: var(--accent); }
    .badge-waiting { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-ready { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    /* Main Content */
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      overflow: hidden;
    }
    .chat-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--sidebar);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bubble {
      max-width: 85%;
      padding: 14px 18px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.6;
    }
    .bubble-user {
      align-self: flex-end;
      background: var(--accent);
      color: white;
    }
    .bubble-assistant {
      align-self: flex-start;
      background: var(--card);
      border: 1px solid var(--border);
    }
    .thought-card {
      align-self: flex-start;
      width: 85%;
      background: rgba(30, 41, 59, 0.4);
      border-left: 3px solid #64748b;
      padding: 10px 14px;
      border-radius: 0 8px 8px 0;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      white-space: pre-wrap;
    }
    .tool-card {
      align-self: flex-start;
      width: 85%;
      background: #14171e;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .tool-header {
      background: #1e222d;
      padding: 8px 12px;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--accent);
      display: flex;
      justify-content: space-between;
    }
    .tool-body {
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #cbd5e1;
      background: #0b0d11;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    /* Approval Banner */
    .approval-banner {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid var(--warning);
      padding: 16px;
      border-radius: 10px;
      margin: 0 20px 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .approval-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--warning);
      font-size: 14px;
    }
    .approval-actions {
      display: flex;
      gap: 10px;
    }
    /* Prompt Input */
    .input-container {
      padding: 16px 20px;
      background: var(--sidebar);
      border-top: 1px solid var(--border);
      display: flex;
      gap: 12px;
    }
    textarea {
      flex: 1;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 12px;
      font-size: 14px;
      resize: none;
      height: 48px;
      outline: none;
      transition: border-color 0.15s;
    }
    textarea:focus { border-color: var(--accent); }
    /* Auth Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal {
      background: var(--sidebar);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      width: 400px;
      max-width: 90%;
    }
    .modal h2 { margin-bottom: 8px; font-size: 18px; }
    .modal p { color: var(--text-muted); font-size: 13px; margin-bottom: 20px; }
    .input-field {
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      padding: 10px 12px;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- Auth Modal -->
  <div id="authModal" class="modal-overlay hidden">
    <div class="modal">
      <h2>Server Authentication</h2>
      <p>Enter the server auth token to connect to this remote agent.</p>
      <input type="password" id="authTokenInput" class="input-field" placeholder="Bearer Token (e.g. sk-...)" />
      <button class="btn" style="width:100%" onclick="saveAuthToken()">Connect to Server</button>
    </div>
  </div>

  <header>
    <div class="brand">
      <span>🚀 Antigravity</span>
      <span class="brand-badge">Cloud Agent Runtime</span>
    </div>
    <div class="server-status">
      <div id="statusPill" class="status-pill">
        <span class="dot"></span>
        <span id="statusText">Connecting...</span>
      </div>
      <span id="serverInfo">ag-agentd</span>
    </div>
  </header>

  <div class="app-container">
    <!-- Sidebar -->
    <aside>
      <div class="aside-header">
        <span style="font-size:13px;font-weight:600;color:var(--text-muted)">ACTIVE SESSIONS</span>
        <button class="btn" onclick="createNewSession()">+ New</button>
      </div>
      <div id="sessionsList" class="sessions-list">
        <!-- Sessions rendered dynamically -->
      </div>
    </aside>

    <!-- Main Chat Transcript -->
    <main>
      <div class="chat-header">
        <div>
          <h2 id="chatTitle" style="font-size:15px;font-weight:600">Select or Create a Session</h2>
          <span id="chatSubtitle" style="font-size:12px;color:var(--text-muted)">No session connected</span>
        </div>
        <div id="chatActions">
          <button id="cancelBtn" class="btn btn-danger hidden" onclick="cancelCurrentTurn()">Stop Generation</button>
        </div>
      </div>

      <div id="transcript" class="transcript">
        <!-- Chat bubbles rendered dynamically -->
      </div>

      <!-- Human-in-the-Loop Approval Banner -->
      <div id="approvalBanner" class="approval-banner hidden">
        <div class="approval-header">
          <span>⚠️ Tool Execution Requires Approval</span>
        </div>
        <div id="approvalDetail" style="font-size:13px;font-family:var(--font-mono)"></div>
        <div class="approval-actions">
          <button class="btn btn-success" onclick="resolveApproval(true)">Approve & Run</button>
          <button class="btn btn-danger" onclick="resolveApproval(false)">Deny</button>
        </div>
      </div>

      <!-- Prompt Input -->
      <div class="input-container">
        <textarea id="promptInput" placeholder="Send instructions to remote agent (Enter to send, Shift+Enter for newline)..." onkeydown="handleKey(event)"></textarea>
        <button id="sendBtn" class="btn" onclick="sendPrompt()">Send</button>
      </div>
    </main>
  </div>

  <script>
    let ws = null;
    let token = localStorage.getItem('ag_token') || '';
    let currentSessionId = '';
    let pendingApprovalId = null;

    // Check auth on startup
    window.addEventListener('DOMContentLoaded', function() {
      initApp();
    });

    function initApp() {
      // Extract token from URL if provided
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      if (urlToken) {
        token = urlToken;
        localStorage.setItem('ag_token', token);
      }

      fetchHealth();
      connectWebSocket();
    }

    function fetchHealth() {
      fetch('/health')
        .then(function(res) {
          if (res.ok) return res.json();
          throw new Error('health failed');
        })
        .then(function(data) {
          document.getElementById('serverInfo').innerText = (data.serverId || 'srv') + ' (' + (data.platform || 'linux') + ')';
        })
        .catch(function(err) {
          console.warn('Health check warning:', err);
        });
    }

    function saveAuthToken() {
      const input = document.getElementById('authTokenInput').value.trim();
      if (input) {
        token = input;
        localStorage.setItem('ag_token', token);
        document.getElementById('authModal').classList.add('hidden');
        connectWebSocket();
      }
    }

    function connectWebSocket() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = proto + '//' + window.location.host + '/v2/ws?token=' + encodeURIComponent(token);

      ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        document.getElementById('statusPill').style.color = 'var(--success)';
        document.getElementById('statusPill').style.background = 'rgba(16, 185, 129, 0.1)';
        document.getElementById('statusText').innerText = 'Online';
        loadSessions();
      };

      ws.onmessage = function(event) {
        try {
          const frame = JSON.parse(event.data);
          handleWebSocketMessage(frame);
        } catch (e) {
          console.error('Failed to parse frame:', e);
        }
      };

      ws.onclose = function(event) {
        document.getElementById('statusPill').style.color = 'var(--danger)';
        document.getElementById('statusPill').style.background = 'rgba(239, 68, 68, 0.1)';
        document.getElementById('statusText').innerText = 'Disconnected';
        if (event.code === 4401 || event.code === 1008) {
          document.getElementById('authModal').classList.remove('hidden');
        } else {
          setTimeout(connectWebSocket, 3000);
        }
      };
    }

    function handleWebSocketMessage(frame) {
      if (frame.type === 'session.event' && frame.event) {
        const evt = frame.event;
        if (evt.sessionId === currentSessionId) {
          renderEvent(evt);
        }
      } else if (frame.type === 'session.catchup') {
        if (frame.events && Array.isArray(frame.events)) {
          frame.events.forEach(renderEvent);
        }
      }
    }

    function loadSessions() {
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      fetch('/v2/sessions', { headers: headers })
        .then(function(res) {
          if (res.status === 401) {
            document.getElementById('authModal').classList.remove('hidden');
            return null;
          }
          return res.json();
        })
        .then(function(data) {
          if (!data || !data.sessions) return;
          const list = document.getElementById('sessionsList');
          list.innerHTML = '';
          data.sessions.forEach(function(s) {
            const item = document.createElement('div');
            item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
            item.onclick = function() { selectSession(s.id, s.title, s.workspaceId); };
            item.innerHTML = '<div class="session-title">' + escapeHtml(s.title || 'Session') + '</div>' +
              '<div class="session-meta">' +
                '<span>' + escapeHtml(s.workspaceId || 'default') + '</span>' +
                '<span class="badge badge-ready">' + (s.state || 'READY') + '</span>' +
              '</div>';
            list.appendChild(item);
          });
          if (!currentSessionId && data.sessions.length > 0) {
            const first = data.sessions[0];
            selectSession(first.id, first.title, first.workspaceId);
          }
        })
        .catch(function(err) {
          console.error('Failed to load sessions:', err);
        });
    }

    function selectSession(id, title, workspace) {
      currentSessionId = id;
      document.getElementById('chatTitle').innerText = title || id;
      document.getElementById('chatSubtitle').innerText = 'Session: ' + id + ' | Workspace: ' + workspace;
      document.getElementById('transcript').innerHTML = '';
      document.getElementById('approvalBanner').classList.add('hidden');

      // Update sidebar active class
      document.querySelectorAll('.session-item').forEach(function(el) {
        const titleEl = el.querySelector('.session-title');
        el.classList.toggle('active', titleEl && titleEl.innerText === title);
      });

      // Attach via WebSocket with since_seq: 0 for full catchup replay
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session.attach',
          commandId: 'cmd_att_' + Date.now(),
          sessionId: id,
          sinceSeq: 0
        }));
      }
    }

    function createNewSession() {
      const headers = token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
      fetch('/v2/sessions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ workspace_id: 'default-workspace' })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        loadSessions();
        selectSession(data.id, data.title, data.workspaceId);
      })
      .catch(function(err) {
        console.error('Failed to create session:', err);
      });
    }

    function renderEvent(evt) {
      const transcript = document.getElementById('transcript');
      let payload = evt.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) {}
      }

      if (evt.type === 'user.message') {
        const bubble = document.createElement('div');
        bubble.className = 'bubble bubble-user';
        bubble.innerText = (payload && payload.prompt) ? payload.prompt : 'User message';
        transcript.appendChild(bubble);
      } else if (evt.type === 'agent.thought' || evt.type === 'agent.thought_chunk') {
        const thoughtText = (payload && (payload.thought || payload.chunk)) ? (payload.thought || payload.chunk) : '';
        if (thoughtText) {
          const card = document.createElement('div');
          card.className = 'thought-card';
          card.innerText = '💭 ' + thoughtText;
          transcript.appendChild(card);
        }
      } else if (evt.type === 'tool.call') {
        const card = document.createElement('div');
        card.className = 'tool-card';
        card.innerHTML = '<div class="tool-header">' +
          '<span>⚙️ TOOL: ' + escapeHtml((payload && payload.tool) ? payload.tool : 'command') + '</span>' +
          '<span>' + escapeHtml((payload && payload.call_id) ? payload.call_id : '') + '</span>' +
        '</div>' +
        '<div class="tool-body">' + escapeHtml(JSON.stringify((payload && payload.args) ? payload.args : {}, null, 2)) + '</div>';
        transcript.appendChild(card);
      } else if (evt.type === 'tool.output' || evt.type === 'tool.result') {
        const card = document.createElement('div');
        card.className = 'tool-card';
        const out = (payload && (payload.output || payload.chunk)) ? (payload.output || payload.chunk) : '';
        card.innerHTML = '<div class="tool-header" style="color:var(--success)">' +
          '<span>OUTPUT (' + escapeHtml((payload && payload.call_id) ? payload.call_id : 'result') + ')</span>' +
        '</div>' +
        '<div class="tool-body">' + escapeHtml(out) + '</div>';
        transcript.appendChild(card);
      } else if (evt.type === 'approval.requested') {
        if (payload) {
          pendingApprovalId = payload.approval_id;
          document.getElementById('approvalDetail').innerText = 'Tool: ' + payload.tool + ' | Args: ' + JSON.stringify(payload.args);
          document.getElementById('approvalBanner').classList.remove('hidden');
        }
      } else if (evt.type === 'approval.resolved') {
        document.getElementById('approvalBanner').classList.add('hidden');
        pendingApprovalId = null;
      } else if (evt.type === 'agent.completed') {
        document.getElementById('cancelBtn').classList.add('hidden');
      }

      transcript.scrollTop = transcript.scrollHeight;
    }

    function sendPrompt() {
      const input = document.getElementById('promptInput');
      const text = input.value.trim();
      if (!text || !currentSessionId) return;

      input.value = '';
      document.getElementById('cancelBtn').classList.remove('hidden');

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session.prompt',
          commandId: 'cmd_p_' + Date.now(),
          sessionId: currentSessionId,
          prompt: text,
          idempotencyKey: 'idemp_' + Date.now()
        }));
      }
    }

    function resolveApproval(allow) {
      if (!pendingApprovalId || !currentSessionId) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'tool.approval.respond',
          commandId: 'cmd_appr_' + Date.now(),
          sessionId: currentSessionId,
          approvalId: pendingApprovalId,
          decision: allow ? 'allow' : 'deny'
        }));
      }
      document.getElementById('approvalBanner').classList.add('hidden');
    }

    function cancelCurrentTurn() {
      if (!currentSessionId) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session.cancel',
          commandId: 'cmd_cancel_' + Date.now(),
          sessionId: currentSessionId
        }));
      }
      document.getElementById('cancelBtn').classList.add('hidden');
    }

    function handleKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>
`

// HandleWebConsole serves the single-page web console on GET / and GET /console.
func HandleWebConsole(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/console" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(WebConsoleHTML))
}
